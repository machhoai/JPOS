import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import type {
  MemberCardLookupKind,
  MemberLookupMode,
  MemberProfile,
  MemberRegistrationDraft,
} from "@/lib/types/member";

export interface MemberLookupInput {
  shopId: number;
  warehouseId: string;
  mode: MemberLookupMode;
  query: string;
  cardLookupKind?: MemberCardLookupKind;
  selectedUid?: string;
}

export interface MemberLookupResult {
  member: MemberProfile;
  fetchedAt: string;
}

export interface MemberRegistrationInput extends MemberRegistrationDraft {
  shopId: number;
  warehouseId: string;
}

export interface MemberRegistrationResult {
  member: MemberProfile;
  remoteMessage: string | null;
  createdAt: string;
}

function normalizedBirthDate(
  draft: MemberRegistrationDraft,
): { birthDate: string | null; birthDay: string; birthMonth: string; birthYear: string } {
  const birthDay = draft.birthDay.trim();
  const birthMonth = draft.birthMonth.trim();
  const birthYear = draft.birthYear.trim();
  const hasAnyPart = Boolean(birthDay || birthMonth || birthYear);

  if (!hasAnyPart) {
    return { birthDate: null, birthDay: "", birthMonth: "", birthYear: "" };
  }
  if (!/^\d{1,2}$/.test(birthDay) || !/^\d{1,2}$/.test(birthMonth) || !/^\d{4}$/.test(birthYear)) {
    throw new MemberServiceError(
      "Vui lòng nhập đầy đủ ngày, tháng và năm sinh.",
      "invalid-birth-date",
    );
  }

  const paddedDay = birthDay.padStart(2, "0");
  const paddedMonth = birthMonth.padStart(2, "0");
  const birthDate = `${birthYear}-${paddedMonth}-${paddedDay}`;
  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== birthDate ||
    parsed.getTime() > Date.now()
  ) {
    throw new MemberServiceError("Ngày sinh không hợp lệ.", "invalid-birth-date");
  }

  return {
    birthDate,
    birthDay: paddedDay,
    birthMonth: paddedMonth,
    birthYear,
  };
}

export class MemberServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "MemberServiceError";
  }
}

function normalizeLookupQuery(mode: MemberLookupMode, query: string): string {
  const normalized = mode === "PHONE"
    ? query.trim().replace(/[\s().-]/g, "")
    : query.trim();

  if (mode === "PHONE" && !/^\+?\d{8,15}$/.test(normalized)) {
    throw new MemberServiceError(
      "Số điện thoại phải gồm 8 đến 15 chữ số.",
      "invalid-phone",
    );
  }
  if (mode === "CARD" && (!normalized || normalized.length > 64)) {
    throw new MemberServiceError("Mã thẻ không hợp lệ.", "invalid-card");
  }
  return normalized;
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "unknown";
  return String((error as { code?: unknown }).code || "unknown");
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Không thể xử lý yêu cầu thành viên. Vui lòng thử lại.";
}

export function validateMemberRegistrationDraft(
  draft: MemberRegistrationDraft,
): MemberRegistrationDraft {
  const fullName = draft.fullName.trim();
  const phone = draft.phone.trim().replace(/[\s().-]/g, "");
  const memberCode = draft.memberCode.trim();
  const email = draft.email.trim().toLowerCase();
  if (!fullName || fullName.length > 120) {
    throw new MemberServiceError("Họ tên khách hàng không hợp lệ.", "invalid-name");
  }
  if (!/^\+?\d{8,15}$/.test(phone)) {
    throw new MemberServiceError("Số điện thoại phải gồm 8 đến 15 chữ số.", "invalid-phone");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MemberServiceError("Email không đúng định dạng.", "invalid-email");
  }
  if (memberCode && !/^[A-Za-z0-9_-]{1,64}$/.test(memberCode)) {
    throw new MemberServiceError(
      "Mã thẻ chỉ được gồm chữ, số, dấu gạch ngang hoặc gạch dưới.",
      "invalid-member-code",
    );
  }
  if (draft.gender !== "MALE" && draft.gender !== "FEMALE") {
    throw new MemberServiceError("Giới tính chỉ có thể là Nam hoặc Nữ.", "invalid-gender");
  }
  const birthDate = normalizedBirthDate(draft);
  return {
    ...draft,
    fullName,
    phone,
    memberCode,
    email,
    birthDay: birthDate.birthDay,
    birthMonth: birthDate.birthMonth,
    birthYear: birthDate.birthYear,
  };
}

export function toMemberServiceError(error: unknown): MemberServiceError {
  if (error instanceof MemberServiceError) return error;
  const code = readErrorCode(error);
  const remoteMessage = readErrorMessage(error);
  if (code.includes("unauthenticated")) {
    return new MemberServiceError("Phiên đăng nhập đã hết hạn.", code);
  }
  if (code.includes("permission-denied")) {
    return new MemberServiceError(
      "Bạn không có quyền thao tác thành viên tại điểm bán này.",
      code,
    );
  }
  if (code.includes("not-found") || code.includes("failed-precondition")) {
    return new MemberServiceError(remoteMessage, code);
  }
  if (code.includes("unavailable")) {
    return new MemberServiceError(
      remoteMessage || "Không thể kết nối OpenAPI. Vui lòng thử lại.",
      code,
    );
  }
  return new MemberServiceError(remoteMessage, code);
}

export async function lookupMember(
  input: MemberLookupInput,
): Promise<MemberLookupResult> {
  const callable = httpsCallable<
    { action: "lookupMember"; payload: MemberLookupInput },
    MemberLookupResult
  >(
    functions,
    "getPosAuthSession",
  );

  try {
    const result = await callable(await withDeviceAuth({
      action: "lookupMember" as const,
      payload: {
        ...input,
        query: normalizeLookupQuery(input.mode, input.query),
      },
    }));
    return result.data;
  } catch (error: unknown) {
    throw toMemberServiceError(error);
  }
}

export async function registerMember(
  input: MemberRegistrationInput,
): Promise<MemberRegistrationResult> {
  const draft = validateMemberRegistrationDraft(input);
  type RegistrationPayload = Omit<MemberRegistrationInput, "birthDay" | "birthMonth" | "birthYear" | "email" | "memberCode"> & {
    birthDate: string | null;
    email: string | null;
    memberCode: string | null;
    operationId: string;
  };
  const birthDate = normalizedBirthDate(draft).birthDate;
  const key = `jpos-registration:${input.shopId}:${input.warehouseId}:${draft.phone}`;
  let operationId = crypto.randomUUID();
  try { operationId = localStorage.getItem(key) || operationId; localStorage.setItem(key, operationId); } catch { /* Backend phone lock also protects retries without browser storage. */ }
  const callable = httpsCallable<
    { action: "registerMember"; payload: RegistrationPayload },
    MemberRegistrationResult
  >(functions, "getPosAuthSession");

  try {
    const result = await callable(await withDeviceAuth({
      action: "registerMember" as const,
      payload: {
        operationId,
        fullName: draft.fullName,
        phone: draft.phone,
        memberCode: draft.memberCode || null,
        gender: draft.gender,
        shopId: input.shopId,
        warehouseId: input.warehouseId,
        birthDate,
        email: draft.email || null,
      },
    }));
    return result.data;
  } catch (error: unknown) {
    throw toMemberServiceError(error);
  }
}
