import type { PosOrder } from "@/lib/types/order";

export function isPayOSOrder(order: PosOrder): boolean {
  return order.paymentMethod === "QR_CODE" &&
    order.paymentDetails?.provider === "payos" &&
    order.paymentDetails.attempts.some((attempt) => Boolean(attempt.paymentLinkId)) &&
    order.fixedTransferDetails?.status !== "MANUALLY_CONFIRMED";
}

export function needsPayOSReconciliation(order: PosOrder): boolean {
  return isPayOSOrder(order) && order.status !== "DRAFT" &&
    order.syncStatus !== "CANCELLED" && !order.cancelledAt &&
    (!order.paymentStatus || order.paymentStatus === "PAID") &&
    order.paymentVerificationStatus === "UNVERIFIED";
}
