import { HttpsError } from "firebase-functions/v2/https";
import { validateMemberRegistrationInput } from "./memberPolicy";
import type { MemberEditableProfile, MemberProfileChange } from "../types/memberProfileEdit";

export const EDITABLE_FIELDS = ["fullName", "phone", "nickName", "gender", "birthDate", "email"] as const;
export function editableProfile(value: Partial<MemberEditableProfile>): MemberEditableProfile {
  return {
    fullName: value.fullName ?? "", phone: value.phone ?? "",
    nickName: value.nickName ?? value.fullName ?? "", gender: value.gender ?? "UNKNOWN",
    birthDate: value.birthDate ?? null, email: value.email ?? null,
  };
}
export function validateProfileEdit(data: unknown) {
  if (!data || typeof data !== "object") throw new HttpsError("invalid-argument", "Dữ liệu chỉnh sửa không hợp lệ.");
  const input = data as Record<string, unknown>;
  if (typeof input.uid !== "string" || !input.uid || input.uid.includes("/") || input.uid.length > 128 ||
      typeof input.operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.operationId) ||
      !Number.isInteger(input.baseRevision) || Number(input.baseRevision) < 0) {
    throw new HttpsError("invalid-argument", "Mã thao tác hoặc phiên bản hồ sơ không hợp lệ.");
  }
  const profile = validateMemberRegistrationInput({ ...input, memberCode: null });
  const nickName = typeof input.nickName === "string" ? input.nickName.trim() : profile.fullName;
  if (!nickName || nickName.length > 120) throw new HttpsError("invalid-argument", "Tên gọi không được để trống và tối đa 120 ký tự.");
  return { ...profile, uid: input.uid, operationId: input.operationId, baseRevision: Number(input.baseRevision), nickName };
}
export function changedProfileFields(before: MemberEditableProfile, after: MemberEditableProfile) {
  return EDITABLE_FIELDS.filter(field => before[field] !== after[field]);
}
export function sameProfile(a: MemberEditableProfile, b: MemberEditableProfile): boolean {
  return changedProfileFields(a, b).length === 0;
}
export function profileConflict(change: MemberProfileChange, expected: MemberEditableProfile, remote: MemberEditableProfile): boolean {
  return change.changedFields.some(field => remote[field] !== expected[field] && remote[field] !== change.after[field]);
}
export function profilePayload(change: MemberProfileChange, remote: MemberEditableProfile) {
  const target = { ...remote };
  for (const field of change.changedFields) Object.assign(target, { [field]: change.after[field] });
  // Always send sex: HK resets it when omitted. Never request unsupported deletion.
  if (target.gender !== "MALE" && target.gender !== "FEMALE") {
    throw new HttpsError("failed-precondition", "Cần xác minh giới tính Nam hoặc Nữ trước khi đồng bộ hồ sơ này.");
  }
  return { target, body: {
    uid: change.memberUid, ...(change.memberMid ? { mid: change.memberMid } : {}),
    realName: target.fullName, nickName: target.nickName || target.fullName,
    sex: (target.gender === "MALE" ? 1 : 2) as 1 | 2,
    ...(target.birthDate ? { birthday: target.birthDate } : {}),
    ...(target.email ? { email: target.email } : {}),
  } };
}
