import { HttpsError } from "firebase-functions/v2/https";
import { assertWarehouseAccess } from "../member/functions";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { assertMemberEditAccess, assertMemberShopScope } from "./memberProfileEditService";
import { cashierRequest, MemberCardIssueError } from "./joyworldMemberCardService";
import { cardLockRef, cardMemberLockRef } from "./memberCardLinkLocks";
import { recoveryInput, recoveryId, assertRecoveryCard, assertRecoveryOwner, recoveryPreviewToken, assertRecoveryPreview } from "./partnerCardRecoveryPolicy";
import type { PartnerCardRecovery, PartnerCardRecoveryView } from "../types/partnerCardRecovery";

export const recoveryRef = (id: string) => db.collection(POS_COLLECTIONS.partnerCardRecoveries).doc(id);
export function recoveryView(id: string, r: PartnerCardRecovery): PartnerCardRecoveryView {
  return { id, uid: r.uid, memberCode: r.memberCode, phone: r.phone, fullName: r.fullName,
    history: r.history, state: r.state, error: r.error ?? null, completedAt: r.completedAt ?? null };
}
async function access(actor: string, data: unknown) {
  const input = recoveryInput(data); assertMemberShopScope(input.shopId);
  await assertMemberEditAccess(actor, input.warehouseId, "pos.members.restore_card");
  return input;
}
export async function readRecoveryDetails(r: PartnerCardRecovery) {
  const response = await cashierRequest({ shopId: r.shopId, path: "/member/cashier/member/getdetails",
    query: { memberAcctId: r.uid, isFilterZeroValue: "false" } });
  return response.data as Record<string, unknown>;
}
export async function previewPartnerCardRecovery(actor: string, data: unknown) {
  const input = await access(actor, data), id = recoveryId(input.shopId, input.memberCode);
  const r = (await recoveryRef(id).get()).data() as PartnerCardRecovery | undefined;
  assertRecoveryCard(r, input);
  return previewKnownPartnerCard(actor, input, id, r);
}
async function previewKnownPartnerCard(actor: string, input: ReturnType<typeof recoveryInput>, id: string, r: PartnerCardRecovery) {
  const view = recoveryView(id, r);
  if (["QUEUED", "RUNNING", "COMPLETED"].includes(r.state)) return { recovery: view };
  const details = await readRecoveryDetails(r), state = assertRecoveryOwner(r, details);
  let dynamicSerialNo: string | null = null;
  if (!state.attached) {
    const available = await cashierRequest({ shopId: r.shopId, path: "/member/cashier/membercard/take/check", query: { memberCode: r.memberCode } });
    dynamicSerialNo = typeof available.data === "string" && available.data ? available.data : null;
  }
  return { recovery: { ...view, fullName: String(details.realName ?? r.fullName), phone: String(details.phone ?? r.phone),
    isEnabled: state.enabled, points: Number(details.coinBal2 ?? 0), canConfirm: true, dynamicSerialNo,
    previewToken: recoveryPreviewToken(actor, input, r.uid) } };
}
async function isCardCurrentlyLinked(shopId: number, memberCode: string): Promise<boolean> {
  let response;
  try {
    response = await cashierRequest({ shopId, path: "/member/cashier/member/getmember/list",
      method: "POST", body: { keywords: memberCode, isReadCard: true } });
  } catch (error) {
    if (error instanceof MemberCardIssueError && error.code === "HK_OPERATION_REJECTED" &&
      /^(Không tìm thấy thông tin thành viên|未找到会员信息|没有找到会员信息|Member information not found)\.?$/i.test(error.message.trim())) return false;
    throw error;
  }
  if (!Array.isArray(response.data) || response.data.some(entry =>
    !entry || typeof entry.memberAcctId !== "string" || !entry.memberAcctId.trim())) {
    throw new HttpsError("unavailable", "HK chưa xác nhận được chủ thẻ hiện tại. Vui lòng đọc lại thẻ.");
  }
  return response.data.length > 0;
}
/** One eligibility read; only enrolled cards need a fresh HK ownership check. */
export async function detectPartnerCardRecovery(actor: string, data: unknown) {
  const input = recoveryInput(data); assertMemberShopScope(input.shopId);
  await assertWarehouseAccess(actor, input.warehouseId);
  const id = recoveryId(input.shopId, input.memberCode);
  const r = (await recoveryRef(id).get()).data() as PartnerCardRecovery | undefined;
  if (!r) return { recovery: null };
  assertRecoveryCard(r, input);
  // The historical ledger does not own the card: a current HK link takes precedence,
  // including links created outside JPOS or after a completed recovery.
  if (await isCardCurrentlyLinked(input.shopId, input.memberCode)) return { recovery: null };
  try { await assertMemberEditAccess(actor, input.warehouseId, "pos.members.restore_card"); }
  catch (error) {
    if (!(error instanceof HttpsError) || error.code !== "permission-denied") throw error;
    return { recovery: { ...recoveryView(id, r), canConfirm: false, error: "Bạn chưa có quyền khôi phục thẻ đối tác. Hãy liên hệ quản lý." } };
  }
  return previewKnownPartnerCard(actor, input, id, r);
}
export async function fetchPartnerCardRecovery(actor: string, data: unknown) {
  const input = await access(actor, data), id = recoveryId(input.shopId, input.memberCode);
  const r = (await recoveryRef(id).get()).data() as PartnerCardRecovery | undefined;
  assertRecoveryCard(r, input);
  return { recovery: recoveryView(id, r) };
}
export async function confirmPartnerCardRecovery(actor: string, data: unknown, deviceId: string) {
  const input = await access(actor, data), id = recoveryId(input.shopId, input.memberCode), ref = recoveryRef(id);
  await db.runTransaction(async tx => {
    const r = (await tx.get(ref)).data() as PartnerCardRecovery | undefined;
    assertRecoveryCard(r, input);
    if (["COMPLETED", "QUEUED", "RUNNING"].includes(r.state)) return;
    assertRecoveryPreview(actor, input, r.uid);
    const card = cardLockRef(r.shopId, r.memberCode), account = cardMemberLockRef(r.uid);
    const locks = await tx.getAll(card, account);
    for (const snapshot of locks) {
      const lock = snapshot.data();
      if (lock && lock.recoveryId !== id && (lock.kind === "RETURN" || Number(lock.expiresAt) > Date.now())) throw new HttpsError("aborted", "Thẻ hoặc thành viên đang có thao tác khác.");
    }
    // RETURN locks also block existing card issue/return workflows until reconciliation.
    const lock = { kind: "RETURN", recoveryId: id, token: id };
    tx.set(card, lock); tx.set(account, lock);
    tx.update(ref, { state: "QUEUED", requestedBy: actor, warehouseId: input.warehouseId, deviceId,
      error: null, updatedAt: new Date().toISOString(), history: [...r.history, { label: "Xác nhận khôi phục tại quầy", at: new Date().toISOString() }] });
  });
  return fetchPartnerCardRecovery(actor, data);
}
