import {
  MEMBER_ACCOUNT_ATTRIBUTES,
  MEMBER_BALANCE_CATEGORIES,
  type HKAccountDto,
  type HKMemberCardDto,
  type HKMemberLookupDataDto,
  type HKMemberPackageDetailDto,
  type HKMemberPackageListItemDto,
  type HKMemberPassTicketDto,
  type HKMemberStoredValueLogDto,
  type HKNumberish,
  type HKOrderPrecalculationDto,
  type HKStoredValueDto,
  type MemberAccountDefinition,
  type MemberBalanceBucket,
  type MemberBalances,
  type MemberCard,
  type MemberGender,
  type MemberLookupContext,
  type MemberPassTicket,
  type MemberPointPackage,
  type MemberProfile,
  type MemberStoredValueCategory,
  type MemberStoredValueRecord,
} from "../types/member";

export class MemberMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberMappingError";
  }
}

function toOptionalString(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value: HKNumberish): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toRequiredNumber(value: HKNumberish, fieldName: string): number {
  const numberValue = toFiniteNumber(value);
  if (numberValue === null) {
    throw new MemberMappingError(`Response thiếu giá trị hợp lệ cho ${fieldName}.`);
  }
  return numberValue;
}

function normalizeBalanceCategory(value: number): number {
  if (value >= 1 && value <= 99) return value + 100;
  if (value >= 1001 && value <= 1099) return value - 900;
  return value;
}

function normalizeGender(value: string | number | null | undefined): MemberGender {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["male", "m", "1", "nam", "男"].includes(normalized)) return "MALE";
  if (["female", "f", "2", "nữ", "nu", "女"].includes(normalized)) {
    return "FEMALE";
  }
  if (["3", "không rõ", "unknown"].includes(normalized)) return "UNKNOWN";
  if (normalized) return "OTHER";
  return "UNKNOWN";
}

function accountBucket(extendAttr: number): MemberBalanceBucket {
  switch (extendAttr) {
    case MEMBER_ACCOUNT_ATTRIBUTES.PRINCIPAL_VND:
      return "PRINCIPAL_VND";
    case MEMBER_ACCOUNT_ATTRIBUTES.BONUS:
      return "BONUS";
    case MEMBER_ACCOUNT_ATTRIBUTES.TURNS:
      return "TURNS";
    case MEMBER_ACCOUNT_ATTRIBUTES.INTEGRAL:
      return "INTEGRAL";
    case MEMBER_ACCOUNT_ATTRIBUTES.POINTS:
      return "POINTS";
    default:
      return "OTHER";
  }
}

export function mapMemberBalances(values: HKStoredValueDto[] | null | undefined): MemberBalances {
  const valuesByCategory = new Map<number, number>();

  for (const item of values ?? []) {
    const rawCategory = toFiniteNumber(item.category);
    const value = toFiniteNumber(item.value);
    if (rawCategory !== null && value !== null) {
      valuesByCategory.set(normalizeBalanceCategory(rawCategory), value);
    }
  }

  const principalVnd = valuesByCategory.get(MEMBER_BALANCE_CATEGORIES.PRINCIPAL_VND) ?? 0;
  const bonus = valuesByCategory.get(MEMBER_BALANCE_CATEGORIES.BONUS) ?? 0;
  const turns = valuesByCategory.get(MEMBER_BALANCE_CATEGORIES.TURNS) ?? 0;
  const integral = valuesByCategory.get(MEMBER_BALANCE_CATEGORIES.INTEGRAL) ?? 0;
  const points = valuesByCategory.get(MEMBER_BALANCE_CATEGORIES.POINTS) ?? 0;
  const knownCategories = new Set<number>(Object.values(MEMBER_BALANCE_CATEGORIES));
  const other = Object.fromEntries(
    [...valuesByCategory].filter(([category]) => !knownCategories.has(category)),
  );

  return {
    principalVnd,
    bonus,
    totalAvailable: principalVnd + bonus,
    turns,
    integral,
    points,
    other,
  };
}

