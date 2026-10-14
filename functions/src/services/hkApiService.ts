// =============================================================================
// HK API Service — Handles communication with the remote 鲸舰 API
// =============================================================================
// This service sends signed requests to the HK API for order creation and
// payment confirmation. Uses `generateHkApiRequest` from the signature utility
// to build signed envelopes.
//
// Mock mode: When HK_API_BASE_URL is empty or contains "[REMOTE_API_DOMAIN]",
// returns simulated success responses for local development.
//
// Reference: 海外-鲸舰-OpenApi.md → § 订单
// =============================================================================

import { generateHkApiRequest } from "../utils/hk-signature";
import * as functions from "firebase-functions";
import {
  type MemberCompensationCategory,
  type HKAccountDto,
  type HKMemberCardDto,
  type HKMemberCompensationDataDto,
  type HKMemberLookupDataDto,
  type HKMemberPackageDetailDto,
  type HKMemberPassTicketDto,
  type HKMemberProfileUpdateBodyDto,
  type HKMemberRegistrationBodyDto,
  type HKMemberRegistrationDataDto,
  type HKMemberStoredValueLogDto,
  type HKOrderPrecalculationDto,
} from "../types/member";

// =============================================================================
// Response Types (matching real API shape)
// =============================================================================

/** Standard response from the HK API. */
export interface HKApiResponse<TData = Record<string, unknown>> {
  success: boolean;
  code: number;
  msg: string;
  data: TData | null;
  desc?: string;
  page?: number;
  limit?: number;
  totalPage?: number;
  totalRecord?: number;
}

export interface RemoteOrderItemInput {
  goodsId: string;
  quantity: string;
}

export type RemoteOrderCreateBody = {
  Uid: string;
  GoodsItems: Array<{ GoodsId: string; Quantity: string }>;
};

export type RemoteOrderPayBody = {
  OrderNumber: string;
  PayAmount: number | null;
};

export type RemoteMemberCompensationBody = {
  uid: string;
  tradeNo: string;
  category: 1004;
  storedCategory: MemberCompensationCategory;
  storedValue: number;
  effectiveDays: 0;
  bizCode: string;
  remark: string;
};

export type RemoteMemberRegistrationBody = {
  openId: string;
  phone: string;
  realName: string;
};

/** `member_join` does not accept or attach a physical membership card. */
export function buildRemoteMemberRegistrationBody(
  input: HKMemberRegistrationBodyDto,
): RemoteMemberRegistrationBody {
  return {
    openId: input.openId,
    phone: input.phone,
    realName: input.realName,
  };
}

export function buildRemoteMemberCompensationBody(params: {
  uid: string;
  operationId: string;
  storedCategory: MemberCompensationCategory;
  amount: number;
  remark: string;
}): RemoteMemberCompensationBody {
  return {
    uid: params.uid,
    tradeNo: params.operationId,
    category: 1004,
    storedCategory: params.storedCategory,
    storedValue: params.amount,
    effectiveDays: 0,
    bizCode: params.operationId,
    remark: params.remark,
  };
}

/**
 * Build the exact order_create body documented by the HK OpenAPI.
 * JPOS payment fields intentionally never cross this integration boundary.
 */
export function buildRemoteOrderCreateBody(params: {
  uid: string;
  goodsItems: RemoteOrderItemInput[];
}): RemoteOrderCreateBody {
  return {
    Uid: params.uid,
    GoodsItems: params.goodsItems.map((item) => ({
      GoodsId: item.goodsId,
      Quantity: item.quantity,
    })),
  };
}

/**
 * The HK system uses its one default payment method. PayAmount=null asks it to
 * settle the full remote order and no JPOS/PayOS payment method is transmitted.
 */
export function buildRemoteOrderPayBody(
  orderNumber: string,
  payAmount: number | null = null,
): RemoteOrderPayBody {
  return { OrderNumber: orderNumber, PayAmount: payAmount };
}

// =============================================================================
// Internal: Send signed request
// =============================================================================

