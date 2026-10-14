import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import type {
  MemberGender,
  StoredMemberProfile,
} from "../types/member";

export const MEMBER_PROFILE_SCHEMA_VERSION = 1 as const;

type StoredMemberProfileInput = Omit<
  StoredMemberProfile,
  "schemaVersion" | "createdAt" | "updatedAt"
>;

export class MemberRepositoryDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberRepositoryDataError";
  }
}

function memberDocument(remoteUid: string) {
  if (!remoteUid || remoteUid.includes("/")) {
    throw new MemberRepositoryDataError("UID thành viên local không hợp lệ.");
  }
  return db.collection(POS_COLLECTIONS.members).doc(remoteUid);
}

function requiredString(
  data: Record<string, unknown>,
  field: string,
): string {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new MemberRepositoryDataError(`Hồ sơ local thiếu field ${field}.`);
  }
  return value;
}

function nullableString(
  data: Record<string, unknown>,
  field: string,
): string | null {
  const value = data[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new MemberRepositoryDataError(`Field ${field} không đúng kiểu.`);
  }
  return value;
}

function memberGender(value: unknown): MemberGender {
  if (["MALE", "FEMALE", "OTHER", "UNKNOWN"].includes(String(value))) {
    return String(value) as MemberGender;
  }
  throw new MemberRepositoryDataError("Field gender không đúng kiểu.");
}

export function parseStoredMemberProfile(
  documentId: string,
  value: unknown,
): StoredMemberProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemberRepositoryDataError("Hồ sơ thành viên local không hợp lệ.");
  }
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== MEMBER_PROFILE_SCHEMA_VERSION) {
    throw new MemberRepositoryDataError("Phiên bản hồ sơ thành viên không hỗ trợ.");
  }

  const remoteUid = requiredString(data, "remoteUid");
  if (remoteUid !== documentId) {
    throw new MemberRepositoryDataError("Document ID không khớp UID thành viên.");
  }
  const shopId = Number(data.shopId);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    throw new MemberRepositoryDataError("Field shopId không hợp lệ.");
  }

  return {
    ...(typeof data.hkImportHash === "string" ? {
      hkImportHash: data.hkImportHash,
      hkSnapshot: data.hkSnapshot as Record<string, unknown>,
      hkImportedAt: String(data.hkImportedAt ?? ""),
      ...(data.hkImportUnassigned !== undefined ? { hkImportUnassigned: data.hkImportUnassigned === true } : {}),
    } : {}),
    ...(data.profileRevision !== undefined ? {
      profileRevision: Number(data.profileRevision),
      remoteConfirmedRevision: Number(data.remoteConfirmedRevision ?? 0),
      nickName: typeof data.nickName === "string" ? data.nickName : "",
      remoteSnapshot: data.remoteSnapshot as StoredMemberProfile["remoteSnapshot"],
      syncStatus: data.syncStatus as StoredMemberProfile["syncStatus"],
      syncLease: data.syncLease as StoredMemberProfile["syncLease"],
    } : {}),
    schemaVersion: MEMBER_PROFILE_SCHEMA_VERSION,
    remoteUid,
    mid: nullableString(data, "mid"),
    memberCode: nullableString(data, "memberCode"),
    phone: typeof data.hkImportHash === "string" && typeof data.phone === "string" ? data.phone : requiredString(data, "phone"),
    fullName: typeof data.hkImportHash === "string" && typeof data.fullName === "string" ? data.fullName : requiredString(data, "fullName"),
    gender: memberGender(data.gender),
    birthDate: nullableString(data, "birthDate"),
    email: nullableString(data, "email"),
    shopId,
    warehouseId: requiredString(data, "warehouseId"),
    createdBy: requiredString(data, "createdBy"),
    updatedBy: requiredString(data, "updatedBy"),
    createdAt: requiredString(data, "createdAt"),
    updatedAt: requiredString(data, "updatedAt"),
    lastRemoteSyncAt: requiredString(data, "lastRemoteSyncAt"),
  };
}

export async function getStoredMemberProfile(
  remoteUid: string,
): Promise<StoredMemberProfile | null> {
  const snapshot = await memberDocument(remoteUid).get();
  return snapshot.exists
    ? parseStoredMemberProfile(snapshot.id, snapshot.data())
    : null;
}

export async function saveStoredMemberProfile(
  input: StoredMemberProfileInput,
): Promise<StoredMemberProfile> {
  const document = memberDocument(input.remoteUid);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const existing = snapshot.exists
      ? parseStoredMemberProfile(snapshot.id, snapshot.data())
      : null;
    const now = new Date().toISOString();
    const profile: StoredMemberProfile = {
      ...existing,
      ...input,
      schemaVersion: MEMBER_PROFILE_SCHEMA_VERSION,
      createdBy: existing?.createdBy ?? input.createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    transaction.set(document, { ...snapshot.data(), ...profile });
    return profile;
  });
}

/** Persist a card only after Joyworld confirms that it belongs to the member. */
export async function saveStoredMemberCardIfPresent(params: {
  remoteUid: string;
  memberCode: string;
  updatedBy: string;
  lastRemoteSyncAt: string;
}): Promise<StoredMemberProfile | null> {
  const document = memberDocument(params.remoteUid);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return null;

    const existing = parseStoredMemberProfile(snapshot.id, snapshot.data());
    const updatedAt = new Date().toISOString();
    const profile: StoredMemberProfile = {
      ...existing,
      memberCode: params.memberCode,
      updatedBy: params.updatedBy,
      updatedAt,
      lastRemoteSyncAt: params.lastRemoteSyncAt,
    };
    transaction.update(document, { memberCode: params.memberCode, updatedBy: params.updatedBy, updatedAt, lastRemoteSyncAt: params.lastRemoteSyncAt });
    return profile;
  });
}

