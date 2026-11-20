import { MemberInputError } from "./memberPolicy";
import type { OrderMemberSnapshot } from "../types/order";

const ORDER_ID_PATTERN = /^ORD-\d{10,13}-[A-Z0-9]{6}$/;

export interface MemberPackageCatalogInput {
  shopId: number;
  warehouseId: string;
  uid: string;
}

export interface MemberPackageSaleInput extends MemberPackageCatalogInput {
  localOrderId: string;
  goodsId: string;
  quotedPrice?: number;
  member: OrderMemberSnapshot;
}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new MemberInputError("Dữ liệu bán gói thành viên không hợp lệ.");
  }
  return data as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new MemberInputError(`${label} không hợp lệ.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new MemberInputError(`${label} không hợp lệ.`);
  }
  return normalized;
}

export function validateMemberPackageCatalogInput(
  data: unknown,
): MemberPackageCatalogInput {
  const input = record(data);
  if (!Number.isInteger(input.shopId) || Number(input.shopId) <= 0) {
    throw new MemberInputError("Mã cửa hàng không hợp lệ.");
  }
  return {
    shopId: Number(input.shopId),
    warehouseId: requiredString(input.warehouseId, "Điểm bán", 128),
    uid: requiredString(input.uid, "UID thành viên", 128),
  };
}

export function validateMemberPackageSaleInput(
  data: unknown,
): MemberPackageSaleInput {
  const input = record(data);
  const catalog = validateMemberPackageCatalogInput(input);
  const localOrderId = requiredString(input.localOrderId, "Mã đơn hàng", 64);
  if (!ORDER_ID_PATTERN.test(localOrderId)) {
    throw new MemberInputError("Mã đơn hàng không hợp lệ.");
  }
  const candidate = record(input.member);
  const goodsId = requiredString(input.goodsId, "Mã gói thành viên", 128);
  if (goodsId.includes("/") || goodsId === "." || goodsId === ".." ||
      (input.quotedPrice !== undefined && (!Number.isSafeInteger(input.quotedPrice) || Number(input.quotedPrice) < 0))) {
    throw new MemberInputError("Mã gói hoặc giá hiển thị không hợp lệ.");
  }
  const memberCode = candidate.memberCode;
  if (
    typeof candidate.uid !== "string" ||
    candidate.uid.trim() !== catalog.uid ||
    (memberCode !== null &&
      (typeof memberCode !== "string" || memberCode.trim().length > 128)) ||
    typeof candidate.fullName !== "string" ||
    !candidate.fullName.trim() ||
    candidate.fullName.trim().length > 120 ||
    typeof candidate.phone !== "string" ||
    !candidate.phone.trim() ||
    candidate.phone.trim().length > 32 ||
    typeof candidate.levelName !== "string" ||
    candidate.levelName.trim().length > 120
  ) {
    throw new MemberInputError("Thông tin khách hàng mua gói không hợp lệ.");
  }
  return {
    ...catalog,
    localOrderId,
    goodsId,
    ...(typeof input.quotedPrice === "number" ? { quotedPrice: input.quotedPrice } : {}),
    member: {
      uid: candidate.uid.trim(),
      memberCode: typeof memberCode === "string" ? memberCode.trim() || null : null,
      fullName: candidate.fullName.trim(),
      phone: candidate.phone.trim(),
      levelName: candidate.levelName.trim(),
    },
  };
}

export function validateMemberPackageOrderId(data: unknown): string {
  const input = record(data);
  const localOrderId = requiredString(input.localOrderId, "Mã đơn hàng", 64);
  if (!ORDER_ID_PATTERN.test(localOrderId)) {
    throw new MemberInputError("Mã đơn hàng không hợp lệ.");
  }
  return localOrderId;
}