/**
 * Determine if mock mode is active.
 * Mock mode is used when no real API URL is configured.
 */
function isMockMode(): boolean {
  const baseUrl = process.env.HK_API_BASE_URL;
  return !baseUrl || baseUrl.includes("[REMOTE_API_DOMAIN]");
}

export function resolveHkApiEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (!endpoint.pathname.endsWith("/openapi/action")) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/openapi/action`;
  }
  return endpoint.toString();
}

/**
 * Send a signed request to the HK API.
 *
 * @param action - The API action name (e.g., "order_create").
 * @param body - The business parameters object.
 * @returns The parsed API response.
 */
async function sendToHKApi<TData = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>,
  version?: string
): Promise<HKApiResponse<TData>> {
  const signedRequest = generateHkApiRequest({ action, body, version });

  if (isMockMode()) {
    // ── MOCK MODE ──────────────────────────────────────────────────────────
    functions.logger.info(`[HK API Mock] Action: ${action}`);

    // Return mock success responses based on action
    switch (action) {
      case "order_precalculate":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            totalOriginalMoney: 100,
            totalDiscountMoney: 0,
            totalMoney: 100,
            totalQty: 1,
            goodsList: [],
          } as unknown as TData,
          desc: "Mock response",
        };

      case "order_create":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            orderNumber: `O-MOCK-${Date.now()}`,
            totalAmount: 100,
            discountAmount: 0,
            actualPayment: 100,
          } as unknown as TData,
          desc: "Mock response",
        };

      case "order_pay":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            orderNumber: (body.OrderNumber as string) || `O-MOCK-${Date.now()}`,
          } as unknown as TData,
          desc: "Mock response",
        };

      case "order_pay_query":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            orderNumber: (body.OrderNumber as string) || "",
            payStatus: 2,
            payStatusDesc: "已支付",
          } as unknown as TData,
          desc: "Mock response",
        };

      case "gift_realtime_stock":
        return {
          success: true,
          msg: "",
          code: 0,
          data: { items: [] } as unknown as TData,
          desc: "Mock response",
        };

      case "setmeal_getsellgoods":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            goodsItems: String(body.Category) === "1" ? [{
              goodsId: "mock-member-package",
              goodsName: "Gói điểm thử nghiệm",
              category: 1,
              price: 100,
              remark: "Dữ liệu mô phỏng cục bộ",
              badge: "",
            }] : [],
          } as unknown as TData,
          desc: "Mock response",
        };

      case "member_getmember_phone":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            mid: "mock-member",
            phone: String(body.phone || ""),
            realName: "Thành viên thử nghiệm",
            sex: "male",
            items: [{
              shopId: Number(body.shopId),
              shopName: "Cửa hàng thử nghiệm",
              uid: "mock-member-account",
              levelName: "",
              storedValues: [],
            }],
          } as TData,
          desc: "Mock response",
        };

      case "member_getmember_membercode":
      case "member_getmember_uid":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            uid: "mock-member-account",
            memberCode: String(body.memberCode || ""),
            nickName: "Thành viên thử nghiệm",
            email: "",
            birthday: "",
            phone: "0900000000",
            realName: "Thành viên thử nghiệm",
            sex: "male",
            levelName: "",
            storedValue: [],
          } as TData,
          desc: "Mock response",
        };

      case "member_join":
        return {
          success: true,
          msg: "Đăng ký thành công",
          code: 0,
          data: {
            uid: "mock-member-account",
            mid: "mock-member",
          } as TData,
          desc: "Mock response",
        };

      case "member_info_modify":
        return {
          success: true,
          msg: "Cập nhật thông tin thành viên thành công",
          code: 0,
          data: true as TData,
          desc: "Mock response",
        };

      case "member_addstored":
        return {
          success: true,
          msg: "Nạp bù thành công",
          code: 0,
          data: {
            totalValue: Number(body.storedValue) || 0,
          } as TData,
          desc: "Mock response",
        };

      case "member_getstored_log":
        return {
          success: true,
          msg: "",
          code: 0,
          page: Number(body.page) || 1,
          limit: Number(body.limit) || 20,
          totalPage: 1,
          totalRecord: 3,
          data: [
            {
              createTime: "2026-08-10 10:45:29",
              flowType: 1,
              businessType: 1001,
              businessTypeName: "Nạp tài khoản",
              beforeAmount: 1400,
              amount: 50,
              afterAmount: 1450,
              remark: "Nạp thêm 50 điểm",
            },
            {
              createTime: "2026-08-10 10:40:22",
              flowType: 2,
              businessType: 2001,
              businessTypeName: "Chơi máy",
              beforeAmount: 1450,
              amount: 50,
              afterAmount: 1400,
              remark: "Sử dụng 50 điểm tại máy game",
            },
            {
              createTime: "2026-08-10 10:30:20",
              flowType: 2,
              businessType: 2001,
              businessTypeName: "Chơi máy",
              beforeAmount: 1500,
              amount: 50,
              afterAmount: 1450,
              remark: "Sử dụng 50 điểm tại máy game",
            },
          ] as TData,
          desc: "Mock response",
        };

      case "member_getmembercode":
        return {
          success: true,
          msg: "",
          code: 0,
          data: [{
            category: 1,
            memberCode: "MOCK-CARD-001",
            icCard: "MOCK-IC-CARD",
            remark: "Thẻ vật lý thử nghiệm",
          }] as TData,
          desc: "Mock response",
        };

      case "member_passticket_list":
        return {
          success: true,
          msg: "",
          code: 0,
          data: [{
            passticketId: "mock-ticket-001",
            passticketName: "Vé 10 lượt thử nghiệm",
            passticketCategory: 1,
            activeMode: 1,
            buyAmount: 10,
            enabledAmount: 8,
            buyTime: "2026-08-01 09:00:00",
            startTime: "2026-08-01 09:00:00",
            endTime: "2026-09-01 23:59:59",
          }] as TData,
          desc: "Mock response",
        };

      case "basic_account_list":
        return {
          success: true,
          msg: "",
          code: 0,
          data: [{
            key: "mock-bonus-account",
            value: "Tiền thưởng",
            extendAttr: 2,
            unit: "Điểm",
          }] as unknown as TData,
          desc: "Mock response",
        };

      case "setmeal_passticket_details":
        return {
          success: true,
          msg: "",
          code: 0,
          data: {
            setMealId: String(body.setmealId || ""),
            setMealName: "Gói thành viên thử nghiệm",
            category: 1,
            price: 100,
            afterTaxPrice: 100,
            taxRate: 0,
            taxRateType: 1,
            giveConfigs: [{
              shopAcctId: "mock-bonus-account",
              giveAmount: 120,
              effectiveMode: 1,
              effectiveDays: 0,
            }],
          } as TData,
          desc: "Mock response",
        };

      default:
        return {
          success: true,
          msg: "",
          code: 0,
          data: {} as TData,
          desc: "Mock response (unknown action)",
        };
    }
  }

  // ── REAL API CALL ──────────────────────────────────────────────────────
  const endpoint = resolveHkApiEndpoint(process.env.HK_API_BASE_URL!);

  functions.logger.info(`[HK API] Sending ${action}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedRequest),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(
      `HK API HTTP error: ${response.status} ${response.statusText}`
    );
  }

  const result = (await response.json()) as HKApiResponse<TData>;

  functions.logger.info(`[HK API] Response for ${action}:`, {
    success: result.success,
    code: result.code,
    msg: result.msg,
  });

  return result;
}

