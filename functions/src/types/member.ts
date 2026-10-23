import type { MemberProfileEditMetadata } from "./memberProfileEdit";
export type HKNumberish = number | string | null | undefined;

/** HK balance columns: 104 = Điểm, 106 = Lượt. */
export const MEMBER_BALANCE_CATEGORIES = {
  PRINCIPAL_VND: 101,
  BONUS: 102,
  TURNS: 106,
  INTEGRAL: 105,
  POINTS: 104,
} as const;

/** HK account attributes: 1 = Tiền, 4 = Điểm, 6 = Lượt. */
export const MEMBER_ACCOUNT_ATTRIBUTES = {
  PRINCIPAL_VND: 1,
  BONUS: 2,
  TURNS: 6,
  INTEGRAL: 5,
  POINTS: 4,
} as const;

export type MemberCompensationCategory =
  | typeof MEMBER_ACCOUNT_ATTRIBUTES.PRINCIPAL_VND
  | typeof MEMBER_ACCOUNT_ATTRIBUTES.TURNS
  | typeof MEMBER_ACCOUNT_ATTRIBUTES.POINTS;

export type MemberGender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
export type MemberBalanceBucket =
  | "PRINCIPAL_VND"
  | "BONUS"
  | "TURNS"
  | "INTEGRAL"
  | "POINTS"
  | "OTHER";

export interface HKApiResponseDto<TData> {
  success: boolean;
  code: number;
  msg: string;
  data: TData | null;
  desc?: string;
}

export interface HKMemberRegistrationBodyDto {
  openId: string;
  phone: string;
  realName: string;
  password?: string;
}

export interface HKMemberRegistrationDataDto {
  uid?: string | null;
  mid?: string | null;
}

export interface HKMemberProfileUpdateBodyDto {
  uid: string;
  mid?: string;
  realName?: string;
  nickName?: string;
  email?: string;
  sex?: 1 | 2;
  birthday?: string;
}

export interface HKStoredValueDto {
  category?: HKNumberish;
  value?: HKNumberish;
}

export interface HKMemberShopDto {
  shopId?: HKNumberish;
  shopName?: string | null;
  uid?: string | null;
  levelName?: string | null;
  storedValues?: HKStoredValueDto[] | null;
  storedValue?: HKStoredValueDto[] | null;
}

export interface HKMemberLookupDataDto {
  nickName?: string | null;
  email?: string | null;
  birthday?: string | null;
  uid?: string | null;
  mid?: string | null;
  memberCode?: string | null;
  phone?: string | null;
  realName?: string | null;
  sex?: string | number | null;
  levelName?: string | null;
  storedValues?: HKStoredValueDto[] | null;
  storedValue?: HKStoredValueDto[] | null;
  items?: HKMemberShopDto[] | null;
}

export interface HKAccountDto {
  key?: string | null;
  id?: string | null;
  shopAcctId?: string | null;
  value?: string | null;
  name?: string | null;
  extendAttr?: HKNumberish;
  unit?: string | null;
}

export interface HKPackageGiveConfigDto {
  shopAcctId?: string | null;
  giveAmount?: HKNumberish;
  effectiveMode?: HKNumberish;
  effectiveDays?: HKNumberish;
}

export interface HKMemberPackageListItemDto {
  goodsId?: string | null;
  goodsName?: string | null;
  category?: HKNumberish;
  price?: HKNumberish;
  remark?: string | null;
  badge?: string | null;
}

export interface HKMemberPackageDetailDto {
  setMealId?: string | null;
  setMealName?: string | null;
  category?: HKNumberish;
  typeId?: string | null;
  typeName?: string | null;
  price?: HKNumberish;
  afterTaxPrice?: HKNumberish;
  taxRate?: HKNumberish;
  setmealTypeTaxRate?: HKNumberish;
  taxRateType?: HKNumberish;
  amount?: HKNumberish;
  Amount?: HKNumberish;
  givecoin1?: HKNumberish;
  giveCoin1?: HKNumberish;
  GiveCoin1?: HKNumberish;
  foreColor?: string | null;
  backColor?: string | null;
  isEnabled?: boolean | null;
  isOpenSales?: boolean | null;
  giveConfigs?: HKPackageGiveConfigDto[] | null;
  exchangeSetts?: unknown[] | null;
}

export interface HKOrderPrecalculationDto {
  totalOriginalMoney?: HKNumberish;
  totalDiscountMoney?: HKNumberish;
  totalMoney?: HKNumberish;
  totalQty?: HKNumberish;
}

