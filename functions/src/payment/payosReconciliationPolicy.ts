import type { PosOrder } from "../types/order";

export const PAYOS_RECONCILIATION_DELAY_MS = 5 * 60 * 1000;

/** A fixed-account fallback can retain failed PayOS attempts. It is not PayOS. */
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

export function payOSReconciliationDueAt(order: PosOrder): string | null {
  const completedAt = Date.parse(order.paidAt ?? order.paymentDetails?.manualConfirmation?.confirmedAt ?? "");
  return Number.isFinite(completedAt)
    ? new Date(completedAt + PAYOS_RECONCILIATION_DELAY_MS).toISOString()
    : null;
}

export function confirmedPayOSAttempt(order: PosOrder) {
  return order.paymentDetails?.attempts.find((attempt) =>
    attempt.status === "PAID" &&
    (attempt.confirmationSource === "WEBHOOK" || attempt.confirmationSource === "API_CHECK") &&
    attempt.amount === order.totalAmount && attempt.paidAmount === order.totalAmount &&
    Boolean(attempt.paymentLinkId),
  );
}
