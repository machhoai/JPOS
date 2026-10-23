import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { getPosAuthSession } from "./posAuthService";
import { getStoredMemberProfile } from "./memberRepository";
import { changedProfileFields, editableProfile, sameProfile, validateProfileEdit } from "../member/profileEditPolicy";
import type { MemberProfile, StoredMemberProfile } from "../types/member";
import type { MemberProfileChange } from "../types/memberProfileEdit";

export const memberRef = (uid: string) => db.collection(POS_COLLECTIONS.members).doc(uid);
export const changesRef = () => db.collection(POS_COLLECTIONS.memberProfileChanges);

export function assertMemberShopScope(shopId: number): void {
  const configuredShop = Number(process.env.HK_API_SHOP_ID);
  if (!Number.isInteger(configuredShop) || configuredShop < 1) throw new HttpsError("failed-precondition", "Backend chưa được cấu hình cửa hàng HK cho chỉnh sửa thành viên.");
  if (shopId !== configuredShop) throw new HttpsError("permission-denied", "Cửa hàng HK không khớp cấu hình backend POS.");
}

export async function assertMemberEditAccess(userId: string, warehouseId: string, permission: string) {
  const session = await getPosAuthSession(userId, warehouseId);
  const permissions = session.permissions;
  const allowed = permissions.global?.["*"] === true || permissions.global?.[permission] === true ||
    permissions[warehouseId]?.["*"] === true || permissions[warehouseId]?.[permission] === true;
  if (!allowed || !session.warehouses.some(item => item.id === warehouseId)) {
    throw new HttpsError("permission-denied", "Bạn không có quyền thao tác hồ sơ thành viên tại điểm bán này.");
  }
  return session;
}

/** Called only after HK has verified the phone/account/shop relationship. */
export async function seedMemberEditProfile(remote: MemberProfile, warehouseId: string, userId: string) {
  const ref = memberRef(remote.uid);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as StoredMemberProfile | undefined;
    if (existing && existing.shopId !== remote.shopId) {
      throw new HttpsError("permission-denied", "Tài khoản thành viên chưa được xác minh tại điểm bán này.");
    }
    if (existing?.profileRevision !== undefined) {
      if (!existing.mid && remote.mid) { tx.update(ref, { mid: remote.mid }); return { ...existing, mid: remote.mid }; }
      return existing;
    }
    const now = new Date().toISOString();
    const stored: StoredMemberProfile = {
      ...existing,
      ...(existing?.hkImportUnassigned ? { hkImportUnassigned: false } : {}),
      schemaVersion: 1, remoteUid: remote.uid, mid: remote.mid ?? existing?.mid ?? null,
      memberCode: remote.memberCode ?? existing?.memberCode ?? null,
      ...editableProfile(remote), shopId: remote.shopId!,
      warehouseId: existing && !existing.hkImportUnassigned ? existing.warehouseId : warehouseId,
      createdBy: existing?.createdBy ?? userId, updatedBy: existing?.updatedBy ?? userId,
      createdAt: existing?.createdAt ?? now, updatedAt: existing?.updatedAt ?? now,
      lastRemoteSyncAt: existing?.lastRemoteSyncAt ?? now,
      ...(existing && !existing.hkImportUnassigned ? editableProfile(existing) : {}),
      profileRevision: 0, remoteConfirmedRevision: 0,
      remoteSnapshot: editableProfile(remote), syncStatus: "SYNCED", syncLease: null,
    };
    // v1 supplemental fields can differ from HK: do not declare them synchronized.
    if (!sameProfile(editableProfile(stored), editableProfile(remote))) stored.syncStatus = "NEEDS_ACTION";
    tx.set(ref, stored);
    return stored;
  });
}

