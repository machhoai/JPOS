import { createHash, randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { createMemberOpenId, type MemberRegistrationInput } from "../member/memberPolicy";
import { fetchRemoteMemberByPhone, registerRemoteMember } from "./hkApiService";
import { parseStoredMemberProfile } from "./memberRepository";
import type { RegistrationIntent, RegistrationProcessingResult } from "../types/memberRegistration";
import type { StoredMemberProfile } from "../types/member";

export function registrationId(shopId: number, phone: string): string {
  return createHash("sha256").update(`${shopId}:${phone}`).digest("hex");
}
const intentRef = (id: string) => db.collection(POS_COLLECTIONS.memberRegistrations).doc(id);
export async function createRegistrationIntent(input: MemberRegistrationInput, userId: string, deviceId: string, operationId: string) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(operationId)) throw new HttpsError("invalid-argument", "Mã đăng ký không hợp lệ.");
  const id = registrationId(input.shopId, input.phone);
  const ref = intentRef(id);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as RegistrationIntent | undefined;
    if (existing) {
      if (existing.warehouseId !== input.warehouseId) throw new HttpsError("failed-precondition", "Số điện thoại đã có yêu cầu tại điểm bán khác. Cần đối chiếu trước khi tạo lại.");
      if (existing.fingerprint !== fingerprint) throw new HttpsError("failed-precondition", "Số điện thoại đã có yêu cầu đăng ký. Hãy phục hồi yêu cầu cũ trước khi đổi thông tin.");
      return;
    }
    const local = await tx.get(db.collection(POS_COLLECTIONS.members).where("shopId", "==", input.shopId).where("phone", "==", input.phone).limit(1));
    if (!local.empty) throw new HttpsError("already-exists", "Số điện thoại đã có thành viên trong dữ liệu POS. Hãy dùng chức năng tra cứu.");
    const now = new Date().toISOString();
    const intent: RegistrationIntent = { input, operationId, userId, deviceId, fingerprint,
      shopId: input.shopId, warehouseId: input.warehouseId, phone: input.phone, fullName: input.fullName,
      state: "PREPARED", remoteUid: null, mid: null, lease: null, attempts: 0, lastError: null, createdAt: now, updatedAt: now };
    tx.create(ref, intent);
  });
  return id;
}

