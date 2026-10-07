import type { PosOrder } from "@/lib/types/order";
import { getOrderHistoryDayRange, getVietnamDateInputValue } from "@/lib/utils/orderHistoryDate";

const ORDER_ID = /^ORD-\d{10,13}-[A-Z0-9]{6}$/;

export interface OrderNotificationTarget {
  orderId: string;
  date: string;
  key: string;
}

export function buildOrderNotificationHref(order: Pick<PosOrder, "localOrderId" | "createdAt">, token = Date.now()): string {
  if (!ORDER_ID.test(order.localOrderId)) throw new Error("Mã đơn hàng không hợp lệ.");
  const date = getVietnamDateInputValue(new Date(order.createdAt));
  const params = new URLSearchParams({ orderId: order.localOrderId, date, focus: String(token) });
  return `/orders?${params}`;
}

export function readOrderNotificationTarget(params: Pick<URLSearchParams, "get">): OrderNotificationTarget | null {
  const orderId = params.get("orderId");
  const date = params.get("date");
  if (!orderId || !ORDER_ID.test(orderId) || !date) return null;
  try { getOrderHistoryDayRange(date); } catch { return null; }
  return { orderId, date, key: `${orderId}:${date}:${params.get("focus") ?? ""}` };
}