export async function updateMemberProfileLocally(userId: string, data: unknown, deviceId: string) {
  const input = validateProfileEdit(data);
  assertMemberShopScope(input.shopId);
  const session = await assertMemberEditAccess(userId, input.warehouseId, "pos.members.edit");
  const resolveOperationId = (data as { resolveOperationId?: unknown }).resolveOperationId;
  if (resolveOperationId !== undefined && (typeof resolveOperationId !== "string" || !/^[0-9a-f-]{36}$/i.test(resolveOperationId))) throw new HttpsError("invalid-argument", "Mã thay đổi cần xử lý không hợp lệ.");
  if (resolveOperationId) await assertMemberEditAccess(userId, input.warehouseId, "pos.members.retry_sync");
  const target = editableProfile(input);
  const profile = memberRef(input.uid);
  const change = changesRef().doc(input.operationId);
  return db.runTransaction(async tx => {
    const [snapshot, operation] = await Promise.all([tx.get(profile), tx.get(change)]);
    const before = snapshot.data() as StoredMemberProfile | undefined;
    if (!before || before.warehouseId !== input.warehouseId || before.shopId !== input.shopId || before.profileRevision === undefined) {
      throw new HttpsError("failed-precondition", "Vui lòng tra cứu lại để xác minh hồ sơ trước khi chỉnh sửa.");
    }
    if (operation.exists) {
      const previous = operation.data() as MemberProfileChange;
      if (previous.memberUid !== input.uid || previous.createdBy !== userId || previous.deviceId !== deviceId ||
          previous.baseRevision !== input.baseRevision || !sameProfile(previous.after, target)) {
        throw new HttpsError("already-exists", "Mã thao tác đã được dùng cho thay đổi khác.");
      }
      return { profile: before, operationId: input.operationId, revision: previous.revision };
    }
    if (before.profileRevision !== input.baseRevision) throw new HttpsError("aborted", "Hồ sơ đã được thay đổi. Vui lòng tải lại và đối chiếu trước khi lưu.");
    if ((before.birthDate && !target.birthDate) || (before.email && !target.email)) {
      throw new HttpsError("invalid-argument", "Chưa hỗ trợ xóa email hoặc ngày sinh đã có trên HK.");
    }
    if (target.gender !== "MALE" && target.gender !== "FEMALE") {
      throw new HttpsError("invalid-argument", "Vui lòng chọn Nam hoặc Nữ để đồng bộ chính xác với HK.");
    }
    const queue = resolveOperationId ? await tx.get(changesRef().where("memberUid", "==", input.uid)
      .where("status", "in", ["PENDING", "SYNCING", "PARTIAL", "RETRY_WAIT", "UNKNOWN", "NEEDS_ACTION"]).orderBy("revision").limit(101)) : null;
    if (queue) {
      const head = queue.docs[0]?.data() as MemberProfileChange | undefined;
      if (queue.size > 100 || !head || head.operationId !== resolveOperationId || head.status !== "NEEDS_ACTION" ||
          (before.syncLease && before.syncLease.expiresAt > new Date().toISOString()) || queue.docs.some(doc => Boolean(doc.data().inFlightStep) || doc.data().status === "UNKNOWN" || doc.data().status === "SYNCING")) {
        throw new HttpsError("failed-precondition", "Chỉ được thay thế tác vụ đầu hàng đợi đã dừng và có kết quả rõ ràng.");
      }
    }
    const old = editableProfile(before);
    const changedFields = changedProfileFields(old, target);
    if (!before.profileRevision && before.remoteSnapshot) {
      for (const field of changedProfileFields(before.remoteSnapshot, target)) if (!changedFields.includes(field)) changedFields.push(field);
    }
    if (queue) for (const doc of queue.docs) for (const field of (doc.data() as MemberProfileChange).changedFields) if (!changedFields.includes(field)) changedFields.push(field);
    if (!changedFields.length) throw new HttpsError("invalid-argument", "Thông tin chưa có thay đổi.");
    const duplicate = await tx.get(db.collection(POS_COLLECTIONS.members)
      .where("warehouseId", "==", input.warehouseId).where("shopId", "==", input.shopId).where("phone", "==", target.phone).limit(2));
    if (duplicate.docs.some(doc => doc.id !== input.uid)) throw new HttpsError("already-exists", "Số điện thoại đã được lưu cho thành viên khác tại điểm bán.");
    const now = new Date().toISOString();
    const revision = before.profileRevision + 1;
    const record: MemberProfileChange = {
      operationId: input.operationId, memberUid: input.uid, memberMid: before.mid,
      warehouseId: input.warehouseId, shopId: input.shopId, deviceId,
      ...(resolveOperationId ? { resolvesOperationId: resolveOperationId } : {}),
      revision, baseRevision: before.profileRevision, before: old, after: target, changedFields,
      status: "PENDING", phoneStep: changedFields.includes("phone") ? "PENDING" : "DONE",
      profileStep: changedFields.some(field => field !== "phone") ? "PENDING" : "DONE",
      attemptCount: 0, nextAttemptAt: now, lastError: null,
      createdBy: userId, createdByName: session.user.full_name,
      createdAt: now, updatedAt: now, completedAt: null,
    };
    const stored = { ...before, ...target, profileRevision: revision, syncStatus: resolveOperationId || before.syncStatus === "SYNCED" || !before.profileRevision ? "PENDING" as const : before.syncStatus ?? "PENDING", updatedBy: userId, updatedAt: now };
    if (queue) for (const doc of queue.docs) tx.update(doc.ref, { status: "SUPERSEDED", resolvedByOperationId: input.operationId, updatedAt: now });
    tx.set(profile, stored);
    tx.create(change, record);
    return { profile: stored, operationId: input.operationId, revision };
  });
}

