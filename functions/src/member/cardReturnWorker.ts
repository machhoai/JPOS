import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFunctions } from "firebase-admin/functions";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { returnJobRef } from "../services/memberCardReturnService";
import { cardLockRef, cardMemberLockRef } from "../services/memberCardLinkLocks";
import { fetchCardReturnOwner, returnVerifiedCashierCard, verifyReturnedCard } from "../services/memberCardReturnRemote";
import { assertMemberEditAccess, assertMemberShopScope } from "../services/memberProfileEditService";
import { seedMemberEditProfile } from "../services/memberProfileEditService";
import { fetchRemoteMemberByUid } from "../services/hkApiService";
import { mapMemberLookup } from "../services/memberMapper";
import { joyworldUserSecret, joyworldPassSecret } from "../services/joyworldCatalogService";
import { MemberCardIssueError } from "../services/joyworldMemberCardService";
import type { CardReturnJob, CardReturnItem } from "../types/memberCardReturn";
const ACTIVE=["READY","SENDING","UNKNOWN","HK_CONFIRMED","LOCAL_PENDING"];
const queue=()=>getFunctions().taskQueue("locations/asia-southeast1/functions/processMemberCardReturnJob");

export async function processCardReturnJob(jobId:string) {
  if(!/^[a-fA-F0-9-]{36}$/.test(jobId))return;
  const ref=returnJobRef(jobId),token=randomUUID(),started=Date.now();
  const claim=await db.runTransaction(async tx=>{const snapshot=await tx.get(ref);const job=snapshot.data() as CardReturnJob|undefined;
    if(!job||["PAUSED","COMPLETED","NEEDS_REVIEW"].includes(job.status))return null;
    if(job.lease&&job.lease.expiresAt>Date.now())throw new HttpsError("aborted","Lô đang có worker xử lý.");
    tx.update(ref,{lease:{token,expiresAt:Date.now()+4*60_000},status:"RUNNING"});return job;});
  if(!claim)return;
  async function updateItem(index:number,patch:Partial<CardReturnItem>){await db.runTransaction(async tx=>{const job=(await tx.get(ref)).data() as CardReturnJob;
    if(job.lease?.token!==token)throw new HttpsError("aborted","Lease lô đã đổi.");const items=[...job.items];items[index]={...items[index],...patch};tx.update(ref,{items,updatedAt:new Date().toISOString()});});Object.assign(claim!.items[index],patch);}
  try {
    assertMemberShopScope(claim.shopId);await assertMemberEditAccess(claim.createdBy,claim.warehouseId,"pos.members.return_card");
    let processed=0;
    for(let index=0;index<claim.items.length;index++) {
      const item=claim.items[index];if(!ACTIVE.includes(item.state))continue;
      if(processed>=3||Date.now()-started>140_000)break;
      const latest=(await ref.get()).data() as CardReturnJob;if(latest.status==="PAUSED")break;
      processed++;
      const cardRef=cardLockRef(claim.shopId,item.owner.memberCode),accountRef=cardMemberLockRef(item.owner.uid);
      let held=false,mutated=item.state!=="READY",confirmed=["HK_CONFIRMED","LOCAL_PENDING"].includes(item.state);
      try {
        await updateItem(index,{attempts:item.attempts+1,lastError:null,mutationSent:item.mutationSent ?? (item.state!=="READY")});
        await db.runTransaction(async tx=>{const card=await tx.get(cardRef),account=await tx.get(accountRef),member=await tx.get(db.collection(POS_COLLECTIONS.members).doc(item.owner.uid));
          const profile=member.data();if(profile&&(profile.shopId!==claim.shopId||(profile.warehouseId!==claim.warehouseId&&profile.hkImportUnassigned!==true)))throw new HttpsError("permission-denied","Hồ sơ không thuộc điểm bán của lô.");
          if(profile?.syncLease?.expiresAt>new Date().toISOString())throw new HttpsError("aborted","Hồ sơ đang đồng bộ, cần chờ.");
          for(const snapshot of [card,account]){const lock=snapshot.data();if(lock&&(lock.kind==="RETURN"?(lock.jobId!==jobId||lock.operationId!==item.operationId):Number(lock.expiresAt)>Date.now()))throw new HttpsError("aborted","Thẻ/thành viên đang có thao tác khác.");}
          const lock={kind:"RETURN",jobId,operationId:item.operationId,token};tx.set(cardRef,lock);tx.set(accountRef,lock);});held=true;
        const owner=await fetchCardReturnOwner(claim.shopId,item.owner.memberCode);
        if(owner&&(owner.uid!==item.owner.uid||owner.mid!==item.owner.mid||owner.cardUuid!==item.owner.cardUuid||(item.owner.memberCardId&&owner.memberCardId!==item.owner.memberCardId)))throw new HttpsError("failed-precondition","Chủ thẻ/chip/quan hệ thẻ đã thay đổi; không được gỡ thẻ của người khác.");
        if(owner) {
          if(mutated)throw new HttpsError("failed-precondition","Kết quả trước chưa rõ và thẻ vẫn gắn. Cần đối chiếu, không tự gửi gỡ lại.");
          if((await ref.get()).data()?.status==="PAUSED")break;
          await updateItem(index,{state:"SENDING",knownRejected:false,mutationSent:true});mutated=true;
          await returnVerifiedCashierCard(claim.shopId,owner,item.operationId);
        }
        const remaining=await verifyReturnedCard(claim.shopId,item.owner);
        confirmed=true;await updateItem(index,{state:"HK_CONFIRMED"});
        const memberRef=db.collection(POS_COLLECTIONS.members).doc(item.owner.uid);
        if(!(await memberRef.get()).exists){const remote=await fetchRemoteMemberByUid(item.owner.uid);if(!remote.success||!remote.data)throw new HttpsError("unavailable","Chưa đọc được member để lưu local.");await seedMemberEditProfile(mapMemberLookup(remote.data,{shopId:claim.shopId}),claim.warehouseId,claim.createdBy);}
        await db.runTransaction(async tx=>{const job=(await tx.get(ref)).data() as CardReturnJob,member=await tx.get(memberRef),card=await tx.get(cardRef),account=await tx.get(accountRef);
          if(job.lease?.token!==token||card.data()?.token!==token||account.data()?.token!==token)throw new HttpsError("aborted","Lease đã đổi trước khi lưu kết quả.");
          const stored=member.data()!,patch:Record<string,unknown>={cardLinksUpdatedAt:new Date().toISOString()};
          if(stored.memberCode===item.owner.memberCode)patch.memberCode=remaining;
          if(stored.hkSnapshot&&Array.isArray(stored.hkSnapshot.memberCardList))patch.hkSnapshot={...stored.hkSnapshot,memberCardList:stored.hkSnapshot.memberCardList.filter((c:{memberCode?:string})=>c.memberCode!==item.owner.memberCode)};
          tx.update(memberRef,patch);const items=[...job.items];items[index]={...items[index],state:"COMPLETED",lastError:null,completedAt:new Date().toISOString()};tx.update(ref,{items,updatedAt:new Date().toISOString()});
          tx.create(ref.collection("attempts").doc(randomUUID()),{operationId:item.operationId,state:"COMPLETED",createdAt:new Date().toISOString()});tx.delete(cardRef);tx.delete(accountRef);});held=false;
        item.state="COMPLETED";
      } catch(error) {
        const message=error instanceof Error?error.message:"Không thể gỡ thẻ.";
        const rejected=error instanceof MemberCardIssueError&&error.code==="HK_OPERATION_REJECTED";
        const terminal=error instanceof HttpsError&&["permission-denied","failed-precondition"].includes(error.code);
        const state=rejected||terminal||item.attempts>=6?"NEEDS_REVIEW":confirmed?"LOCAL_PENDING":mutated?"UNKNOWN":"READY";
        await updateItem(index,{state,lastError:message,knownRejected:rejected});
        await ref.collection("attempts").add({operationId:item.operationId,state,error:message,createdAt:new Date().toISOString()});
      } finally {
        if(held)await db.runTransaction(async tx=>{const card=await tx.get(cardRef),account=await tx.get(accountRef);if(account.data()?.token===token)tx.delete(accountRef);
          if(card.data()?.token===token&&!mutated&&!confirmed)tx.delete(cardRef);});
      }
    }
  } catch(error) {
    const message=error instanceof Error?error.message:"Không thể kiểm tra quyền xử lý lô.";
    await db.runTransaction(async tx=>{const job=(await tx.get(ref)).data() as CardReturnJob;if(job.lease?.token!==token)return;
      tx.update(ref,{items:job.items.map(item=>ACTIVE.includes(item.state)?{...item,state:"NEEDS_REVIEW",lastError:message,mutationSent:item.mutationSent ?? (item.state!=="READY")}:item),status:"NEEDS_REVIEW",updatedAt:new Date().toISOString()});});
  } finally {
    await db.runTransaction(async tx=>{const job=(await tx.get(ref)).data() as CardReturnJob;if(job.lease?.token!==token)return;
      const status=job.status==="PAUSED"?"PAUSED":job.items.every(i=>i.state==="COMPLETED"||i.state==="ALREADY_FREE")?"COMPLETED":job.items.some(i=>ACTIVE.includes(i.state))?"QUEUED":"NEEDS_REVIEW";
      const failed=job.items.filter(i=>ACTIVE.includes(i.state)&&i.lastError);
      const delay=failed.length?Math.min(300,30*2**Math.max(0,...failed.map(i=>i.attempts-1))):2;
      tx.update(ref,{lease:null,status,nextAttemptAt:new Date(Date.now()+delay*1000).toISOString(),updatedAt:new Date().toISOString()});});
  }
}
export const onMemberCardReturnJob=onDocumentWritten({document:`${POS_COLLECTIONS.memberCardReturns}/{jobId}`,region:"asia-southeast1",retry:true},async event=>{
  const after=event.data?.after.data(),before=event.data?.before.data();
  if(after?.status==="QUEUED"&&before?.status!=="QUEUED")await queue().enqueue({jobId:event.params.jobId},{scheduleDelaySeconds:Math.max(2,Math.min(300,Math.ceil((Date.parse(after.nextAttemptAt||"")-Date.now())/1000)||2)),dispatchDeadlineSeconds:300});
});
export const processMemberCardReturnJob=onTaskDispatched({region:"asia-southeast1",timeoutSeconds:300,retryConfig:{maxAttempts:6,minBackoffSeconds:30,maxBackoffSeconds:300},rateLimits:{maxConcurrentDispatches:2},secrets:[joyworldUserSecret,joyworldPassSecret]},async request=>{
  if(typeof request.data?.jobId!=="string")return;
  await processCardReturnJob(request.data.jobId);
});
