import type { OrderStatus, PosOrder } from "@/lib/types/order";

export type OrderDisplayStatus =
  | OrderStatus
  | "LOCAL_COMPLETE"
  | "REFUNDING"
  | "REFUNDED"
  | "REFUND_FAILED"
  | "REFUND_UNKNOWN"
  | "CANCELLED";

export function getOrderDisplayStatus(order: PosOrder): OrderDisplayStatus {
  if (
    order.paymentStatus === "REFUNDING" ||
    order.paymentStatus === "REFUNDED" ||
    order.paymentStatus === "REFUND_FAILED" ||
    order.paymentStatus === "REFUND_UNKNOWN"
  ) {
    return order.paymentStatus;
  }
  if (order.syncStatus === "CANCELLED") return "CANCELLED";
  if (order.status === "LOCAL_PAID" && order.syncStatus === "SKIPPED") return "LOCAL_COMPLETE";
  return order.status;
}

export function isOrderRevenueEligible(order: PosOrder): boolean {
  if (order.syncStatus === "CANCELLED") return false;
  if (order.paymentStatus) {
    return order.paymentStatus !== "DRAFT" &&
      order.paymentStatus !== "REFUNDED";
  }
  return order.status !== "DRAFT";
}
