const test = require("node:test");
const assert = require("node:assert/strict");
const { isPayOSOrder, needsPayOSReconciliation, payOSReconciliationDueAt, confirmedPayOSAttempt } = require("../lib/payment/payosReconciliationPolicy");

function order() {
  return {
    status: "SYNC_SUCCESS", paymentMethod: "QR_CODE", totalAmount: 2000,
    paidAt: "2026-10-06T02:00:00.000Z", paymentVerificationStatus: "UNVERIFIED",
    paymentDetails: { provider: "payos", currentOrderCode: 1, attempts: [
      { orderCode: 1, amount: 2000, status: "PENDING", paymentLinkId: "link" },
    ] },
  };
}
test("only completed PayOS orders await reconciliation", () => {
  assert.equal(needsPayOSReconciliation(order()), true);
  for (const overrides of [
    { paymentMethod: "CASH" }, { paymentDetails: undefined }, { status: "DRAFT" },
    { paymentVerificationStatus: "VERIFIED" }, { syncStatus: "CANCELLED" },
    { cancelledAt: "now" }, { paymentStatus: "REFUNDED" }, { paymentStatus: "REFUNDING" },
    { fixedTransferDetails: { status: "MANUALLY_CONFIRMED" } },
  ]) assert.equal(needsPayOSReconciliation({ ...order(), ...overrides }), false);
  assert.equal(isPayOSOrder({ ...order(), paymentDetails: { provider: "payos", attempts: [{ status: "FAILED" }] } }), false);
});
test("five minutes start at checkout completion, with legacy manual time fallback", () => {
  assert.equal(payOSReconciliationDueAt(order()), "2026-10-06T02:05:00.000Z");
  const legacy = order();
  delete legacy.paidAt;
  legacy.paymentDetails.manualConfirmation = { confirmedAt: "2026-10-06T03:00:00.000Z" };
  assert.equal(payOSReconciliationDueAt(legacy), "2026-10-06T03:05:00.000Z");
  assert.equal(payOSReconciliationDueAt({ ...order(), paidAt: "invalid" }), null);
});
test("repair requires exact amounts and provider confirmation evidence", () => {
  const value = order();
  const attempt = value.paymentDetails.attempts[0];
  attempt.status = "PAID";
  attempt.paidAmount = 2000;
  assert.equal(confirmedPayOSAttempt(value), undefined);
  attempt.confirmationSource = "WEBHOOK";
  assert.equal(confirmedPayOSAttempt(value), attempt);
  attempt.paidAmount = 1000;
  assert.equal(confirmedPayOSAttempt(value), undefined);
});
