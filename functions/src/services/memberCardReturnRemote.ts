import { HttpsError } from "firebase-functions/v2/https";
import { cashierRequest, MemberCardIssueError } from "./joyworldMemberCardService";
import { fetchRemoteMemberCards } from "./hkApiService";
export interface CardReturnOwner {
  uid: string; mid: string; memberCode: string; cardUuid: string; memberCardId: string;
  fullName: string; phone: string; memberLevelType: number; shopId: number;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {}; }
export async function fetchCardReturnOwner(shopId: number, memberCode: string): Promise<CardReturnOwner | null> {
  let response;
  try { response = await cashierRequest({shopId,path:"/member/cashier/member/getmember/list",method:"POST",body:{keywords:memberCode,isReadCard:true}}); }
  catch (error) {
    if (error instanceof MemberCardIssueError && error.code === "HK_OPERATION_REJECTED" && /^(Không tìm thấy thông tin thành viên|未找到会员信息|没有找到会员信息|Member information not found)\.?$/i.test(error.message.trim())) return null;
    throw error;
  }
  if (!Array.isArray(response.data)) throw new HttpsError("unavailable","HK không trả danh sách chủ thẻ hợp lệ.");
  if (!response.data.length) return null;
  const matches = response.data.map(record);
  const selected = matches.find(item=>item.memberCode === memberCode) ?? (matches.length === 1 ? matches[0] : null);
  if (!selected || typeof selected.memberAcctId !== "string") throw new HttpsError("failed-precondition","Chưa xác định được đúng chủ thẻ.");
  const uid = selected.memberAcctId;
  const details = record((await cashierRequest({shopId,path:"/member/cashier/member/getdetails",query:{memberAcctId:uid,isFilterZeroValue:"false"}})).data);
  if (Number(details.shopId ?? selected.shopId) !== shopId) throw new HttpsError("permission-denied","Thẻ không thuộc cửa hàng được chọn.");
  const cards = Array.isArray(details.memberCardOutputs) ? details.memberCardOutputs.map(record) : [];
  const card = cards.find(item=>item.memberCode===memberCode);
  if (!card || typeof card.icCard !== "string") throw new HttpsError("failed-precondition","HK chưa xác nhận liên kết mã thẻ/chip.");
  const mid=String(details.memberId ?? selected.memberId ?? ""),linkId=String(card.memberCardId ?? card.id ?? "");
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)||!/^[a-zA-Z0-9_-]{1,128}$/.test(mid)||!linkId)throw new HttpsError("failed-precondition","HK thiếu định danh tài khoản/quan hệ thẻ để đối chiếu an toàn.");
  if (Number(details.memberLevelType ?? selected.memberLevelType) !== 1) throw new HttpsError("failed-precondition","Chỉ hỗ trợ thẻ thành viên thông thường. Thẻ khách vãng lai/đặc biệt chưa được phép gỡ.");
  // HK permits returning a linked card while its member remains disabled.
  // Card ownership and member type are sufficient; never enable the member here.
  return {uid,mid,memberCode,cardUuid:card.icCard.toUpperCase(),memberCardId:linkId,fullName:String(details.realName ?? selected.realName ?? ""),phone:String(details.phone ?? selected.phone ?? ""),memberLevelType:1,shopId};
}
export async function verifyReturnedCard(shopId: number, owner: CardReturnOwner): Promise<string | null> {
  const cards = await fetchRemoteMemberCards(owner.uid);
  if (!cards.success || !Array.isArray(cards.data)) throw new HttpsError("unavailable","Chưa thể đối chiếu danh sách thẻ của thành viên.");
  if (cards.data.some(card=>card.memberCode===owner.memberCode)) throw new HttpsError("unavailable","Thẻ vẫn còn liên kết trên HK; chưa xác nhận đã gỡ.");
  const current = await fetchCardReturnOwner(shopId,owner.memberCode);
  if (current) throw new HttpsError("failed-precondition","Thẻ đã có chủ mới hoặc liên kết khác; không được gỡ lại.");
  await cashierRequest({shopId,path:"/member/cashier/membercard/take/check",query:{memberCode:owner.memberCode}});
  return cards.data.find(card=>typeof card.memberCode === "string" && card.memberCode)?.memberCode ?? null;
}

export async function returnVerifiedCashierCard(shopId: number, owner: CardReturnOwner, bizCode: string) {
  return cashierRequest({shopId,path:"/member/cashier/MemberCard/return/confirm",method:"POST",bizCode,
    body:{memberCode:owner.memberCode,memberId:owner.mid,isReturnDeposit:false}});
}