export function mapMemberLookup(
  data: HKMemberLookupDataDto,
  context: MemberLookupContext = {},
): MemberProfile {
  const { shopId, memberCode } = context;
  const hasShopItems = Array.isArray(data.items);
  const selectedShop = hasShopItems
    ? data.items?.find((item) => toFiniteNumber(item.shopId) === shopId)
    : undefined;

  if (hasShopItems && !selectedShop) {
    throw new MemberMappingError("Không tìm thấy tài khoản thành viên tại cửa hàng hiện tại.");
  }

  const uid = toOptionalString(selectedShop?.uid ?? data.uid);
  if (!uid) throw new MemberMappingError("Response thành viên không có UID hợp lệ.");

  const storedValues =
    selectedShop?.storedValues ??
    selectedShop?.storedValue ??
    data.storedValues ??
    data.storedValue;

  return {
    uid,
    mid: toOptionalString(data.mid) || null,
    memberCode: toOptionalString(data.memberCode ?? memberCode) || null,
    phone: toOptionalString(data.phone),
    fullName: toOptionalString(data.realName),
    gender: normalizeGender(data.sex),
    birthDate: data.birthday?.slice(0, 10) || null,
    email: data.email?.trim().toLowerCase() || null,
    ...(data.nickName !== undefined ? { nickName: data.nickName ?? "" } : {}),
    levelName: toOptionalString(selectedShop?.levelName ?? data.levelName),
    shopId: selectedShop ? toFiniteNumber(selectedShop.shopId) : shopId ?? null,
    shopName: toOptionalString(selectedShop?.shopName) || null,
    balances: mapMemberBalances(storedValues),
  };
}

export function mapMemberStoredValueRecords(
  records: HKMemberStoredValueLogDto[],
  storedCategory: MemberStoredValueCategory,
): MemberStoredValueRecord[] {
  return records.map((record) => {
    const flowType = toRequiredNumber(record.flowType, "flowType");
    if (flowType !== 1 && flowType !== 2) {
      throw new MemberMappingError("Response lịch sử có flowType không hợp lệ.");
    }
    return {
      storedCategory,
      createTime: toOptionalString(record.createTime),
      flowType,
      businessType: toRequiredNumber(record.businessType, "businessType"),
      businessTypeName: toOptionalString(record.businessTypeName),
      beforeAmount: toRequiredNumber(record.beforeAmount, "beforeAmount"),
      amount: Math.abs(toRequiredNumber(record.amount, "amount")),
      afterAmount: toRequiredNumber(record.afterAmount, "afterAmount"),
      remark: toOptionalString(record.remark),
    };
  });
}

export function mapMemberCards(cards: HKMemberCardDto[]): MemberCard[] {
  return cards.flatMap((card) => {
    const memberCode = toOptionalString(card.memberCode);
    if (!memberCode) return [];
    return [{
      category: toFiniteNumber(card.category) ?? 0,
      memberCode,
      icCard: toOptionalString(card.icCard),
      remark: toOptionalString(card.remark),
    }];
  });
}

export function mapMemberPassTickets(
  tickets: HKMemberPassTicketDto[],
): MemberPassTicket[] {
  return tickets.flatMap((ticket) => {
    const passticketId = toOptionalString(ticket.passticketId);
    if (!passticketId) return [];
    return [{
      passticketId,
      name: toOptionalString(ticket.passticketName) || "Vé thành viên",
      category: toFiniteNumber(ticket.passticketCategory) ?? 0,
      activeMode: toFiniteNumber(ticket.activeMode) ?? 0,
      buyAmount: toFiniteNumber(ticket.buyAmount) ?? 0,
      enabledAmount: toFiniteNumber(ticket.enabledAmount) ?? 0,
      buyTime: toOptionalString(ticket.buyTime),
      startTime: toOptionalString(ticket.startTime),
      endTime: toOptionalString(ticket.endTime),
    }];
  });
}

