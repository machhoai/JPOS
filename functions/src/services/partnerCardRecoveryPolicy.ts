import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import type { PartnerCardRecovery } from "../types/partnerCardRecovery";

export const recoveryId = (shopId: number, code: string) => createHash("sha256").update(`${shopId}:${code}`).digest("hex");
export function recoveryInput(data: unknown) {
  const v = data as { shopId?: number; warehouseId?: string; memberCode?: string; cardUuid?: string; previewToken?: string } | null;
  if (!v || !Number.isInteger(v.shopId) || !v.warehouseId || v.warehouseId.length > 128 ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(v.memberCode ?? "") || !/^[a-fA-F0-9]{8,128}$/.test(v.cardUuid ?? "")) {
    throw new HttpsError("invalid-argument", "Cần đọc đủ mã thẻ và chip vật lý.");
  }
  return { shopId: v.shopId!, warehouseId: v.warehouseId, memberCode: v.memberCode!, cardUuid: v.cardUuid!.toUpperCase(), previewToken: v.previewToken };
}
export function assertRecoveryCard(record: PartnerCardRecovery | undefined, input: ReturnType<typeof recoveryInput>): asserts record is PartnerCardRecovery {
  if (!record || record.schemaVersion !== 1 || record.shopId !== input.shopId || record.memberCode !== input.memberCode || record.cardUuid !== input.cardUuid) {
    throw new HttpsError("not-found", "Thẻ này không nằm trong danh sách 600 thẻ đối tác đã lưu.");
  }
}
function signature(payload: string) {
  if (!process.env.HK_API_KEY) throw new HttpsError("failed-precondition", "Chưa cấu hình xác minh thẻ.");
  return createHmac("sha256", process.env.HK_API_KEY).update(`partner-recovery:${payload}`).digest("hex");
}
export function recoveryPreviewToken(actor: string, input: ReturnType<typeof recoveryInput>, uid: string) {
  const payload = Buffer.from(JSON.stringify({ actor, ...input, previewToken: undefined, uid, expires: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function assertRecoveryPreview(actor: string, input: ReturnType<typeof recoveryInput>, uid: string) {
  const [payload, sign] = (input.previewToken ?? "").split(".");
  if (!payload || payload.length > 4000 || !/^[a-f0-9]{64}$/.test(sign ?? "") || !timingSafeEqual(Buffer.from(sign), Buffer.from(signature(payload)))) throw new HttpsError("failed-precondition", "Hãy đọc và đối chiếu lại thẻ trước khi xác nhận.");
  const v = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (v.actor !== actor || v.shopId !== input.shopId || v.warehouseId !== input.warehouseId || v.uid !== uid || v.memberCode !== input.memberCode || v.cardUuid !== input.cardUuid || v.expires < Date.now()) throw new HttpsError("failed-precondition", "Đối chiếu thẻ đã hết hạn hoặc khác điểm bán.");
}
export function assertRecoveryOwner(record: PartnerCardRecovery, details: Record<string, unknown>) {
  if (details.memberAcctId !== record.uid || details.memberId !== record.mid || Number(details.shopId) !== record.shopId || Number(details.memberLevelType) !== 1) throw new HttpsError("failed-precondition", "Tài khoản gốc đã thay đổi hoặc không phải thành viên thông thường.");
  if (!Array.isArray(details.memberCardOutputs) || typeof details.isEnabled !== "boolean") throw new HttpsError("unavailable", "HK chưa trả đủ trạng thái tài khoản.");
  const cards = details.memberCardOutputs as { memberCode: string; icCard: string }[];
  if (cards.some(c => c.memberCode !== record.memberCode || c.icCard.toUpperCase() !== record.cardUuid)) throw new HttpsError("failed-precondition", "Tài khoản có thẻ khác. Cần quản lý đối chiếu trước khi bật lại.");
  return { attached: cards.length === 1, enabled: details.isEnabled };
}