export async function fetchMemberProfileHistoryForUser(userId: string, data: unknown) {
  const input = data as { uid?: string; warehouseId?: string; shopId?: number; beforeRevision?: number; summaryOnly?: boolean };
  if (!input || typeof input.uid !== "string" || !input.uid || input.uid.includes("/") || typeof input.warehouseId !== "string") {
    throw new HttpsError("invalid-argument", "Thông tin tra cứu lịch sử không hợp lệ.");
  }
  await assertMemberEditAccess(userId, input.warehouseId, input.summaryOnly ? "pos.members.edit" : "pos.members.history");
  assertMemberShopScope(Number(input.shopId));
  const profile = await getStoredMemberProfile(input.uid);
  if (!profile || profile.shopId !== input.shopId) throw new HttpsError("permission-denied", "Hồ sơ không thuộc hệ thống thành viên này.");
  if (input.summaryOnly) return { profile, changes: [], nextCursor: null };
  let query = changesRef().where("memberUid", "==", input.uid).orderBy("revision", "desc");
  if (input.beforeRevision !== undefined) {
    if (!Number.isInteger(input.beforeRevision) || input.beforeRevision < 1) throw new HttpsError("invalid-argument", "Trang lịch sử không hợp lệ.");
    query = query.startAfter(input.beforeRevision);
  }
  const result = await query.limit(41).get();
  const changes = result.docs.slice(0, 40).map(doc => doc.data() as MemberProfileChange);
  return { profile, changes, nextCursor: result.size > 40 ? changes[changes.length - 1]?.revision : null };
}

export async function updateMemberProfileSyncRetryForUser(userId: string, data: unknown) {
  const input = data as { uid: string; warehouseId: string; shopId: number; operationId: string };
  if (!input || typeof input.operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.operationId)) throw new HttpsError("invalid-argument", "Mã thao tác không hợp lệ.");
  await assertMemberEditAccess(userId, input.warehouseId, "pos.members.retry_sync");
  return db.runTransaction(async tx => {
    const ref = changesRef().doc(input.operationId);
    const doc = await tx.get(ref);
    const change = doc.data() as MemberProfileChange | undefined;
    if (!change || change.memberUid !== input.uid || change.warehouseId !== input.warehouseId || change.shopId !== input.shopId) throw new HttpsError("permission-denied", "Thay đổi không thuộc điểm bán này.");
    const profile = await tx.get(memberRef(change.memberUid));
    const lease = profile.data()?.syncLease;
    if (lease && lease.expiresAt > new Date().toISOString()) throw new HttpsError("aborted", "Đồng bộ đang được xử lý. Vui lòng thử lại sau.");
    if (["SYNCED", "SUPERSEDED"].includes(change.status)) return { operationId: change.operationId };
    tx.update(ref, { status: change.status === "UNKNOWN" ? "UNKNOWN" : "PENDING", nextAttemptAt: new Date().toISOString(), lastError: null });
    return { operationId: change.operationId };
  });
}
