/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { withPosRequestContext, requestAuthSession } = require("../lib/services/posRequestContext");
const { canClaimPayOSCheck, payOSRetryDelay } = require("../lib/payment/payosCheckLease");
const { paymentStatusSnapshot } = require("../lib/payment/paymentStatusProjection");

test("auth verification is shared inside a request and isolated across concurrent requests", async () => {
  let loads = 0;
  const load = async () => ({ marker: ++loads });
  const first = await withPosRequestContext(async () => {
    const [a, b] = await Promise.all([requestAuthSession("actor", load), requestAuthSession("actor", load)]);
    assert.equal(a, b);
    return a;
  });
  const second = await withPosRequestContext(() => requestAuthSession("actor", load));
  assert.notEqual(first, second);
  assert.equal(loads, 2);
  await requestAuthSession("actor", load);
  await requestAuthSession("actor", load);
  assert.equal(loads, 4);
});

test("a final PayOS check bypasses freshness but never an active lease or rate limit", () => {
  assert.equal(canClaimPayOSCheck({ nextAllowedAt: 6000 }, 5000, false), false);
  assert.equal(canClaimPayOSCheck({ nextAllowedAt: 6000 }, 5000, true), true);
  assert.equal(canClaimPayOSCheck({ leaseUntil: 6000 }, 5000, true), false);
  assert.equal(canClaimPayOSCheck({ backoffUntil: 6000 }, 5000, true), false);
});

test("PayOS 429 honors Retry-After without increasing request frequency", () => {
  assert.equal(payOSRetryDelay({ status: 429, headers: new Headers({ "retry-after": "30" }) }), 30000);
  assert.equal(payOSRetryDelay({ status: 429, headers: new Headers({ "retry-after": "1" }) }), 5000);
  assert.equal(payOSRetryDelay({ status: 429 }), 10000);
});

test("realtime projection does not include member, QR, invoice token or bank data", () => {
  const value = paymentStatusSnapshot({
    localOrderId: "order", status: "LOCAL_PAID", createdBy: "owner", updatedAt: "now",
    member: { phone: "private" }, invoiceRequestToken: "secret", items: [{ goodsName: "private" }],
    paymentDetails: { currentOrderCode: 1, attempts: [{ orderCode: 1, status: "PAID", paidAt: "paid", qrCode: "private", accountNumber: "private" }] },
  });
  assert.equal(value.orderStatus, "LOCAL_PAID");
  assert.equal(value.paidAt, "paid");
  assert.deepEqual(Object.keys(value).sort(), ["confirmationSource", "localOrderId", "orderCode", "orderKind", "orderStatus", "paidAt", "paymentStatus", "paymentVerificationStatus", "providerConfirmedAt", "updatedAt"].sort());
});

test("a paid historical QR keeps the source of the first order confirmation", () => {
  const value = paymentStatusSnapshot({ localOrderId: "order", status: "LOCAL_PAID", paidAt: "first-paid", updatedAt: "now", paymentDetails: {
    currentOrderCode: 2, attempts: [
      { orderCode: 1, status: "PAID", paidAt: "first-paid", confirmationSource: "WEBHOOK" },
      { orderCode: 2, status: "PENDING" },
    ],
  } });
  assert.equal(value.orderCode, 2);
  assert.equal(value.paidAt, "first-paid");
  assert.equal(value.confirmationSource, "WEBHOOK");
});
