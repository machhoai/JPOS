import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import { MemberServiceError, toMemberServiceError, validateMemberRegistrationDraft } from "@/lib/services/memberService";
import type { MemberEditableProfile, MemberProfileChange } from "@/lib/types/memberProfileEdit";
import type { LocalMemberRecord, MemberProfile } from "@/lib/types/member";

export interface MemberProfileScope { uid: string; shopId: number; warehouseId: string }
export interface MemberProfileEditInput extends MemberProfileScope, MemberEditableProfile { operationId: string; baseRevision: number; resolveOperationId?: string }
export interface MemberProfileHistoryResult {
  profile: LocalMemberRecord & MemberProfile;
  changes: MemberProfileChange[];
  nextCursor: number | null;
}
async function request<T>(action: string, payload: object): Promise<T> {
  try {
    const callable = httpsCallable<object, T>(functions, "getPosAuthSession");
    const response = await callable(await withDeviceAuth({ action, payload }));
    return response.data;
  } catch (error: unknown) { throw toMemberServiceError(error); }
}
export function validateMemberProfileDraft(draft: MemberEditableProfile): MemberEditableProfile {
  const [birthYear = "", birthMonth = "", birthDay = ""] = (draft.birthDate ?? "").split("-");
  if (draft.gender !== "MALE" && draft.gender !== "FEMALE") throw new Error("Vui lòng chọn Nam hoặc Nữ để đồng bộ chính xác với HK.");
  const normalized = validateMemberRegistrationDraft({ ...draft, memberCode: "", gender: draft.gender, email: draft.email ?? "", birthDay, birthMonth, birthYear });
  const nickName = draft.nickName.trim();
  if (!nickName || nickName.length > 120) throw new Error("Tên gọi không được để trống và tối đa 120 ký tự.");
  return { fullName: normalized.fullName, phone: normalized.phone, nickName, gender: normalized.gender,
    birthDate: normalized.birthYear ? `${normalized.birthYear}-${normalized.birthMonth}-${normalized.birthDay}` : null, email: normalized.email || null };
}
export async function updateMemberProfile(input: MemberProfileEditInput) {
  const result = await request<{ profile: MemberProfileHistoryResult["profile"]; operationId: string; revision: number }>("updateMemberProfileLocal", { ...input, ...validateMemberProfileDraft(input) });
  if (result.operationId !== input.operationId || result.profile?.remoteUid !== input.uid || !Number.isInteger(result.revision)) {
    throw new MemberServiceError("Cloud Functions chưa hỗ trợ phiên bản chỉnh sửa local này. Vui lòng cập nhật backend trước.", "failed-precondition");
  }
  return result;
}
export function fetchMemberProfileHistory(scope: MemberProfileScope, beforeRevision?: number, summaryOnly = false) {
  return request<MemberProfileHistoryResult>("fetchMemberProfileHistory", { ...scope, summaryOnly, ...(beforeRevision ? { beforeRevision } : {}) });
}
export function updateMemberProfileSyncRetry(scope: MemberProfileScope, operationId: string) {
  return request<{ operationId: string }>("updateMemberProfileSyncRetry", { ...scope, operationId });
}