// =============================================================================
// Public API Methods
// =============================================================================

/**
 * Pre-calculate order totals and discounts.
 * Action: `order_precalculate`
 *
 * @param params - Uid and GoodsItems.
 * @returns Calculated totals from the HK system.
 */
export async function precalculateOrder(params: {
  uid?: string;
  goodsItems: Array<{ goodsId: string; quantity: string }>;
}): Promise<HKApiResponse<HKOrderPrecalculationDto>> {
  return sendToHKApi<HKOrderPrecalculationDto>("order_precalculate", {
    Uid: params.uid || "",
    GoodsItems: params.goodsItems.map((item) => ({
      GoodsId: item.goodsId,
      Quantity: item.quantity,
    })),
  });
}

/**
 * Create an order on the HK remote system.
 * Action: `order_create`
 *
 * @param params - Member UID and goods items.
 * @returns Response with `data.orderNumber`, `data.totalAmount`, etc.
 */
export async function createRemoteOrder(params: {
  uid: string;
  goodsItems: RemoteOrderItemInput[];
}): Promise<HKApiResponse> {
  return sendToHKApi("order_create", buildRemoteOrderCreateBody(params));
}

/**
 * Confirm payment for an order on the HK remote system.
 * Action: `order_pay`
 *
 * @param params - Order number only; the HK default payment method is used.
 * @returns Response confirming payment.
 */
