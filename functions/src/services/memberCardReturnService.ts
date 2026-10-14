import { HttpsError } from "firebase-functions/v2/https";
import { randomUUID, createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CardReturnOwner } from "./memberCardReturnRemote";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { assertMemberEditAccess, assertMemberShopScope } from "./memberProfileEditService";
import { fetchCardReturnOwner } from "./memberCardReturnRemote";
import { cashierRequest } from "./joyworldMemberCardService";
import type { CardReturnJob } from "../types/memberCardReturn";

export const returnJobRef=(id:string)=>db.collection(POS_COLLECTIONS.memberCardReturns).doc(id);
function scope(data:unknown) {
  const value=data as Record<string,unknown>|null;const shopId=Number(value?.shopId),warehouseId=typeof value?.warehouseId==="string"?value.warehouseId:"";
  if(!warehouseId||warehouseId.length>128)throw new HttpsError("invalid-argument","Điểm bán không hợp lệ.");
  assertMemberShopScope(shopId);return {shopId,warehouseId,value:value!};
}
async function access(userId:string,data:unknown){const input=scope(data);await assertMemberEditAccess(userId,input.warehouseId,"pos.members.return_card");return input;}
function signedPreview(payload:string){if(!process.env.HK_API_KEY)throw new HttpsError("failed-precondition","Chưa cấu hình khóa xác minh thẻ.");return createHmac("sha256",process.env.HK_API_KEY).update(`jpos-card-return:${payload}`).digest("hex");}
function previewToken(userId:string,warehouseId:string,owner:CardReturnOwner){const payload=Buffer.from(JSON.stringify({userId,warehouseId,owner,expiresAt:Date.now()+2*60*60_000})).toString("base64url");return `${payload}.${signedPreview(payload)}`;}
function verifyPreview(userId:string,shopId:number,warehouseId:string,card:Record<string,unknown>){
  const parts=typeof card.previewToken==="string"?card.previewToken.split("."):[];
  if(parts.length!==2||parts[0].length>8000||! /^[a-f0-9]{64}$/.test(parts[1])||!timingSafeEqual(Buffer.from(parts[1]),Buffer.from(signedPreview(parts[0]))))throw new HttpsError("failed-precondition","Kết quả xác minh thẻ không hợp lệ. Hãy đọc lại thẻ.");
  let value:{userId:string;warehouseId:string;owner:CardReturnOwner;expiresAt:number};try{value=JSON.parse(Buffer.from(parts[0],"base64url").toString());}catch{throw new HttpsError("invalid-argument","Kết quả xác minh thẻ không hợp lệ.");}
  if(value.userId!==userId||value.warehouseId!==warehouseId||value.owner.shopId!==shopId||value.expiresAt<Date.now()||value.owner.memberCode!==card.memberCode||value.owner.cardUuid!==String(card.cardUuid).toUpperCase())throw new HttpsError("failed-precondition","Kết quả xác minh đã hết hạn hoặc khác thẻ/điểm bán. Hãy đọc lại thẻ.");return value.owner;
}
export async function previewMemberCardReturnForUser(userId:string,data:unknown) {
  const {shopId,warehouseId,value}=await access(userId,data);
  const code=typeof value.memberCode==="string"?value.memberCode.trim():"",chip=typeof value.cardUuid==="string"?value.cardUuid.trim().toUpperCase():"";
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(code)||!/^[a-fA-F0-9]{8,128}$/.test(chip))throw new HttpsError("invalid-argument","Cần đọc đủ mã thẻ và chip vật lý.");
  const owner=await fetchCardReturnOwner(shopId,code);
  if(!owner){await cashierRequest({shopId,path:"/member/cashier/membercard/take/check",query:{memberCode:code}});return {owner:null,state:"ALREADY_FREE" as const,memberCode:code,cardUuid:chip};}
  if(owner.cardUuid!==chip)throw new HttpsError("failed-precondition","Mã thẻ/chip không trùng liên kết trên HK.");
  const local=(await db.collection(POS_COLLECTIONS.members).doc(owner.uid).get()).data();
  if(local&&(local.shopId!==shopId||(local.warehouseId!==warehouseId&&local.hkImportUnassigned!==true)))throw new HttpsError("permission-denied","Thành viên không thuộc điểm bán được chọn.");
  return {owner,previewToken:previewToken(userId,warehouseId,owner),state:"READY" as const,memberCode:code,cardUuid:chip};
}
export async function createMemberCardReturnJobForUser(userId:string,data:unknown,deviceId:string) {
  const {shopId,warehouseId,value}=await access(userId,data);
  const jobId=typeof value.jobId==="string"?value.jobId:"";
  if(!/^[a-fA-F0-9-]{36}$/.test(jobId)||!Array.isArray(value.cards)||!value.cards.length||value.cards.length>100)throw new HttpsError("invalid-argument","Lô gỡ thẻ phải có 1–100 thẻ và mã thao tác hợp lệ.");
  const requestHash=createHash("sha256").update(JSON.stringify(value.cards)).digest("hex");
  const ref=returnJobRef(jobId);
  const prior=(await ref.get()).data() as CardReturnJob|undefined;
  if(prior){if(prior.createdBy!==userId||prior.shopId!==shopId||prior.warehouseId!==warehouseId||prior.requestHash!==requestHash)throw new HttpsError("already-exists","Mã lô đã dùng cho danh sách khác.");return {jobId};}
  const previews: CardReturnJob["items"][number]["owner"][]=[];const codes=new Set<string>(),chips=new Set<string>();
  for(const card of value.cards){if(!card||typeof card!=="object")throw new HttpsError("invalid-argument","Dòng thẻ không hợp lệ.");const owner=verifyPreview(userId,shopId,warehouseId,card as Record<string,unknown>);
    if(codes.has(owner.memberCode)||chips.has(owner.cardUuid))throw new HttpsError("invalid-argument","Danh sách có thẻ/mã chip trùng.");codes.add(owner.memberCode);chips.add(owner.cardUuid);previews.push(owner);}
  if(!previews.length)throw new HttpsError("failed-precondition","Các thẻ đã rảnh hoặc chưa đủ điều kiện gỡ.");
  const now=new Date().toISOString();
  await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.exists){const old=current.data() as CardReturnJob;
    if(old.createdBy!==userId||old.shopId!==shopId||old.warehouseId!==warehouseId||old.requestHash!==requestHash)throw new HttpsError("already-exists","Mã lô đã được dùng cho danh sách khác.");return;}
    const job:CardReturnJob={jobId,requestHash,shopId,warehouseId,createdBy:userId,deviceId,status:"QUEUED",items:previews.map(owner=>({operationId:randomUUID(),owner,state:"READY",attempts:0,lastError:null,mutationSent:false})),lease:null,createdAt:now,updatedAt:now};tx.create(ref,job);});
  return {jobId};
}
export async function fetchMemberCardReturnJobForUser(userId:string,data:unknown) {
  const {shopId,warehouseId,value}=await access(userId,data);const id=String(value.jobId??"");if(!/^[a-fA-F0-9-]{36}$/.test(id))throw new HttpsError("invalid-argument","Mã lô không hợp lệ.");
  const job=(await returnJobRef(id).get()).data() as CardReturnJob|undefined;
  if(!job||job.shopId!==shopId||job.warehouseId!==warehouseId)throw new HttpsError("not-found","Không tìm thấy lô ở điểm bán hiện tại.");return {job};
}
export async function controlMemberCardReturnJobForUser(userId:string,data:unknown){
  const {job}=await fetchMemberCardReturnJobForUser(userId,data);const action=(data as {action?:unknown}).action;
  if(action!=="PAUSE"&&action!=="RETRY")throw new HttpsError("invalid-argument","Thao tác lô không hợp lệ.");
  await db.runTransaction(async tx=>{const latest=(await tx.get(returnJobRef(job.jobId))).data() as CardReturnJob;
    if(action==="RETRY"&&latest.lease&&latest.lease.expiresAt>Date.now())throw new HttpsError("aborted","Lô đang xử lý, chưa thể thử lại.");
    const items=latest.items.map(item=>action==="RETRY"&&item.state==="NEEDS_REVIEW"?{...item,state:item.knownRejected||item.mutationSent===false?"READY" as const:"UNKNOWN" as const,lastError:null,attempts:0}:item);
    tx.update(returnJobRef(job.jobId),{items,status:action==="PAUSE"?"PAUSED":"QUEUED",updatedAt:new Date().toISOString()});});return {jobId:job.jobId};
}
