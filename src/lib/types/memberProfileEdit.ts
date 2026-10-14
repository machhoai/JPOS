import type { MemberGender } from "./member";

export interface MemberEditableProfile {
  fullName: string;
  phone: string;
  nickName: string;
  gender: MemberGender;
  birthDate: string | null;
  email: string | null;
}
export type MemberProfileSyncStatus = "PENDING" | "SYNCING" | "PARTIAL" | "RETRY_WAIT" | "UNKNOWN" | "NEEDS_ACTION" | "SYNCED" | "SUPERSEDED";
export interface MemberProfileChange {
  operationId: string;
  memberUid: string;
  memberMid: string | null;
  shopId: number;
  warehouseId: string;
  deviceId: string;
  revision: number;
  baseRevision: number;
  before: MemberEditableProfile;
  after: MemberEditableProfile;
  changedFields: (keyof MemberEditableProfile)[];
  status: MemberProfileSyncStatus;
  phoneStep: "PENDING" | "DONE";
  profileStep: "PENDING" | "DONE";
  inFlightStep?: "phone" | "profile" | null;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  resolvedByOperationId?: string;
  resolvesOperationId?: string;
}
export interface MemberProfileEditMetadata {
  profileRevision?: number;
  remoteConfirmedRevision?: number;
  nickName?: string;
  remoteSnapshot?: MemberEditableProfile;
  syncStatus?: MemberProfileSyncStatus;
  syncLease?: { token: string; expiresAt: string } | null;
}
