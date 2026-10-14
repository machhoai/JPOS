import {
  getJoyworldBaseUrl,
  getJoyworldCashierAccessToken,
} from "./joyworldCatalogService";
import { fetchRemoteMemberCards } from "./hkApiService";
import { withCardIssueLock } from "./memberCardLinkLocks";
import { saveStoredMemberCardIfPresent } from "./memberRepository";
import { assertWarehouseAccess } from "../member/functions";
import {
  validateMemberCardIssueCheckInput,
  validateMemberCardIssueConfirmInput,
  validateMemberCardIssueInfoInput,
} from "../member/memberPolicy";

const REQUEST_TIMEOUT_MS = 30_000;

export interface JoyworldResponse {
  success?: boolean;
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

export interface CashierRequest {
  shopId: number;
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
  bizCode?: string;
}

export interface MemberCardIssueInfo {
  memberAcctId: string;
  maxReceiveCard: number;
  takeCardNum: number;
  surplusQty: number;
}

export interface MemberCardAvailability {
  dynamicSerialNo: string | null;
}

export interface ConfirmMemberCardIssueResult {
  message: string;
}

export type MemberCardIssueErrorCode =
  | "HK_UNAVAILABLE"
  | "HK_INVALID_RESPONSE"
  | "HK_OPERATION_REJECTED"
  | "HK_MEMBER_NOT_FOUND"
  | "MEMBER_DISABLED"
  | "CARD_LIMIT_REACHED"
  | "CARD_STATE_CHANGED"
  | "LOCAL_PERSISTENCE_FAILED";

export class MemberCardIssueError extends Error {
  constructor(
    readonly code: MemberCardIssueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemberCardIssueError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function valueAsString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function valueAsNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function valueAsNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function remoteMessage(payload: JoyworldResponse): string {
  return typeof payload.msg === "string" ? payload.msg.trim() : "";
}

async function executeCashierRequest(
  request: CashierRequest,
  token: string,
): Promise<Response> {
  const url = new URL(`${getJoyworldBaseUrl()}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }
  return fetch(url, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "JJ-SHOPID": String(request.shopId),
      ...(request.bizCode ? { "JJ-BizCode": request.bizCode } : {}),
    },
    body: request.body === undefined
      ? undefined
      : JSON.stringify(request.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function cashierRequest(
  request: CashierRequest,
): Promise<JoyworldResponse> {
  try {
    let token = await getJoyworldCashierAccessToken(request.shopId);
    let response = await executeCashierRequest(request, token);
    if (response.status === 401) {
      token = await getJoyworldCashierAccessToken(request.shopId, true);
      response = await executeCashierRequest(request, token);
    }
    if (!response.ok) {
      throw new MemberCardIssueError(
        "HK_UNAVAILABLE",
        `Hệ thống HK không phản hồi yêu cầu cấp thẻ (HTTP ${response.status}).`,
      );
    }

    const payload = await response.json() as JoyworldResponse;
    if (payload.success !== true) {
      throw new MemberCardIssueError(
        "HK_OPERATION_REJECTED",
        remoteMessage(payload) || "Hệ thống HK từ chối thao tác cấp thẻ.",
      );
    }
    return payload;
  } catch (error: unknown) {
    if (error instanceof MemberCardIssueError) throw error;
    throw new MemberCardIssueError(
      "HK_UNAVAILABLE",
      "Không thể kết nối hệ thống HK. Vui lòng thử lại.",
    );
  }
}

async function resolveMemberAcctId(
  shopId: number,
  lookupQuery: string,
): Promise<string> {
  const response = await cashierRequest({
    shopId,
    path: "/member/cashier/member/getmember/list",
    method: "POST",
    body: { keywords: lookupQuery, isReadCard: false },
  });
  const entries = Array.isArray(response.data) ? response.data : null;
  if (!entries) {
    throw new MemberCardIssueError(
      "HK_INVALID_RESPONSE",
      "HK không trả danh sách tài khoản thành viên hợp lệ.",
    );
  }
  const normalizedLookup = lookupQuery.toLocaleLowerCase("vi-VN");
  const exact = entries.find((entry) => {
    const record = asRecord(entry);
    return [record.phone, record.memberCode]
      .map(valueAsString)
      .some((value) => value?.toLocaleLowerCase("vi-VN") === normalizedLookup);
  });
  const selected = exact ?? (entries.length === 1 ? entries[0] : null);
  const memberAcctId = valueAsString(asRecord(selected).memberAcctId);
  if (!memberAcctId) {
    throw new MemberCardIssueError(
      "HK_MEMBER_NOT_FOUND",
      "Không tìm thấy đúng tài khoản thành viên tại cửa hàng hiện tại.",
    );
  }
  return memberAcctId;
}

async function assertMemberEnabled(
  shopId: number,
  memberAcctId: string,
): Promise<Record<string, unknown>> {
  const response = await cashierRequest({
    shopId,
    path: "/member/cashier/member/getdetails",
    query: { memberAcctId, isFilterZeroValue: "false" },
  });
  const details = asRecord(response.data);
  if (details.isEnabled !== true) {
    throw new MemberCardIssueError(
      "MEMBER_DISABLED",
      "Tài khoản thành viên đang bị vô hiệu hóa trên HK nên không thể cấp thêm thẻ.",
    );
  }
  return details;
}

async function loadIssueInfo(
  shopId: number,
  memberAcctId: string,
): Promise<MemberCardIssueInfo> {
  const response = await cashierRequest({
    shopId,
    path: "/member/cashier/membercard/take/info",
    query: { memberAcctId },
  });
  const data = asRecord(response.data);
  const maxReceiveCard = valueAsNonNegativeInteger(data.maxReceiveCard);
  const takeCardNum = valueAsNonNegativeInteger(data.takeCardNum);
  const surplusQty = valueAsNonNegativeInteger(data.surplusQty);
  if (
    maxReceiveCard === null ||
    takeCardNum === null ||
    surplusQty === null
  ) {
    throw new MemberCardIssueError(
      "HK_INVALID_RESPONSE",
      "HK không trả giới hạn cấp thẻ hợp lệ.",
    );
  }
  return {
    memberAcctId,
    maxReceiveCard,
    takeCardNum,
    surplusQty,
  };
}

export type CashierRequester = (
  request: CashierRequest,
) => Promise<JoyworldResponse>;

export interface ComplimentaryCardPurchaseInput {
  shopId: number;
  memberAcctId: string;
  memberLevelId: string;
  memberCode: string;
  memberIcCard: string;
}

function exactlyOneRecord(
  value: unknown,
  invalidMessage: string,
): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new MemberCardIssueError("HK_INVALID_RESPONSE", invalidMessage);
  }
  return asRecord(value[0]);
}

/**
 * Reproduce Jingjian's complimentary card-purchase branch. A zero-value card
 * still needs a cash payment and completed order before take/confirm is valid.
 */
export async function purchaseComplimentaryMemberCard(
  input: ComplimentaryCardPurchaseInput,
  request: CashierRequester = cashierRequest,
): Promise<string> {
  let orderNumber: string | null = null;
  let orderCompleted = false;

  try {
    const depositResponse = await request({
      shopId: input.shopId,
      path: "/member/cashier/membercard/take/deposit",
      query: { memberAcctId: input.memberAcctId, scene: "4" },
    });
    const depositConfig = exactlyOneRecord(
      depositResponse.data,
      "HK không trả cấu hình bán thẻ hợp lệ.",
    );
    if (Number(depositConfig.storeCategory) !== 1) {
      throw new MemberCardIssueError(
        "HK_OPERATION_REJECTED",
        "Cấu hình thẻ hiện tại không dùng luồng bán thẻ bằng đơn hàng.",
      );
    }
    const unitPrice = valueAsNonNegativeNumber(depositConfig.amount);
    if (unitPrice === null) {
      throw new MemberCardIssueError(
        "HK_INVALID_RESPONSE",
        "HK không trả giá bán thẻ hợp lệ.",
      );
    }

    const itemsResponse = await request({
      shopId: input.shopId,
      path: "/member/cashier/otherorder/getitems",
      query: { levelId: input.memberLevelId, scene: "4" },
    });
    const item = exactlyOneRecord(
      itemsResponse.data,
      "HK không trả mặt hàng bán thẻ hợp lệ cho cấp thành viên.",
    );
    const taxRate = valueAsNonNegativeNumber(item.taxRate) ?? 0;
    const totalAmount = unitPrice * (1 + taxRate / 100);
    const waiveCharge = totalAmount > 0;
    const derateMoney = waiveCharge ? totalAmount.toFixed(2) : 0;

    const createOrderResponse = await request({
      shopId: input.shopId,
      path: "/order/cashier/order/create",
      method: "POST",
      body: {
        memberAcctId: input.memberAcctId,
        category: 4,
        channel: 1,
        items: [{ ...item, qty: 1 }],
        isManualDerate: waiveCharge,
        derateMoney,
      },
    });
    orderNumber = valueAsString(createOrderResponse.data);
    if (!orderNumber) {
      throw new MemberCardIssueError(
        "HK_INVALID_RESPONSE",
        "HK không trả mã đơn bán thẻ hợp lệ.",
      );
    }

    await request({
      shopId: input.shopId,
      path: "/member/cashier/otherorder/buycard/create",
      method: "POST",
      body: {
        orderNumber,
        memberAcctId: input.memberAcctId,
        cardQty: 1,
        isFree: waiveCharge,
        cardList: [{
          iCCard: input.memberIcCard,
          memberCode: input.memberCode,
        }],
      },
    });

    const methodsResponse = await request({
      shopId: input.shopId,
      path: "/system/cashier/paymentmethod/getmethods",
    });
    const paymentMethods = Array.isArray(methodsResponse.data)
      ? methodsResponse.data.map(asRecord)
      : [];
    const cashMethod = paymentMethods.find(
      (method) => valueAsString(method.methodCode) === "CashPaymentExecutor",
    );
    const payMethodId = valueAsString(cashMethod?.methodId);
    if (!payMethodId) {
      throw new MemberCardIssueError(
        "HK_OPERATION_REJECTED",
        "Cửa hàng chưa có phương thức tiền mặt để hoàn tất đơn thẻ 0 đồng.",
      );
    }

    await request({
      shopId: input.shopId,
      path: "/order/cashier/payment/acct/pay",
      method: "POST",
      body: {
        payMethodId,
        orderNumber,
        money: 0,
        remark: "",
        paymentAmount: 0,
        changeAmount: 0,
      },
    });

    const refreshResponse = await request({
      shopId: input.shopId,
      path: "/order/cashier/order/refresh",
      method: "POST",
      body: { orderNumber, derateMoney: 0 },
    });
    if (valueAsNonNegativeInteger(asRecord(refreshResponse.data).status) !== 3) {
      throw new MemberCardIssueError(
        "HK_OPERATION_REJECTED",
        "Đơn cấp thẻ chưa đạt trạng thái đã thanh toán.",
      );
    }

    await request({
      shopId: input.shopId,
      path: "/order/cashier/order/complete",
      method: "POST",
      body: { orderNumber },
    });
    orderCompleted = true;
    return orderNumber;
  } catch (error: unknown) {
    if (orderNumber && !orderCompleted) {
      try {
        await request({
          shopId: input.shopId,
          path: "/order/cashier/order/cancel",
          method: "POST",
          body: { orderNumber },
        });
      } catch {
        // Preserve the original failure; HK retains the order for audit.
      }
    }
    throw error;
  }
}

async function checkCard(
  shopId: number,
  memberCode: string,
): Promise<MemberCardAvailability> {
  const response = await cashierRequest({
    shopId,
    path: "/member/cashier/membercard/take/check",
    query: { memberCode },
  });
  const dynamicSerialNo = valueAsString(response.data);
  return { dynamicSerialNo };
}

async function isCardAlreadyAttached(
  uid: string,
  memberCode: string,
): Promise<boolean> {
  try {
    const response = await fetchRemoteMemberCards(uid);
    return response.success && Array.isArray(response.data) && response.data.some(
      (card) => valueAsString(card.memberCode) === memberCode,
    );
  } catch {
    return false;
  }
}

export function memberDetailsContainPhysicalCard(
  details: unknown,
  memberCode: string,
  memberIcCard: string,
): boolean {
  const outputs = asRecord(details).memberCardOutputs;
  if (!Array.isArray(outputs)) return false;
  return outputs.some((output) => {
    const card = asRecord(output);
    return valueAsString(card.memberCode) === memberCode &&
      valueAsString(card.icCard) === memberIcCard;
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPurchasedCardSettlement(params: {
  shopId: number;
  memberAcctId: string;
  memberCode: string;
  memberIcCard: string;
}): Promise<"ATTACHED" | "READY_TO_CONFIRM"> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await wait(300);
    const details = await assertMemberEnabled(
      params.shopId,
      params.memberAcctId,
    );
    if (memberDetailsContainPhysicalCard(
      details,
      params.memberCode,
      params.memberIcCard,
    )) {
      return "ATTACHED";
    }
    const issueInfo = await loadIssueInfo(params.shopId, params.memberAcctId);
    if (issueInfo.surplusQty > 0) return "READY_TO_CONFIRM";
  }
  throw new MemberCardIssueError(
    "HK_OPERATION_REJECTED",
    "Đơn thẻ đã hoàn tất nhưng Joyworld chưa ghi nhận thẻ hoặc suất nhận thẻ. " +
      "Vui lòng thử đồng bộ lại sau.",
  );
}

async function persistConfirmedCard(params: {
  uid: string;
  memberCode: string;
  userId: string;
}): Promise<void> {
  try {
    await saveStoredMemberCardIfPresent({
      remoteUid: params.uid,
      memberCode: params.memberCode,
      updatedBy: params.userId,
      lastRemoteSyncAt: new Date().toISOString(),
    });
  } catch {
    throw new MemberCardIssueError(
      "LOCAL_PERSISTENCE_FAILED",
      "Joyworld đã gắn thẻ nhưng POS chưa lưu được mã thẻ local. " +
      "Có thể thử lại an toàn để đồng bộ hồ sơ.",
    );
  }
}

export async function getMemberCardIssueInfoForUser(
  userId: string,
  data: unknown,
): Promise<MemberCardIssueInfo> {
  const input = validateMemberCardIssueInfoInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);
  const memberAcctId = await resolveMemberAcctId(input.shopId, input.lookupQuery);
  await assertMemberEnabled(input.shopId, memberAcctId);
  return loadIssueInfo(input.shopId, memberAcctId);
}

export async function checkMemberCardForIssueForUser(
  userId: string,
  data: unknown,
): Promise<MemberCardAvailability> {
  const input = validateMemberCardIssueCheckInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);
  return checkCard(input.shopId, input.memberCode);
}

async function confirmMemberCardIssueUnlocked(
  userId: string,
  data: unknown,
): Promise<ConfirmMemberCardIssueResult> {
  const input = validateMemberCardIssueConfirmInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);

  const resolvedMemberAcctId = await resolveMemberAcctId(
    input.shopId,
    input.lookupQuery,
  );
  if (resolvedMemberAcctId !== input.memberAcctId) {
    throw new MemberCardIssueError(
      "CARD_STATE_CHANGED",
      "Tài khoản thành viên đã thay đổi trong lúc xử lý. Vui lòng kiểm tra lại.",
    );
  }
  const memberDetails = await assertMemberEnabled(
    input.shopId,
    resolvedMemberAcctId,
  );

  if (
    memberDetailsContainPhysicalCard(
      memberDetails,
      input.memberCode,
      input.memberIcCard,
    ) ||
    await isCardAlreadyAttached(input.uid, input.memberCode)
  ) {
    await persistConfirmedCard({
      uid: input.uid,
      memberCode: input.memberCode,
      userId,
    });
    return {
      message: "Thẻ đã được gắn trên Joyworld và đã đồng bộ vào POS.",
    };
  }

  const issueInfo = await loadIssueInfo(input.shopId, resolvedMemberAcctId);
  if (
    issueInfo.maxReceiveCard > 0 &&
    issueInfo.takeCardNum >= issueInfo.maxReceiveCard
  ) {
    throw new MemberCardIssueError(
      "CARD_LIMIT_REACHED",
      `Thành viên đã đạt giới hạn ${issueInfo.maxReceiveCard} thẻ do HK cấu hình.`,
    );
  }

  const latestCheck = await checkCard(input.shopId, input.memberCode);
  if (latestCheck.dynamicSerialNo !== input.dynamicSerialNo) {
    throw new MemberCardIssueError(
      "CARD_STATE_CHANGED",
      "Trạng thái thẻ đã thay đổi trong lúc xử lý. Vui lòng đọc lại thẻ.",
    );
  }

  if (issueInfo.surplusQty === 0) {
    const memberLevelId = valueAsString(memberDetails.memberLevelId);
    if (!memberLevelId) {
      throw new MemberCardIssueError(
        "HK_INVALID_RESPONSE",
        "HK không trả cấp thành viên để tạo đơn bán thẻ.",
      );
    }
    await purchaseComplimentaryMemberCard({
      shopId: input.shopId,
      memberAcctId: resolvedMemberAcctId,
      memberLevelId,
      memberCode: input.memberCode,
      memberIcCard: input.memberIcCard,
    });
    const settlement = await waitForPurchasedCardSettlement({
      shopId: input.shopId,
      memberAcctId: resolvedMemberAcctId,
      memberCode: input.memberCode,
      memberIcCard: input.memberIcCard,
    });
    if (settlement === "ATTACHED") {
      await persistConfirmedCard({
        uid: input.uid,
        memberCode: input.memberCode,
        userId,
      });
      return {
        message: "Joyworld đã gắn thẻ qua đơn bán thẻ và POS đã đồng bộ.",
      };
    }
  }

  const response = await cashierRequest({
    shopId: input.shopId,
    path: "/member/cashier/membercard/take/confirm",
    method: "POST",
    body: {
      memberAcctId: resolvedMemberAcctId,
      cardInfoList: [{
        memberICCard: input.memberIcCard,
        memberCode: input.memberCode,
        ...(input.dynamicSerialNo
          ? { dynamicSerialNo: input.dynamicSerialNo }
          : {}),
      }],
    },
  });
  await persistConfirmedCard({
    uid: input.uid,
    memberCode: input.memberCode,
    userId,
  });
  return {
    message: remoteMessage(response) || "Đã cấp thêm thẻ thành viên thành công.",
  };
}

export async function confirmMemberCardIssueForUser(userId:string,data:unknown):Promise<ConfirmMemberCardIssueResult> {
  const input=validateMemberCardIssueConfirmInput(data);
  if(input.uid!==input.memberAcctId)throw new MemberCardIssueError("CARD_STATE_CHANGED","UID thành viên không khớp tài khoản đang gắn thẻ.");
  await assertWarehouseAccess(userId,input.warehouseId);
  return withCardIssueLock(input.shopId,input.uid,input.memberCode,()=>confirmMemberCardIssueUnlocked(userId,data));
}
