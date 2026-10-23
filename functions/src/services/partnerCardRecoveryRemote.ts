import { HttpsError } from "firebase-functions/v2/https";
import { generateHkApiRequest } from "../utils/hk-signature";
import { cashierRequest, purchaseComplimentaryMemberCard, type CashierRequest } from "./joyworldMemberCardService";
import { readRecoveryDetails } from "./partnerCardRecoveryService";
import { assertRecoveryOwner } from "./partnerCardRecoveryPolicy";
import type { PartnerCardRecovery } from "../types/partnerCardRecovery";

export async function enableRecoveredMember(r: PartnerCardRecovery, enabled = true) {
  const url = process.env.HK_API_BASE_URL;
  if (!url || url.includes("REMOTE_API_DOMAIN")) throw new Error("Chưa cấu hình HK thật.");
  const body = generateHkApiRequest({ action: "member_switch_status", version: "10.11.8",
    body: { uid: r.uid, employeeName: "JPOS", enable: enabled, remark: enabled ? "Khoi phuc the doi tac tai quay" : "Khoi phuc chua hoan tat, giu thanh vien tat" } });
  const endpoint = new URL(url);
  if (!endpoint.pathname.endsWith("/openapi/action")) endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/openapi/action";
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json() as { success?: boolean; msg?: string };
  if (!response.ok || data.success !== true) throw new HttpsError("unavailable", data.msg || "HK chưa xác nhận bật lại thành viên.");
}
export async function checkRecoveryAvailability(r: PartnerCardRecovery) {
  await cashierRequest({ shopId: r.shopId, path: "/member/cashier/membercard/take/check", query: { memberCode: r.memberCode } });
  const info = (await cashierRequest({ shopId: r.shopId, path: "/member/cashier/membercard/take/info", query: { memberAcctId: r.uid } })).data as { surplusQty?: number; maxReceiveCard?: number; takeCardNum?: number };
  if (!info || !Number.isFinite(info.surplusQty) || Number(info.surplusQty) < 0) throw new Error("HK thiếu thông tin lượt nhận thẻ.");
  if (Number(info.maxReceiveCard) > 0 && Number(info.takeCardNum) >= Number(info.maxReceiveCard)) throw new Error("Thành viên đã đạt giới hạn số thẻ.");
  if (info.surplusQty === 0) {
    const config = (await cashierRequest({ shopId: r.shopId, path: "/member/cashier/membercard/take/deposit", query: { memberAcctId: r.uid, scene: "4" } })).data as { amount?: number; storeCategory?: number }[];
    if (!Array.isArray(config) || config.length !== 1 || Number(config[0].amount) !== 0 || Number(config[0].storeCategory) !== 1) throw new Error("Cấu hình khôi phục cần giá/cọc bằng 0. Thành viên chưa được bật lại.");
  }
}
export async function attachRecoveredCard(r: PartnerCardRecovery, request: (input: CashierRequest) => ReturnType<typeof cashierRequest>) {
  let details = await readRecoveryDetails(r);
  let state = assertRecoveryOwner(r, details);
  if (!state.enabled) throw new HttpsError("failed-precondition", "Thành viên chưa được bật lại.");
  if (state.attached) return;
  const check = await request({ shopId: r.shopId, path: "/member/cashier/membercard/take/check", query: { memberCode: r.memberCode } });
  const info = (await request({ shopId: r.shopId, path: "/member/cashier/membercard/take/info", query: { memberAcctId: r.uid } })).data as { surplusQty?: number; maxReceiveCard?: number; takeCardNum?: number };
  if (!info || !Number.isFinite(info.surplusQty) || Number(info.surplusQty) < 0) throw new Error("HK thiếu thông tin lượt nhận thẻ.");
  if (Number(info.maxReceiveCard) > 0 && Number(info.takeCardNum) >= Number(info.maxReceiveCard)) throw new Error("Thành viên đã đạt giới hạn số thẻ.");
  if (info.surplusQty === 0) {
    if (typeof details.memberLevelId !== "string") throw new Error("HK thiếu cấp thành viên.");
    await purchaseComplimentaryMemberCard({ shopId: r.shopId, memberAcctId: r.uid, memberLevelId: details.memberLevelId, memberCode: r.memberCode, memberIcCard: r.cardUuid }, request);
    details = await readRecoveryDetails(r); state = assertRecoveryOwner(r, details);
    if (state.attached) return;
  }
  await request({ shopId: r.shopId, path: "/member/cashier/membercard/take/confirm", method: "POST", body: {
    memberAcctId: r.uid, cardInfoList: [{ memberICCard: r.cardUuid, memberCode: r.memberCode,
      ...(typeof check.data === "string" && check.data ? { dynamicSerialNo: check.data } : {}) }] } });
}