export interface HKMemberStoredValueLogDto {
  createTime?: string | null;
  flowType?: HKNumberish;
  businessType?: HKNumberish;
  businessTypeName?: string | null;
  beforeAmount?: HKNumberish;
  amount?: HKNumberish;
  afterAmount?: HKNumberish;
  remark?: string | null;
}

export interface HKMemberCardDto {
  category?: HKNumberish;
  memberCode?: string | null;
  icCard?: string | null;
  remark?: string | null;
}

export interface HKMemberPassTicketDto {
  passticketId?: string | null;
  passticketName?: string | null;
  passticketCategory?: HKNumberish;
  activeMode?: HKNumberish;
  maxNumber?: HKNumberish;
  takeMaxNumber?: HKNumberish;
  maxPlayTime?: HKNumberish;
  maxAccompany?: HKNumberish;
  buyAmount?: HKNumberish;
  enabledAmount?: HKNumberish;
  buyTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

export interface HKMemberCompensationDataDto {
  totalValue?: HKNumberish;
}

export type MemberCompensationStatus =
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN";

export interface MemberCompensationRecord {
  id: string;
  warehouse_id: string;
  shop_id: number;
  member_uid: string;
  member_code: string | null;
  member_name: string;
  /** Nạp bù thủ công dùng Tiền (1)/Lượt (6); nạp điểm (4) dành cho luồng hàng loạt. */
  stored_category: MemberCompensationCategory;
  amount: number;
  reason: string;
  accounting_category: 1004;
  status: MemberCompensationStatus;
  created_by: string;
  created_by_name: string;
  device_id: string;
  action_time: Date;
  sync_time: Date;
  attempt_count: number;
  remote_total_value: number | null;
  remote_code: number | null;
  remote_message: string | null;
  completed_at: Date | null;
  is_deleted: false;
  created_at: Date;
  updated_at: Date;
}

export interface MemberBalances {
  principalVnd: number;
  bonus: number;
  totalAvailable: number;
  turns: number;
  integral: number;
  points: number;
  other: Record<string, number>;
}

export interface MemberProfile extends MemberProfileEditMetadata {
  isEnabled?: boolean | null;
  uid: string;
  mid: string | null;
  memberCode: string | null;
  phone: string;
  fullName: string;
  gender: MemberGender;
  birthDate: string | null;
  email: string | null;
  levelName: string;
  shopId: number | null;
  shopName: string | null;
  balances: MemberBalances;
}

export interface MemberAccountDefinition {
  accountId: string;
  name: string;
  extendAttr: number;
  unit: string;
  bucket: MemberBalanceBucket;
}

export interface MemberPackageCredit {
  accountId: string;
  accountName: string;
  bucket: MemberBalanceBucket;
  amount: number;
  effectiveMode: number | null;
  effectiveDays: number | null;
}

export interface MemberPointPackage {
  goodsId: string;
  name: string;
  description: string;
  badge: string;
  paymentAmountVnd: number;
  originalAmountVnd: number;
  discountAmountVnd: number;
  priceBeforeTaxVnd: number;
  taxRate: number;
  taxRateType: number;
  principalPoints: number;
  bonusBucketPoints: number;
  totalPoints: number;
  category?: number;
  typeName?: string;
  foreColor?: string;
  backColor?: string;
  extraBonusPoints: number | null;
  credits: MemberPackageCredit[];
}

export type MemberStoredValueCategory = 1 | 2 | 4 | 5 | 6 | 7;

export interface MemberStoredValueRecord {
  storedCategory: MemberStoredValueCategory;
  createTime: string;
  flowType: 1 | 2;
  businessType: number;
  businessTypeName: string;
  beforeAmount: number;
  amount: number;
  afterAmount: number;
  remark: string;
}

export interface MemberCard {
  category: number;
  memberCode: string;
  icCard: string;
  remark: string;
}

export interface MemberPassTicket {
  passticketId: string;
  name: string;
  category: number;
  activeMode: number;
  buyAmount: number;
  enabledAmount: number;
  buyTime: string;
  startTime: string;
  endTime: string;
}

export interface MemberLookupContext {
  shopId?: number;
  memberCode?: string;
}

export interface StoredMemberProfile extends MemberProfileEditMetadata {
  hkSnapshot?: Record<string, unknown>;
  hkImportHash?: string;
  hkImportedAt?: string;
  hkImportUnassigned?: boolean;
  schemaVersion: 1;
  remoteUid: string;
  mid: string | null;
  memberCode: string | null;
  phone: string;
  fullName: string;
  gender: MemberGender;
  birthDate: string | null;
  email: string | null;
  shopId: number;
  warehouseId: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  lastRemoteSyncAt: string;
}