export function mapMemberAccounts(accounts: HKAccountDto[]): MemberAccountDefinition[] {
  return accounts.flatMap((account) => {
    const accountId = toOptionalString(account.key ?? account.shopAcctId ?? account.id);
    const extendAttr = toFiniteNumber(account.extendAttr);
    if (!accountId || extendAttr === null) return [];

    return [{
      accountId,
      name: toOptionalString(account.value ?? account.name),
      extendAttr,
      unit: toOptionalString(account.unit),
      bucket: accountBucket(extendAttr),
    }];
  });
}

export function mapMemberPointPackage(input: {
  listItem: HKMemberPackageListItemDto;
  detail: HKMemberPackageDetailDto;
  precalculation: HKOrderPrecalculationDto;
  accounts: MemberAccountDefinition[];
}): MemberPointPackage | null {
  const goodsId = toOptionalString(input.listItem.goodsId ?? input.detail.setMealId);
  if (!goodsId) throw new MemberMappingError("Gói thành viên không có goodsId hợp lệ.");

  const accountsById = new Map(
    input.accounts.map((account) => [account.accountId, account]),
  );
  const credits = (input.detail.giveConfigs ?? []).flatMap((config) => {
    const accountId = toOptionalString(config.shopAcctId);
    const amount = toFiniteNumber(config.giveAmount);
    if (!accountId || amount === null || amount <= 0) return [];

    const account = accountsById.get(accountId);
    return [{
      accountId,
      accountName: account?.name ?? "",
      bucket: account?.bucket ?? "OTHER" as const,
      amount,
      effectiveMode: toFiniteNumber(config.effectiveMode),
      effectiveDays: toFiniteNumber(config.effectiveDays),
    }];
  });

  const principalPoints =
    toFiniteNumber(input.detail.amount) ??
    toFiniteNumber(input.detail.Amount) ??
    0;
  const bonusBucketPoints = (input.detail.giveConfigs ?? [])
    .reduce((total, config) => {
      const giveAmount = toFiniteNumber(config.giveAmount);
      return giveAmount !== null && giveAmount > 0
        ? total + giveAmount
        : total;
    }, 0);
  const totalPoints = principalPoints + bonusBucketPoints;

  if (principalPoints < 0 || bonusBucketPoints < 0 || totalPoints <= 0) return null;

  const paymentAmountVnd = toRequiredNumber(
    input.precalculation.totalMoney,
    "order_precalculate.data.totalMoney",
  );
  const priceBeforeTaxVnd = toFiniteNumber(input.detail.price) ?? 0;
  const afterTaxPriceVnd = toFiniteNumber(input.detail.afterTaxPrice) ??
    paymentAmountVnd;
  const taxRateType = toFiniteNumber(input.detail.taxRateType) ?? 1;
  const explicitTaxRate = toFiniteNumber(
    input.detail.taxRate ?? input.detail.setmealTypeTaxRate,
  );
  const taxRate = explicitTaxRate ?? (
    priceBeforeTaxVnd > 0
      ? ((afterTaxPriceVnd - priceBeforeTaxVnd) / priceBeforeTaxVnd) * 100
      : 0
  );

  if (taxRate < 0 || ![1, 2].includes(taxRateType)) {
    throw new MemberMappingError("Gói thành viên có cấu hình thuế không hợp lệ.");
  }
  return {
    goodsId,
    category: toFiniteNumber(input.listItem.category ?? input.detail.category) ?? 1,
    name: toOptionalString(input.listItem.goodsName ?? input.detail.setMealName),
    description: toOptionalString(input.listItem.remark),
    badge: toOptionalString(input.listItem.badge),
    paymentAmountVnd,
    originalAmountVnd:
      toFiniteNumber(input.precalculation.totalOriginalMoney) ??
      toRequiredNumber(input.precalculation.totalMoney, "totalMoney"),
    discountAmountVnd: toFiniteNumber(input.precalculation.totalDiscountMoney) ?? 0,
    priceBeforeTaxVnd,
    taxRate: Number(taxRate.toFixed(4)),
    taxRateType,
    principalPoints,
    bonusBucketPoints,
    totalPoints,
    extraBonusPoints: null,
    credits,
  };
}