export async function processRegistration(id: string, automatic = false): Promise<RegistrationProcessingResult> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "Yêu cầu đăng ký không hợp lệ.");
  const ref = intentRef(id);
  const token = randomUUID();
  let intent = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data() as RegistrationIntent | undefined;
    if (!current) throw new HttpsError("not-found", "Không tìm thấy yêu cầu đăng ký.");
    if (current.state === "COMPLETED") return current;
    if (current.state === "NEEDS_REVIEW" && automatic) throw new HttpsError("failed-precondition", "Yêu cầu cần đối chiếu thủ công.");
    if (current.lease && current.lease.expiresAt > Date.now()) throw new HttpsError("aborted", "Đăng ký đang được xử lý. Vui lòng thử lại sau.");
    const next = { ...current, lease: { token, expiresAt: Date.now() + 180_000 }, attempts: current.attempts + 1, updatedAt: new Date().toISOString() };
    tx.update(ref, { lease: next.lease, attempts: next.attempts, updatedAt: next.updatedAt });
    tx.create(ref.collection("attempts").doc(token), { status: "STARTED", attempt: next.attempts, state: current.state, createdAt: next.updatedAt });
    return next;
  });
  if (intent.state === "COMPLETED") {
    const member = await db.collection(POS_COLLECTIONS.members).doc(intent.remoteUid!).get();
    if (!member.exists) throw new HttpsError("data-loss", "Hồ sơ hoàn tất đã bị mất. Cần quản trị viên đối chiếu.");
    return { intent, profile: parseStoredMemberProfile(member.id, member.data()) };
  }
  async function checkpoint(patch: Partial<RegistrationIntent>) {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as RegistrationIntent;
      if (current.lease?.token !== token) throw new HttpsError("aborted", "Phiên xử lý đăng ký đã thay đổi.");
      tx.update(ref, { ...patch, updatedAt: new Date().toISOString() });
      tx.update(ref.collection("attempts").doc(token), { state: patch.state ?? current.state, lastError: patch.lastError ?? null,
        ...(patch.lastError ? {status:patch.state === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "RETRY_WAIT"} : {}), updatedAt: new Date().toISOString() });
    });
    intent = { ...intent, ...patch };
  }
  try {
    if (intent.state === "PREPARED") {
      // Durable marker precedes the one permitted create request. A crash/timeout
      // after this marker is reconciled using reads, never another blind join.
      await checkpoint({ state: "HK_IN_FLIGHT" });
      const response = await registerRemoteMember({ openId: createMemberOpenId(intent.phone), phone: intent.phone, realName: intent.fullName });
      const uid = response.data?.uid?.trim();
      if (!response.success || !uid || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) throw new HttpsError("unavailable", "HK chưa xác nhận đăng ký. Đã lưu yêu cầu để đối chiếu, không tự tạo lại.");
      await checkpoint({ state: "HK_CONFIRMED", remoteUid: uid, mid: response.data?.mid?.trim() || null });
    }
    if (!intent.remoteUid) {
      const response = await fetchRemoteMemberByPhone({ shopId: intent.shopId, phone: intent.phone });
      const data = response.data;
      const scoped = data?.items?.find(item => Number(item.shopId) === intent.shopId);
      const uid = scoped?.uid?.trim();
      if (!response.success || !uid || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid) || data?.phone?.trim() !== intent.phone) throw new HttpsError("unavailable", "Chưa đối chiếu được kết quả HK. Yêu cầu vẫn được lưu để phục hồi.");
      const linked = (await db.collection(POS_COLLECTIONS.members).doc(uid).get()).data();
      if (linked && (linked.shopId !== intent.shopId || linked.phone !== intent.phone)) {
        throw new HttpsError("failed-precondition", "HK trả tài khoản đang có thông tin khác trong POS. Cần đối chiếu trước khi xác nhận đăng ký.");
      }
      await checkpoint({ state: "HK_CONFIRMED", remoteUid: uid, mid: data?.mid?.trim() || null });
    }
    const memberRef = db.collection(POS_COLLECTIONS.members).doc(intent.remoteUid!);
    const profile = await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as RegistrationIntent;
      const snapshot = await tx.get(memberRef);
      if (current.lease?.token !== token) throw new HttpsError("aborted", "Phiên xử lý đăng ký đã thay đổi.");
      const existing = snapshot.exists ? parseStoredMemberProfile(snapshot.id, snapshot.data()) : null;
      if (existing && (existing.shopId !== intent.shopId || (existing.warehouseId !== intent.warehouseId && !existing.hkImportUnassigned))) throw new HttpsError("failed-precondition", "Hồ sơ HK/local khác phạm vi đăng ký. Cần đối chiếu.");
      const now = new Date().toISOString();
      const stored: StoredMemberProfile = existing ?? { ...intent.input, schemaVersion: 1, remoteUid: intent.remoteUid!, mid: intent.mid, memberCode: null,
        createdBy: intent.userId, updatedBy: intent.userId, createdAt: now, updatedAt: now, lastRemoteSyncAt: now };
      if (!existing) tx.create(memberRef, stored);
      tx.update(ref, { state: "COMPLETED", lease: null, lastError: null, updatedAt: now });
      tx.update(ref.collection("attempts").doc(token), { status: "COMPLETED", state: "COMPLETED", updatedAt: now });
      return stored;
    });
    return { intent: { ...intent, state: "COMPLETED" }, profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể phục hồi đăng ký.";
    try { await checkpoint({ lease: null, lastError: message, ...(intent.attempts >= 6 ? { state: "NEEDS_REVIEW" as const } : {}) }); } catch { /* Lease expiry allows recovery after a Firestore outage. */ }
    throw new HttpsError("unavailable", `${message} Vui lòng thử lại với cùng thông tin đăng ký.`, { registrationId: id, operationId: intent.operationId, recoverable: true });
  }
}
