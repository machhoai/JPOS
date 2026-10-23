import { createHash, randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { recoveryRef, readRecoveryDetails } from "../services/partnerCardRecoveryService";
import { assertRecoveryOwner } from "../services/partnerCardRecoveryPolicy";
import { cardLockRef, cardMemberLockRef } from "../services/memberCardLinkLocks";
import { cashierRequest, type CashierRequest, type JoyworldResponse } from "../services/joyworldMemberCardService";
import { attachRecoveredCard, enableRecoveredMember, checkRecoveryAvailability } from "../services/partnerCardRecoveryRemote";
import { assertMemberEditAccess, assertMemberShopScope } from "../services/memberProfileEditService";
import { joyworldUserSecret, joyworldPassSecret } from "../services/joyworldCatalogService";
import { fetchRemoteMemberList } from "../services/hkApiService";
import { importHash, importShard, normalizeImportRow } from "./memberImportPolicy";
import type { PartnerCardRecovery } from "../types/partnerCardRecovery";

export async function processPartnerCardRecovery(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Mã khôi phục không hợp lệ.");
  const ref = recoveryRef(id), token = randomUUID();
  const r = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as PartnerCardRecovery | undefined;
    if (!current || !["QUEUED", "RUNNING"].includes(current.state)) return null;
    if (current.lease && current.lease.expiresAt > Date.now()) throw new HttpsError("aborted", "Tiến trình đang xử lý.");
    tx.update(ref, { state: "RUNNING", lease: { token, expiresAt: Date.now() + 6 * 60_000 } });
    return current;
  });
  if (!r) return;
  const cardRef = cardLockRef(r.shopId, r.memberCode), accountRef = cardMemberLockRef(r.uid);
  async function checkpoint(patch: Record<string, unknown>) {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as PartnerCardRecovery;
      if (current.lease?.token !== token) throw new Error("Lease đã đổi.");
      tx.update(ref, { ...patch, updatedAt: new Date().toISOString() });
    });
  }
  try {
    assertMemberShopScope(r.shopId);
    await assertMemberEditAccess(r.requestedBy!, r.warehouseId!, "pos.members.restore_card");
    const lockSnapshots = await db.getAll(cardRef, accountRef);
    if (lockSnapshots.some(s => s.data()?.recoveryId !== id)) throw new Error("Khóa khôi phục đã thay đổi.");
    const details = await readRecoveryDetails(r), state = assertRecoveryOwner(r, details);
    const balanceFields = ["nativeCoin1", "giveCoin1", "giveCoin1A", "giveCoin1B", "coinBal2", "integral", "lottery", "blueLottery", "timePointValue", "timeCoinBal1", "storeExtend01", "storeExtend02", "storeExtend03", "storeExtend04", "storeExtend05", "money"];
    const balances = (value: Record<string, unknown>) => Object.fromEntries(balanceFields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
    const balanceBefore = r.balanceBefore ?? balances(details);
    if (!r.balanceBefore) await checkpoint({ balanceBefore });
    const journal = { ...r.requests };
    if (!state.attached && Object.values(journal).some(x => x.state === "SENDING")) throw new Error("Lần gắn trước chưa rõ kết quả. Cần quản lý đối chiếu, không gửi lại tự động.");
    // Before any enable, verify this physical card has no new owner on HK.
    if (!state.attached) await checkRecoveryAvailability(r);
    if (!state.enabled) {
      await checkpoint({ enableSent: true });
      await enableRecoveredMember(r);
    }
    const request = async (input: CashierRequest): Promise<JoyworldResponse> => {
      if (input.method !== "POST") {
        const result = await cashierRequest(input);
        if (input.path.endsWith("/take/deposit")) {
          const configs = result.data as { amount?: number }[];
          if (!Array.isArray(configs) || configs.length !== 1 || Number(configs[0].amount) !== 0) throw new Error("Khôi phục chỉ hỗ trợ thẻ có giá/cọc bằng 0; cần quản lý xử lý cấu hình hiện tại.");
        }
        return result;
      }
      const key = createHash("sha256").update(input.path).digest("hex").slice(0, 24);
      const hash = createHash("sha256").update(JSON.stringify(input.body)).digest("hex");
      const prior = journal[key];
      if (prior) {
        if (prior.hash !== hash || prior.state !== "DONE") throw new Error("Yêu cầu trước chưa được xác nhận. Không lặp lại thao tác HK.");
        return prior.response as JoyworldResponse;
      }
      journal[key] = { hash, state: "SENDING" }; await checkpoint({ requests: journal });
      const result = await cashierRequest({ ...input, bizCode: `${id.slice(0, 32)}-${key}` });
      journal[key] = { hash, state: "DONE", response: result as Record<string, unknown> }; await checkpoint({ requests: journal });
      return result;
    };
    await attachRecoveredCard(r, request);
    const after = await readRecoveryDetails(r), final = assertRecoveryOwner(r, after);
    if (!final.attached || !final.enabled) throw new Error("HK chưa xác nhận đủ bật tài khoản và gắn lại đúng thẻ.");
    if (JSON.stringify(balanceBefore) !== JSON.stringify(balances(after))) throw new Error("Số dư đã thay đổi trong lúc khôi phục. Cần quản lý đối chiếu; hệ thống không tự nạp bù hoặc trừ số dư.");
    const list = await fetchRemoteMemberList({ page: 1, limit: 1000, phone: String(after.phone) });
    const matches = list.data?.filter(v => v.memberAcctId === r.uid && Number(v.shopId) === r.shopId);
    if (!list.success || matches?.length !== 1) throw new Error("Đã gắn thẻ nhưng chưa đọc được snapshot để đồng bộ POS.");
    const row = normalizeImportRow(matches[0], r.shopId);
    const cards = row.memberCardList as { memberCode: string; icCard: string }[];
    if (row.isEnabled !== true || !Array.isArray(cards) || cards.length !== 1 || cards[0].memberCode !== r.memberCode || cards[0].icCard.toUpperCase() !== r.cardUuid) throw new Error("Snapshot HK không khớp kết quả khôi phục.");
    const memberRef = db.collection(POS_COLLECTIONS.members).doc(r.uid);
    const shardRef = db.collection(POS_COLLECTIONS.memberImportState).doc(`${r.shopId}-shard-${importShard(r.uid)}`);
    await db.runTransaction(async tx => {
      const [current, member, shard, cardLock, accountLock] = await tx.getAll(ref, memberRef, shardRef, cardRef, accountRef);
      if (current.data()?.lease?.token !== token || cardLock.data()?.recoveryId !== id || accountLock.data()?.recoveryId !== id) throw new Error("Khóa đã đổi trước khi lưu kết quả.");
      const local = member.data();
      if (!local || local.remoteUid !== r.uid || local.shopId !== r.shopId) throw new Error("Hồ sơ POS không khớp UID/cửa hàng HK.");
      if (local.syncLease?.expiresAt > new Date().toISOString() || (local.memberCode && local.memberCode !== r.memberCode)) throw new Error("Hồ sơ POS đang có thao tác khác.");
      const now = new Date().toISOString(), hash = importHash(row);
      tx.update(memberRef, { memberCode: r.memberCode, hkSnapshot: row, hkImportHash: hash, hkImportedAt: now, cardLinksUpdatedAt: now });
      if (shard.exists) tx.update(shardRef, { hashes: { ...shard.data()?.hashes, [r.uid]: hash } });
      tx.update(ref, { state: "COMPLETED", lease: null, completedAt: now, error: null, updatedAt: now,
        history: [...r.history, { label: "Khôi phục tại quầy", at: now }] });
      tx.delete(cardRef); tx.delete(accountRef);
    });
  } catch (error) {
    await checkpoint({ state: "NEEDS_REVIEW", lease: null, error: error instanceof Error ? error.message : "Khôi phục chưa hoàn tất. Cần đối chiếu." });
    // Keep locks until HK and local are reconciled; never blindly undo an uncertain attach.
  }
}
export const onPartnerCardRecovery = onDocumentWritten({ document: `${POS_COLLECTIONS.partnerCardRecoveries}/{id}`,
  region: "asia-southeast1", timeoutSeconds: 300, maxInstances: 2, retry: true,
  secrets: [joyworldUserSecret, joyworldPassSecret] }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (after?.state === "QUEUED" && before?.state !== "QUEUED") await processPartnerCardRecovery(event.params.id);
});
