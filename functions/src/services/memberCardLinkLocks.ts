import { createHash, randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
export function cardLockRef(shopId:number,memberCode:string) {
  return db.collection(POS_COLLECTIONS.memberCardLocks).doc(createHash("sha256").update(`${shopId}:${memberCode}`).digest("hex"));
}
export function cardMemberLockRef(uid:string) { return db.collection(POS_COLLECTIONS.memberCardLocks).doc(`member-${uid}`); }
export async function withCardIssueLock<T>(shopId:number,uid:string,memberCode:string,run:()=>Promise<T>):Promise<T> {
  const ref=cardLockRef(shopId,memberCode),member=cardMemberLockRef(uid),token=randomUUID();
  await db.runTransaction(async tx=>{
    const card=await tx.get(ref),account=await tx.get(member);
    for(const snapshot of [card,account]) {
      const lock=snapshot.data();
      if(lock&&(lock.kind==="RETURN"||Number(lock.expiresAt)>Date.now()))throw new HttpsError("aborted","Thẻ/thành viên đang được xử lý hoặc đối chiếu. Vui lòng chờ trước khi gắn thẻ.");
    }
    const lock={kind:"ISSUE",token,expiresAt:Date.now()+3*60_000};tx.set(ref,lock);tx.set(member,lock);
  });
  const result=await run();
  await db.runTransaction(async tx=>{const a=await tx.get(ref),b=await tx.get(member);if(a.data()?.token===token)tx.delete(ref);if(b.data()?.token===token)tx.delete(member);});
  // An uncertain issue retains its short lease instead of opening a race.
  return result;
}