export async function confirmRemotePayment(params: {
  orderNumber: string;
  payAmount?: number | null;
}): Promise<HKApiResponse> {
  return sendToHKApi(
    "order_pay",
    buildRemoteOrderPayBody(params.orderNumber, params.payAmount ?? null),
  );
}

/**
 * Query the payment status of an order.
 * Action: `order_pay_query`
 *
 * @param params - Order number to query.
 * @returns Response with `data.payStatus` (0-5) and `data.payStatusDesc`.
 */
export async function queryPaymentStatus(params: {
  orderNumber: string;
}): Promise<HKApiResponse> {
  return sendToHKApi("order_pay_query", {
    OrderNumber: params.orderNumber,
  });
}

// =============================================================================
// Members
// =============================================================================

export async function fetchRemoteMemberByPhone(params: {
  shopId: number;
  phone: string;
}): Promise<HKApiResponse<HKMemberLookupDataDto>> {
  return sendToHKApi<HKMemberLookupDataDto>(
    "member_getmember_phone",
    { shopId: params.shopId, phone: params.phone },
    "10.11.8",
  );
}

export async function fetchRemoteMemberByCard(
  memberCode: string,
): Promise<HKApiResponse<HKMemberLookupDataDto>> {
  return sendToHKApi<HKMemberLookupDataDto>(
    "member_getmember_membercode",
    { memberCode },
    "10.11.8",
  );
}

export async function fetchRemoteMemberByCardSerial(
  serialNumber: string,
): Promise<HKApiResponse<HKMemberLookupDataDto>> {
  return sendToHKApi<HKMemberLookupDataDto>(
    "member_getmember_serialnumber",
    { serialNumber },
    "10.11.8",
  );
}

export async function registerRemoteMember(
  input: HKMemberRegistrationBodyDto,
): Promise<HKApiResponse<HKMemberRegistrationDataDto>> {
  return sendToHKApi<HKMemberRegistrationDataDto>(
    "member_join",
    buildRemoteMemberRegistrationBody(input),
    "10.11.8",
  );
}

export async function updateRemoteMemberProfile(
  input: HKMemberProfileUpdateBodyDto,
): Promise<HKApiResponse<boolean>> {
  return sendToHKApi<boolean>(
    "member_info_modify",
    { ...input },
    "10.11.8",
  );
}

export async function fetchRemoteMemberByUid(uid: string): Promise<HKApiResponse<HKMemberLookupDataDto>> {
  return sendToHKApi<HKMemberLookupDataDto>("member_getmember_uid", { uid }, "10.11.8");
}

export async function returnRemoteMemberCard(input: { employeeName: string; bizCode: string; memberCode: string }) {
  if (!process.env.HK_API_BASE_URL || process.env.HK_API_BASE_URL.includes("[REMOTE_API_DOMAIN]")) throw new Error("Chưa cấu hình API HK thật để gỡ thẻ.");
  return sendToHKApi("member_return_card", { ...input, isReturnDeposit: false }, "10.11.8");
}

