// =============================================================================
// Order Service — Giao tiếp với Firebase Cloud Functions
// =============================================================================
// Màn hình khách đồng bộ local-first giữa hai cửa sổ và không truy vấn tại đây.
// =============================================================================

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import type {
  PosOrder,
  OrderStatus,
  OrderItem,
  OrderMemberSnapshot,
  PaymentMethod,
} from "@/lib/types/order";
import type { PosVoucherResolution } from "@/lib/types/voucher";

/**
 * Generate a unique local order ID using timestamp and a random suffix.
 * Format: ORD-{unix_seconds}-{3_digit_random}
 *
 * @example "ORD-1715420000-042"
 */
export function generateLocalOrderId(): string {
  const timestamp = Date.now();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return `ORD-${timestamp}-${suffix}`;
}

interface OrderRequest {
  localOrderId: string;
  shopId: number;
  warehouseId: string;
  uid?: string;
  member?: OrderMemberSnapshot;
  items: Array<Pick<OrderItem, "goodsId" | "quantity">>;
  voucherCodes?: string[];
}

export async function resolveVoucher(
  code: string,
  warehouseId: string,
): Promise<PosVoucherResolution> {
  const callable = httpsCallable<
    { action: "resolveVoucher"; payload: { code: string; warehouseId: string } },
    PosVoucherResolution
  >(functions, "getPosAuthSession");
  const result = await callable(await withDeviceAuth({
    action: "resolveVoucher" as const,
    payload: { code, warehouseId },
  }));
  return result.data;
}

interface PreparedOrderResult {
  localOrderId: string;
  status: OrderStatus;
  totalAmount: number;
}

export interface CheckoutOrderResult extends PreparedOrderResult {
  hkOrderNumber: string | null;
  paidAt: string | null;
}

export interface OrderSyncStatusResult {
  localOrderId: string;
  hkOrderNumber: string | null;
  status: OrderStatus;
  totalAmount: number;
  lastError: string | null;
  updatedAt: string;
}

/** Create a Firebase draft through the authenticated backend. */
export async function prepareOrder(
  input: OrderRequest,
): Promise<PreparedOrderResult> {
  const callable = httpsCallable<
    { action: "prepareOrder"; payload: OrderRequest },
    PreparedOrderResult
  >(
    functions,
    "getPosAuthSession",
  );
  const result = await callable(
    await withDeviceAuth({ action: "prepareOrder" as const, payload: input }),
  );
  return result.data;
}

/** Commit local payment without waiting for the remote China API. */
export async function checkoutOrder(
  input: OrderRequest & { paymentMethodId: PaymentMethod },
): Promise<CheckoutOrderResult> {
  const callable = httpsCallable<
    {
      action: "checkoutOrder";
      payload: OrderRequest & { paymentMethodId: PaymentMethod };
    },
    CheckoutOrderResult
  >(functions, "getPosAuthSession");
  const result = await callable(
    await withDeviceAuth({ action: "checkoutOrder" as const, payload: input }),
  );
  return result.data;
}

/** Read background synchronization status without direct Firestore access. */
export async function fetchOrderSyncStatus(
  localOrderId: string,
): Promise<OrderSyncStatusResult> {
  const callable = httpsCallable<
    {
      action: "getOrderStatus";
      payload: { localOrderId: string };
    },
    OrderSyncStatusResult
  >(functions, "getPosAuthSession");
  const result = await callable(await withDeviceAuth({
    action: "getOrderStatus" as const,
    payload: { localOrderId },
  }));
  return result.data;
}

/** Load the authoritative paid order used to render and print its receipt. */
export async function fetchOrderForReceipt(
  localOrderId: string,
): Promise<PosOrder> {
  const callable = httpsCallable<
    {
      action: "getOrder";
      payload: { localOrderId: string };
    },
    { order: PosOrder }
  >(functions, "getPosAuthSession");
  const result = await callable(await withDeviceAuth({
    action: "getOrder" as const,
    payload: { localOrderId },
  }));
  return result.data.order;
}

export interface OrderHistoryResult {
  orders: PosOrder[];
  fetchedAt: string;
}

export interface OrderHistoryQuery {
  warehouseId: string;
  startAt: string;
  endAt: string;
}

export type CloseoutAccountScope = "CURRENT_USER" | "ALL_USERS";

export interface CloseoutOrderQuery {
  startAt: string;
  endAt: string;
  warehouseId: string;
  scope: CloseoutAccountScope;
}

export async function fetchOrderHistory(
  query: OrderHistoryQuery,
): Promise<OrderHistoryResult> {
  const callable = httpsCallable<
    {
      action: "getOrders";
      payload: OrderHistoryQuery;
    },
    OrderHistoryResult
  >(functions, "getPosAuthSession");
  const result = await callable(await withDeviceAuth({
    action: "getOrders" as const,
    payload: query,
  }));
  return result.data;
}

export async function fetchCloseoutOrders(
  query: CloseoutOrderQuery,
): Promise<OrderHistoryResult> {
  const callable = httpsCallable<
    { action: "getCloseoutOrders"; payload: CloseoutOrderQuery },
    OrderHistoryResult
  >(functions, "getPosAuthSession");
  const result = await callable(await withDeviceAuth({
    action: "getCloseoutOrders" as const,
    payload: query,
  }));
  const response: unknown = result.data;
  if (
    !response ||
    typeof response !== "object" ||
    !("orders" in response) ||
    !Array.isArray(response.orders) ||
    !("fetchedAt" in response) ||
    typeof response.fetchedAt !== "string"
  ) {
    throw new Error(
      "Cloud Function kết ca chưa được cập nhật. Vui lòng deploy Functions rồi tải lại ứng dụng.",
    );
  }
  return response as OrderHistoryResult;
}

export async function retryOrderSync(
  localOrderId: string,
): Promise<{ localOrderId: string; status: OrderStatus; queued: boolean }> {
  const callable = httpsCallable<
    {
      action: "retryOrderSync";
      payload: { localOrderId: string };
    },
    { localOrderId: string; status: OrderStatus; queued: boolean }
  >(functions, "getPosAuthSession");
  const result = await callable(await withDeviceAuth({
    action: "retryOrderSync" as const,
    payload: { localOrderId },
  }));
  return result.data;
}

export async function getOrdersByStatus(
  status: OrderStatus,
  warehouseId: string,
): Promise<PosOrder[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const result = await fetchOrderHistory({
    warehouseId,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  });
  return result.orders.filter((order) => order.status === status);
}
