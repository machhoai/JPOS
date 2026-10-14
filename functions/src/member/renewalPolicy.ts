import { MemberInputError, validateMemberRemoteScopeInput } from "./memberPolicy";

// Cashier categories differ from the OpenAPI's 1/2/4/5/6/7 enumerations.
export const RENEWAL_CATEGORIES = [101, 102, 104, 105, 106, 107, 108, 109, 110, 111, 112, 115, 116, 117, 120, 121] as const;

export function validateRenewalScope(data: unknown) {
  const scope = validateMemberRemoteScopeInput(data);
  const category = (data as { category?: unknown }).category;
  if (typeof category !== "number" || !RENEWAL_CATEGORIES.some(value => value === category)) {
    throw new MemberInputError("Loại giá trị lưu trữ không hợp lệ.");
  }
  return { ...scope, category };
}

function renewalDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 2000 || Number(value.slice(0, 4)) > 2100 ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new MemberInputError(`${label} không hợp lệ.`);
  return value;
}

export function validateRenewalSearch(data: unknown) {
  const scope = validateRenewalScope(data);
  const input = data as Record<string, unknown>;
  const startDate = input.startDate == null || input.startDate === "" ? "2000-01-01" : renewalDate(input.startDate, "Ngày bắt đầu");
  const endDate = input.endDate == null || input.endDate === "" ? "2100-12-31" : renewalDate(input.endDate, "Ngày kết thúc");
  if (startDate > endDate) throw new MemberInputError("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
  const page = input.page ?? 1;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 10000) throw new MemberInputError("Trang tìm kiếm không hợp lệ.");
  return { ...scope, startDate, endDate, page, limit: 50 };
}

export function validateRenewalInput(data: unknown) {
  const scope = validateRenewalScope(data);
  const input = data as Record<string, unknown>;
  if (typeof input.operationId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.operationId)) {
    throw new MemberInputError("Mã thao tác gia hạn không hợp lệ.");
  }
  if (typeof input.delayId !== "string" || !/^[\w-]{1,128}$/.test(input.delayId)) {
    throw new MemberInputError("Mã khoản giá trị không hợp lệ.");
  }
  const date = input.delayDate;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number(date.slice(0, 4)) < 2000 || Number(date.slice(0, 4)) > 2100 ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new MemberInputError("Ngày hết hạn mới không hợp lệ.");
  }
  const remark = typeof input.remark === "string" ? input.remark.trim() : "";
  if (remark.length < 5 || remark.length > 500) throw new MemberInputError("Ghi chú gia hạn phải có từ 5 đến 500 ký tự.");
  const originalExpiryDate = input.originalExpiryDate === undefined ? undefined : renewalDate(input.originalExpiryDate, "Hạn sử dụng gốc");
  return { ...scope, operationId: input.operationId, delayId: input.delayId, delayDate: date, remark, ...(originalExpiryDate ? { originalExpiryDate } : {}) };
}

export function hkCalendarDate(now = new Date()): string {
  // HK sends calendar dates, using the shop's existing Vietnam time semantics.
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
