import type { MemberRegistrationInput } from "../member/memberPolicy";
import type { StoredMemberProfile } from "./member";
export type RegistrationState = "PREPARED" | "HK_IN_FLIGHT" | "HK_CONFIRMED" | "COMPLETED" | "NEEDS_REVIEW";
export interface RegistrationIntent {
  input: MemberRegistrationInput;
  operationId: string;
  userId: string;
  deviceId: string;
  shopId: number;
  warehouseId: string;
  phone: string;
  fullName: string;
  fingerprint: string;
  state: RegistrationState;
  remoteUid: string | null;
  mid: string | null;
  lease: { token: string; expiresAt: number } | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RegistrationProcessingResult { intent: RegistrationIntent; profile: StoredMemberProfile }
