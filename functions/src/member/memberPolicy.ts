import { createHash } from "node:crypto";
import {
  MEMBER_ACCOUNT_ATTRIBUTES,
  type MemberCompensationCategory,
  type MemberGender,
  type MemberStoredValueCategory,
} from "../types/member";

export type MemberLookupMode = "CARD" | "PHONE";
export type MemberCardLookupKind = "MEMBER_CODE" | "SERIAL_NUMBER";
export type MemberStoredValueCategoryFilter = MemberStoredValueCategory | "ALL";

interface MemberScopeInput {
  shopId: number;
  warehouseId: string;
}

export interface MemberRemoteScopeInput extends MemberScopeInput {
  uid: string;
}

export interface MemberStoredValueHistoryInput extends MemberRemoteScopeInput {
  storedCategory: MemberStoredValueCategoryFilter;
  startTime: string;
  endTime: string;
  page: number;
  limit: number;
}

export interface MemberPassTicketInput extends MemberRemoteScopeInput {
  category: 1 | 2 | 3 | null;
}

export interface MemberCardIssueInfoInput extends MemberRemoteScopeInput {
  lookupQuery: string;
}

export interface MemberCardIssueCheckInput extends MemberScopeInput {
  memberCode: string;
}

export interface MemberCardIssueConfirmInput extends MemberCardIssueInfoInput {
  memberAcctId: string;
  memberCode: string;
  memberIcCard: string;
  dynamicSerialNo: string | null;
}

export interface MemberLookupInput extends MemberScopeInput {
  mode: MemberLookupMode;
  query: string;
  cardLookupKind?: MemberCardLookupKind;
  selectedUid?: string;
}

export interface MemberRegistrationInput extends MemberScopeInput {
  fullName: string;
  phone: string;
  memberCode: string | null;
  gender: MemberGender;
  birthDate: string | null;
  email: string | null;
}

export interface MemberProfileUpdateInput extends MemberRegistrationInput {
  uid: string;
  mid: string | null;
}

export class MemberInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberInputError";
  }
}

function inputRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new MemberInputError("Dữ liệu thành viên không hợp lệ.");
  }
  return data as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new MemberInputError(`${label} không hợp lệ.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new MemberInputError(`${label} không hợp lệ.`);
  }
  return normalized;
}

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, label, maxLength);
}

function normalizePhone(value: unknown): string {
  const rawPhone = requiredString(value, "Số điện thoại", 32);
  const phone = rawPhone.replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(phone)) {
    throw new MemberInputError("Số điện thoại không đúng định dạng.");
  }
  return phone;
}

function normalizeMemberCode(value: unknown): string | null {
  const memberCode = optionalString(value, "Mã thẻ", 64);
  if (memberCode && !/^[A-Za-z0-9_-]+$/.test(memberCode)) {
    throw new MemberInputError(
      "Mã thẻ chỉ được gồm chữ, số, dấu gạch ngang hoặc gạch dưới.",
    );
  }
  return memberCode;
}

function normalizeEmail(value: unknown): string | null {
  const email = optionalString(value, "Email", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MemberInputError("Email không đúng định dạng.");
  }
  return email?.toLowerCase() ?? null;
}

function normalizeBirthDate(value: unknown): string | null {
  const birthDate = optionalString(value, "Ngày sinh", 10);
  if (!birthDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new MemberInputError("Ngày sinh phải có định dạng YYYY-MM-DD.");
  }
  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== birthDate ||
    parsed.getTime() > Date.now()
  ) {
    throw new MemberInputError("Ngày sinh không hợp lệ.");
  }
  return birthDate;
}

function normalizeGender(value: unknown): MemberGender {
  if (["MALE", "FEMALE", "OTHER", "UNKNOWN"].includes(String(value))) {
    return String(value) as MemberGender;
  }
  throw new MemberInputError("Giới tính không hợp lệ.");
}

function scopeInput(data: Record<string, unknown>): MemberScopeInput {
  if (!Number.isInteger(data.shopId) || Number(data.shopId) <= 0) {
    throw new MemberInputError("Mã cửa hàng không hợp lệ.");
  }
  return {
    shopId: Number(data.shopId),
    warehouseId: requiredString(data.warehouseId, "Điểm bán", 128),
  };
}

function profileInput(data: Record<string, unknown>): MemberRegistrationInput {
  return {
    ...scopeInput(data),
    fullName: requiredString(data.fullName, "Họ tên", 120),
    phone: normalizePhone(data.phone),
    memberCode: normalizeMemberCode(data.memberCode),
    gender: normalizeGender(data.gender),
    birthDate: normalizeBirthDate(data.birthDate),
    email: normalizeEmail(data.email),
  };
}

export interface MemberCompensationInput extends MemberScopeInput {
  operationId: string;
  uid: string;
  memberCode: string | null;
  memberName: string;
  storedCategory: MemberCompensationCategory;
  amount: number;
  reason: string;
  actionTime: string;
}

function remoteScopeInput(data: Record<string, unknown>): MemberRemoteScopeInput {
  return {
    ...scopeInput(data),
    uid: requiredString(data.uid, "UID thành viên", 128),
  };
}

function remoteDateTime(value: unknown, label: string): string {
  const normalized = requiredString(value, label, 23);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    throw new MemberInputError(`${label} không đúng định dạng.`);
  }
  return normalized;
}

function positiveInteger(
  value: unknown,
  label: string,
  maximum: number,
): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new MemberInputError(`${label} không hợp lệ.`);
  }
  return Number(value);
}

function nonZeroInteger(
  value: unknown,
  label: string,
  maximumAbsoluteValue: number,
): number {
  if (
    !Number.isInteger(value) ||
    Number(value) === 0 ||
    Math.abs(Number(value)) > maximumAbsoluteValue
  ) {
    throw new MemberInputError(`${label} không hợp lệ.`);
  }
  return Number(value);
}

export function validateMemberLookupInput(data: unknown): MemberLookupInput {
  const input = inputRecord(data);
  const mode = input.mode;
  if (mode !== "CARD" && mode !== "PHONE") {
    throw new MemberInputError("Phương thức tra cứu thành viên không hợp lệ.");
  }
  if (mode === "PHONE") {
    const selectedUid = input.selectedUid === undefined ? undefined : requiredString(input.selectedUid, "UID đã chọn", 128);
    if (selectedUid && !/^[a-zA-Z0-9_-]{1,128}$/.test(selectedUid)) throw new MemberInputError("UID đã chọn không hợp lệ.");
    return { ...scopeInput(input), mode, query: normalizePhone(input.query), ...(selectedUid ? { selectedUid } : {}) };
  }

  const cardLookupKind = input.cardLookupKind ?? "MEMBER_CODE";
  if (cardLookupKind !== "MEMBER_CODE" && cardLookupKind !== "SERIAL_NUMBER") {
    throw new MemberInputError("Loại mã thẻ tra cứu không hợp lệ.");
  }
  const query = requiredString(
    input.query,
    cardLookupKind === "SERIAL_NUMBER" ? "Serial thẻ" : "Mã thẻ",
    64,
  );
  if (cardLookupKind === "SERIAL_NUMBER" && !/^\d{1,20}$/.test(query)) {
    throw new MemberInputError("Serial thẻ không đúng định dạng.");
  }
  return { ...scopeInput(input), mode, query, cardLookupKind };
}

export function validateMemberRemoteScopeInput(
  data: unknown,
): MemberRemoteScopeInput {
  return remoteScopeInput(inputRecord(data));
}

export function validateMemberStoredValueHistoryInput(
  data: unknown,
): MemberStoredValueHistoryInput {
  const input = inputRecord(data);
  const storedCategory = input.storedCategory === "ALL"
    ? "ALL"
    : Number(input.storedCategory);
  if (storedCategory !== "ALL" && ![1, 2, 4, 5, 6, 7].includes(storedCategory)) {
    throw new MemberInputError("Loại số dư không hợp lệ.");
  }
  const startTime = remoteDateTime(input.startTime, "Thời gian bắt đầu");
  const endTime = remoteDateTime(input.endTime, "Thời gian kết thúc");
  if (startTime > endTime) {
    throw new MemberInputError("Thời gian bắt đầu phải trước thời gian kết thúc.");
  }
  return {
    ...remoteScopeInput(input),
    storedCategory: storedCategory as MemberStoredValueCategoryFilter,
    startTime,
    endTime,
    page: positiveInteger(input.page, "Trang", 100_000),
    limit: positiveInteger(input.limit, "Số dòng mỗi trang", 100),
  };
}

export function validateMemberPassTicketInput(data: unknown): MemberPassTicketInput {
  const input = inputRecord(data);
  const category = input.category === undefined || input.category === null
    ? null
    : Number(input.category);
  if (category !== null && ![1, 2, 3].includes(category)) {
    throw new MemberInputError("Loại vé thành viên không hợp lệ.");
  }
  return {
    ...remoteScopeInput(input),
    category: category as 1 | 2 | 3 | null,
  };
}

export function validateMemberCardIssueInfoInput(
  data: unknown,
): MemberCardIssueInfoInput {
  const input = inputRecord(data);
  return {
    ...remoteScopeInput(input),
    lookupQuery: requiredString(input.lookupQuery, "Thông tin thành viên", 128),
  };
}

export function validateMemberCardIssueCheckInput(
  data: unknown,
): MemberCardIssueCheckInput {
  const input = inputRecord(data);
  const memberCode = normalizeMemberCode(input.memberCode);
  if (!memberCode) {
    throw new MemberInputError("Mã thẻ mới không hợp lệ.");
  }
  return {
    ...scopeInput(input),
    memberCode,
  };
}

export function validateMemberCardIssueConfirmInput(
  data: unknown,
): MemberCardIssueConfirmInput {
  const input = inputRecord(data);
  const memberCode = normalizeMemberCode(input.memberCode);
  if (!memberCode) {
    throw new MemberInputError("Mã thẻ mới không hợp lệ.");
  }
  return {
    ...validateMemberCardIssueInfoInput(input),
    memberAcctId: requiredString(input.memberAcctId, "Tài khoản thành viên", 128),
    memberCode,
    memberIcCard: requiredString(input.memberIcCard, "UUID thẻ", 128),
    dynamicSerialNo: optionalString(input.dynamicSerialNo, "Mã xác thực thẻ", 256),
  };
}

export function validateMemberRegistrationInput(
  data: unknown,
): MemberRegistrationInput {
  return profileInput(inputRecord(data));
}

export function validateMemberProfileUpdateInput(
  data: unknown,
): MemberProfileUpdateInput {
  const input = inputRecord(data);
  return {
    ...profileInput(input),
    uid: requiredString(input.uid, "UID thành viên", 128),
    mid: optionalString(input.mid, "MID thành viên", 128),
    memberCode: normalizeMemberCode(input.memberCode),
  };
}

export function validateMemberCompensationInput(
  data: unknown,
): MemberCompensationInput {
  const input = inputRecord(data);
  const operationId = requiredString(input.operationId, "Mã thao tác", 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new MemberInputError("Mã thao tác nạp bù không hợp lệ.");
  }
  const actionTime = requiredString(input.actionTime, "Thời gian thao tác", 40);
  const parsedActionTime = new Date(actionTime);
  if (Number.isNaN(parsedActionTime.getTime())) {
    throw new MemberInputError("Thời gian thao tác không hợp lệ.");
  }
  const reason = requiredString(input.reason, "Lý do nạp bù", 500);
  if (reason.length < 5) {
    throw new MemberInputError("Lý do nạp bù phải có ít nhất 5 ký tự.");
  }
  const storedCategory = Number(
    input.storedCategory ?? MEMBER_ACCOUNT_ATTRIBUTES.TURNS,
  );
  if (
    storedCategory !== MEMBER_ACCOUNT_ATTRIBUTES.PRINCIPAL_VND &&
    storedCategory !== MEMBER_ACCOUNT_ATTRIBUTES.TURNS &&
    storedCategory !== MEMBER_ACCOUNT_ATTRIBUTES.POINTS
  ) {
    throw new MemberInputError("Cột điều chỉnh phải là Tiền, Lượt hoặc Điểm.");
  }
  return {
    ...scopeInput(input),
    operationId,
    uid: requiredString(input.uid, "UID thành viên", 128),
    memberCode: normalizeMemberCode(input.memberCode),
    memberName: requiredString(input.memberName, "Tên thành viên", 120),
    storedCategory: storedCategory as MemberCompensationCategory,
    amount: nonZeroInteger(input.amount, "Số lượng điều chỉnh", 10_000_000),
    reason,
    actionTime: parsedActionTime.toISOString(),
  };
}

/** Stable, non-PII external identity used for idempotent POS registrations. */
export function createMemberOpenId(phone: string): string {
  return createHash("sha256")
    .update(`jpos-member:${phone}`, "utf8")
    .digest("hex")
    .slice(0, 28);
}

export function toRemoteSex(gender: MemberGender): 1 | 2 | undefined {
  if (gender === "MALE") return 1;
  if (gender === "FEMALE") return 2;
  return undefined;
}