export async function fetchRemoteMemberList(input: { page: number; limit: number; endTime?: string; phone?: string }): Promise<HKApiResponse<Record<string, unknown>[]>> {
  const configuredUrl = process.env.HK_MEMBER_IMPORT_BASE_URL || process.env.HK_API_BASE_URL;
  if (!configuredUrl || configuredUrl.includes("REMOTE_API_DOMAIN")) throw new Error("Importer cần endpoint HK thật, không sử dụng mock.");
  const request = generateHkApiRequest({ action: "member_list", version: "10.11.8", body: { phone: "", sortField: "CreateTime", sortType: "asc", ...input } });
  const response = await fetch(resolveHkApiEndpoint(configuredUrl), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Không thể đọc danh sách HK: HTTP ${response.status}`);
  return await response.json() as HKApiResponse<Record<string, unknown>[]>;
}

export async function updateRemoteMemberPhone(uid: string, newphone: string): Promise<HKApiResponse<{ newPhone: string }>> {
  return sendToHKApi<{ newPhone: string }>("member_change_phone", { uid, newphone }, "10.11.8");
}

export async function compensateRemoteMemberBalance(params: {
  uid: string;
  operationId: string;
  storedCategory: MemberCompensationCategory;
  amount: number;
  remark: string;
}): Promise<HKApiResponse<HKMemberCompensationDataDto>> {
  return sendToHKApi<HKMemberCompensationDataDto>(
    "member_addstored",
    buildRemoteMemberCompensationBody(params),
    "10.11.8",
  );
}

export async function fetchRemoteMemberStoredValueHistory(params: {
  uid: string;
  storedCategory: number;
  startTime: string;
  endTime: string;
  page: number;
  limit: number;
}): Promise<HKApiResponse<HKMemberStoredValueLogDto[]>> {
  return sendToHKApi<HKMemberStoredValueLogDto[]>(
    "member_getstored_log",
    params,
    "10.11.8",
  );
}

export async function fetchRemoteMemberCards(
  uid: string,
): Promise<HKApiResponse<HKMemberCardDto[]>> {
  return sendToHKApi<HKMemberCardDto[]>(
    "member_getmembercode",
    { uid },
    "10.11.8",
  );
}

export async function fetchRemoteMemberPassTickets(params: {
  uid: string;
  category: 1 | 2 | 3 | null;
}): Promise<HKApiResponse<HKMemberPassTicketDto[]>> {
  return sendToHKApi<HKMemberPassTicketDto[]>(
    "member_passticket_list",
    {
      uid: params.uid,
      ...(params.category === null ? {} : { category: params.category }),
    },
    "11.7.1",
  );
}

/** Load stored-value account metadata used to classify package credits. */
export async function fetchMemberAccounts(): Promise<HKApiResponse<HKAccountDto[]>> {
  return sendToHKApi<HKAccountDto[]>(
    "basic_account_list",
    { scene: 2 },
    "11.7.1",
  );
}

/** Load the authoritative credit configuration for one point package. */
export async function fetchMemberPackageDetail(
  goodsId: string,
): Promise<HKApiResponse<HKMemberPackageDetailDto>> {
  return sendToHKApi<HKMemberPackageDetailDto>(
    "setmeal_passticket_details",
    { setmealId: goodsId },
    "11.7.1",
  );
}

// =============================================================================
// Product Catalog
// =============================================================================

/** Raw product item shape from the HK API response. */
export interface HKGoodsItem {
  GoodsId?: string;
  goodsId?: string;
  GoodsName?: string;
  goodsName?: string;
  Price?: number | string;
  price?: number | string;
  AfterTaxPrice?: number | string;
  afterTaxPrice?: number | string;
  TaxRate?: number | string;
  taxRate?: number | string;
  SetmealTypeTaxRate?: number | string;
  setmealTypeTaxRate?: number | string;
  TaxRateType?: number | string;
  taxRateType?: number | string;
  Remark?: string;
  remark?: string;
  SubCategory?: string | number;
  subCategory?: string | number;
  CategoryGroupName?: string;
  categoryGroupName?: string;
  ForeColor?: string;
  foreColor?: string;
  BackColor?: string;
  backColor?: string;
}

/** Ticket metadata returned by the package-management list endpoint. */
export interface HKProductVisualItem {
  SetMealId?: string;
  setMealId?: string;
  GoodsId?: string;
  goodsId?: string;
  ForeColor?: string;
  foreColor?: string;
  BackColor?: string;
  backColor?: string;
  Amount?: number | string;
  amount?: number | string;
  TypeId?: string;
  typeId?: string;
  TaxRate?: number | string;
  taxRate?: number | string;
  SetmealTypeTaxRate?: number | string;
  setmealTypeTaxRate?: number | string;
  TaxRateType?: number | string;
  taxRateType?: number | string;
  AfterTaxPrice?: number | string;
  afterTaxPrice?: number | string;
  IsEnabled?: boolean;
  isEnabled?: boolean;
  IsOpenSales?: boolean;
  isOpenSales?: boolean;
}

/** Product classification returned by `setmeal_type_select`. */
export interface HKSetmealType {
  key?: string;
  Key?: string;
  typeId?: string;
  TypeId?: string;
  value?: string;
  Value?: string;
  typeName?: string;
  TypeName?: string;
  isEnabled?: boolean;
  IsEnabled?: boolean;
}

/** Raw physical product returned by `gift_realtime_stock`. */
export interface HKSouvenirStockItem {
  GiftName?: string;
  giftName?: string;
  GiftNo?: string;
  giftNo?: string;
  TypeName?: string;
  typeName?: string;
  Amount?: number | string;
  amount?: number | string;
  GiftPrice?: number | string;
  giftPrice?: number | string;
  Price?: number | string;
  price?: number | string;
}

/**
 * Fetch sell-goods by category from the HK API.
 * Action: `setmeal_getsellgoods`
 *
 * @param category - The numeric category ID (1, 2, 4, 6).
 * @returns Response with goods data for the given category.
 */
export async function fetchGoodsByCategory(
  category: number,
  typeId?: string
): Promise<HKApiResponse> {
  return sendToHKApi("setmeal_getsellgoods", {
    Category: String(category),
    ...(typeId ? { TypeId: typeId } : {}),
  });
}

/**
 * Fetch the ticket-management catalog that carries ticket quantity, status,
 * and card colors omitted by `setmeal_getsellgoods`.
 */
export async function fetchProductVisualCatalog(): Promise<HKApiResponse> {
  return sendToHKApi(
    "setmeal_passticket_list",
    { category: 4, page: 1, limit: 99999 },
    "11.7.1",
  );
}

/**
 * Fetch package/ticket classifications from the HK API.
 * Action: `setmeal_type_select`
 */
export async function fetchSetmealTypes(): Promise<HKApiResponse> {
  return sendToHKApi("setmeal_type_select", {});
}

/**
 * Fetch ticket/package list from the HK API.
 * Action: `oversea_subscribe_base_list`
 *
 * @param category - Optional category filter (4 = Vé, etc.)
 * @returns Response with ticket/package data.
 */
export async function fetchSubscribeBaseList(
  category?: number
): Promise<HKApiResponse> {
  const body: Record<string, unknown> = { page: 1, limit: 99999 };
  if (category !== undefined) {
    body.category = category;
  }
  return sendToHKApi("oversea_subscribe_base_list", body);
}

/**
 * Fetch physical products with their current stock and sale price.
 * Action: `gift_realtime_stock`
 *
 * The response's `price` is the sale price. `giftPrice` is the purchase unit
 * price and must not be used as the POS selling price.
 */
export async function fetchSouvenirStock(): Promise<HKApiResponse> {
  return sendToHKApi(
    "gift_realtime_stock",
    { isFilterZero: true },
    "10.11.8"
  );
}
