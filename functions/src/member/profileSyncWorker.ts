import { createHash, randomUUID } from "node:crypto";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { changesRef, memberRef, assertMemberEditAccess, assertMemberShopScope } from "../services/memberProfileEditService";
import { fetchRemoteMemberByUid, updateRemoteMemberPhone, updateRemoteMemberProfile } from "../services/hkApiService";
import { mapMemberLookup } from "../services/memberMapper";
import { editableProfile, profileConflict, profilePayload } from "./profileEditPolicy";
import type { MemberProfileChange, MemberEditableProfile, MemberProfileSyncStatus } from "../types/memberProfileEdit";
import type { StoredMemberProfile } from "../types/member";

const ACTIVE = ["PENDING", "SYNCING", "PARTIAL", "RETRY_WAIT", "UNKNOWN", "NEEDS_ACTION"];
async function readRemote(change: MemberProfileChange) {
  const response = await fetchRemoteMemberByUid(change.memberUid);
  if (!response.success || !response.data || response.data.uid !== change.memberUid) {
    throw new HttpsError("unavailable", "Không thể đối chiếu hồ sơ thành viên trên HK.");
  }
  return editableProfile(mapMemberLookup(response.data, { shopId: change.shopId }));
}
export async function synchronizeMemberProfile(uid: string): Promise<void> {
  const token = randomUUID();
  const claim = await db.runTransaction(async tx => {
    const profile = await tx.get(memberRef(uid));
    const stored = profile.data() as StoredMemberProfile | undefined;
    if (!stored) return null;
    // Personal fields can be shared by MID across shop accounts: never send them concurrently.
    const lockRef = db.collection(POS_COLLECTIONS.memberProfileLocks).doc(createHash("sha256").update(stored.mid || uid).digest("hex"));
    const sharedLock = await tx.get(lockRef);
    const now = new Date().toISOString();
    if (stored.syncLease && stored.syncLease.expiresAt > now) return null;
    if (sharedLock.data()?.expiresAt > now) return null;
    const queue = await tx.get(changesRef().where("memberUid", "==", uid).where("status", "in", ACTIVE).orderBy("revision").limit(1));
    if (queue.empty) return null;
    const change = queue.docs[0].data() as MemberProfileChange;
    if (change.status === "NEEDS_ACTION" || change.nextAttemptAt > now) {
      const followers = await tx.get(changesRef().where("memberUid", "==", uid).where("status", "in", ["PENDING", "PARTIAL", "RETRY_WAIT", "UNKNOWN"]).limit(40));
      const nextAttemptAt = change.status === "NEEDS_ACTION" ? new Date(Date.now() + 30 * 60_000).toISOString() : change.nextAttemptAt;
      for (const follower of followers.docs) if (follower.id !== change.operationId) tx.update(follower.ref, { nextAttemptAt });
      tx.update(profile.ref, { syncStatus: change.status });
      return null;
    }
    const uncertain = change.status === "UNKNOWN" || (change.status === "SYNCING" && Boolean(change.inFlightStep));
    tx.update(profile.ref, { syncStatus: "SYNCING", syncLease: { token, expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() } });
    tx.set(lockRef, { token, expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    tx.update(queue.docs[0].ref, { status: "SYNCING", attemptCount: change.attemptCount + 1, updatedAt: now });
    return { change: { ...change, attemptCount: change.attemptCount + 1 }, stored, uncertain, lockRef };
  });
  if (!claim) return;
  const { change, stored, uncertain } = claim;
  let mutationSent = false;
  let remote: MemberEditableProfile | null = null;
  let status: MemberProfileSyncStatus = "SYNCED";
  let errorMessage: string | null = null;
  const events: { action: string; success: boolean; code?: number; message?: string }[] = [];
  async function checkpoint(step: "phoneStep" | "profileStep") {
    await db.runTransaction(async tx => {
      const current = await tx.get(memberRef(uid));
      if (current.data()?.syncLease?.token !== token) throw new HttpsError("aborted", "Phiên đồng bộ đã thay đổi.");
      tx.update(changesRef().doc(change.operationId), { [step]: "DONE", inFlightStep: null, updatedAt: new Date().toISOString() });
    });
    change[step] = "DONE";
    change.inFlightStep = null;
  }
  async function markInFlight(step: "phone" | "profile" | null) {
    await db.runTransaction(async tx => {
      const current = await tx.get(memberRef(uid));
      if (current.data()?.syncLease?.token !== token) throw new HttpsError("aborted", "Phiên đồng bộ đã thay đổi.");
      tx.update(changesRef().doc(change.operationId), { inFlightStep: step });
    });
    change.inFlightStep = step;
  }
  try {
    assertMemberShopScope(change.shopId);
    await assertMemberEditAccess(change.createdBy, change.warehouseId, "pos.members.edit");
    remote = await readRemote(change);
    const expected = change.resolvesOperationId ? remote : stored.remoteSnapshot ?? change.before;
    if (uncertain) {
      const step = change.inFlightStep;
      if (step === "phone" && remote.phone === change.after.phone) await checkpoint("phoneStep");
      if (step === "profile" && change.changedFields.filter(field => field !== "phone").every(field => remote![field] === change.after[field])) await checkpoint("profileStep");
      if (change.inFlightStep) {
        status = "UNKNOWN";
        throw new HttpsError("aborted", "Kết quả lần gửi trước chưa xác định. Cần đối chiếu HK trước khi gửi lại; các thay đổi sau đang chờ.");
      }
    }
    if (profileConflict(change, expected, remote)) throw new HttpsError("failed-precondition", "Hồ sơ HK khác bản đã xác minh. Cần đối chiếu thay đổi bên ngoài POS.");
    if (change.phoneStep !== "DONE") {
      if (remote.phone !== change.after.phone) {
        await markInFlight("phone");
        mutationSent = true;
        const response = await updateRemoteMemberPhone(uid, change.after.phone);
        mutationSent = false;
        events.push({ action: "member_change_phone", success: response.success, code: response.code, message: response.msg || response.desc || "" });
        if (!response.success) { await markInFlight(null); throw new HttpsError("failed-precondition", /(trùng|occupied|duplicate|已占用)/i.test(response.msg || response.desc || "") ? "Số điện thoại đã tồn tại trên HK. Hãy sửa số và đồng bộ lại." : "HK từ chối thay đổi số điện thoại. Vui lòng đối chiếu tài khoản."); }
        remote = await readRemote(change);
        if (remote.phone !== change.after.phone) { await markInFlight(null); throw new HttpsError("failed-precondition", "HK chưa trả về số điện thoại đã yêu cầu."); }
      }
      await checkpoint("phoneStep");
    }
    if (change.profileStep !== "DONE") {
      const { body, target } = profilePayload(change, remote);
      if (!change.changedFields.filter(field => field !== "phone").every(field => remote![field] === target[field])) {
        await markInFlight("profile");
        mutationSent = true;
        const response = await updateRemoteMemberProfile(body);
        mutationSent = false;
        events.push({ action: "member_info_modify", success: response.success, code: response.code, message: response.msg || response.desc || "" });
        if (!response.success || response.data !== true) { await markInFlight(null); throw new HttpsError("failed-precondition", "HK từ chối cập nhật hồ sơ. Vui lòng kiểm tra thông tin thành viên."); }
        remote = await readRemote(change);
        // Verify preservation fields too; a successful response alone is insufficient.
        const mismatches = ["fullName", "nickName", "gender", "birthDate", "email"] as const;
        if (mismatches.some(field => remote![field] !== target[field])) { await markInFlight(null); throw new HttpsError("failed-precondition", "HK trả thành công nhưng thông tin đọc lại chưa khớp. Cần đối chiếu hồ sơ."); }
      }
      await checkpoint("profileStep");
    }
    remote = await readRemote(change);
    if (change.changedFields.some(field => remote![field] !== change.after[field])) throw new HttpsError("failed-precondition", "Thông tin HK chưa khớp thay đổi đã lưu.");
  } catch (error: unknown) {
    errorMessage = error instanceof HttpsError ? error.message : "Không thể kết nối HK. Hệ thống sẽ đối chiếu và thử lại.";
    if (status !== "UNKNOWN") {
      status = mutationSent || (Boolean(change.inFlightStep) && !(error instanceof HttpsError && error.code === "failed-precondition")) ? "UNKNOWN" : error instanceof HttpsError && ["failed-precondition", "permission-denied"].includes(error.code)
        ? "NEEDS_ACTION" : change.attemptCount >= 5 ? "NEEDS_ACTION"
          : change.phoneStep === "DONE" && change.profileStep !== "DONE" ? "PARTIAL" : "RETRY_WAIT";
    }
    logger.error("[Đồng bộ hồ sơ] Chưa hoàn tất", { operationId: change.operationId, status });
  }
  await db.runTransaction(async tx => {
    const current = await tx.get(memberRef(uid));
    const shared = await tx.get(claim.lockRef);
    if (current.data()?.syncLease?.token !== token) return;
    if (shared.data()?.token !== token) return;
    const now = new Date().toISOString();
    tx.update(changesRef().doc(change.operationId), {
      status, lastError: errorMessage, updatedAt: now, completedAt: status === "SYNCED" ? now : null,
      nextAttemptAt: new Date(Date.now() + (status === "UNKNOWN" ? 30 * 60_000 : Math.min(30, 2 ** change.attemptCount) * 60_000)).toISOString(),
    });
    tx.create(changesRef().doc(change.operationId).collection("attempts").doc(token), {
      status, error: errorMessage, events, phoneStep: change.phoneStep, profileStep: change.profileStep, createdAt: now,
    });
    tx.update(current.ref, {
      syncLease: null,
      syncStatus: status === "SYNCED" && current.data()?.profileRevision > change.revision ? "PENDING" : status,
      ...(status === "SYNCED" && remote && current.data()?.profileRevision === change.revision ? remote : {}),
      ...(status === "SYNCED" && remote ? { remoteSnapshot: remote, remoteConfirmedRevision: change.revision, lastRemoteSyncAt: now } : {}),
    });
    tx.update(claim.lockRef, { token: null, expiresAt: now });
  });
}

export const onMemberProfileChange = onDocumentWritten({
  document: `${POS_COLLECTIONS.memberProfileChanges}/{operationId}`, region: "asia-southeast1", timeoutSeconds: 240,
}, async event => {
  const after = event.data?.after.data() as MemberProfileChange | undefined;
  const before = event.data?.before.data() as MemberProfileChange | undefined;
  if (!after) return;
  if (!before || (after.status === "PENDING" && before.status !== "PENDING") || (after.status === "SYNCED" && before.status !== "SYNCED")) {
    await synchronizeMemberProfile(after.memberUid);
  }
});
export const retryMemberProfileChanges = onSchedule({ schedule: "every 1 minutes", region: "asia-southeast1", timeoutSeconds: 540 }, async () => {
  const due = await changesRef().where("status", "in", ACTIVE.filter(status => status !== "NEEDS_ACTION"))
    .where("nextAttemptAt", "<=", new Date().toISOString()).limit(40).get();
  const uids = [...new Set(due.docs.map(doc => String(doc.data().memberUid)))].slice(0, 8);
  // Bounded batches avoid sequential network timeouts consuming the scheduler budget.
  for (let index = 0; index < uids.length; index += 4) {
    const results = await Promise.allSettled(uids.slice(index, index + 4).map(synchronizeMemberProfile));
    if (results.some(result => result.status === "rejected")) logger.error("[Đồng bộ hồ sơ] Worker chưa hoàn tất một tác vụ.");
  }
});
