/* Local synthetic fixtures only; no production credentials or provider requests. */
const test = require("node:test");
const assert = require("node:assert/strict");
if (process.env.GCLOUD_PROJECT !== "demo-pos-payment" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8085") throw Error("Local demo emulator required");
const { db, admin } = require("../lib/config/firebase");
const provider = require("../lib/services/payosService");
const auth = require("../lib/services/posAuthService");
const { markPayOSPaymentPaid, reconcileCompletedPayOSOrder } = require("../lib/payment/payosFunctions");
const { handlePayOSReconciliation, reconcilePendingPayOSPayments } = require("../lib/payment/payosReconciliation");
let code = 81000;
async function fixture(overrides = {}) {
  const orderCode = ++code;
  const localOrderId = `ORD-${Date.now()}-${String(orderCode).padStart(6, "0")}`;
  const paidAt = new Date(Date.now() - 360000).toISOString();
  const value = {
    localOrderId, warehouseId: "reconcile-warehouse", createdBy: "cashier", operatorName: "Nhân viên",
    paymentMethod: "QR_CODE", paymentMethodId: "QR_CODE", paymentMethodName: "Chuyển khoản (xác nhận thủ công)",
    status: "SYNC_SUCCESS", paymentStatus: "PAID", syncStatus: "SYNC_SUCCESS", totalAmount: 2000, paidAt,
    createdAt: new Date().toISOString(), updatedAt: paidAt, paymentVerificationStatus: "UNVERIFIED", items: [],
    paymentDetails: { provider: "payos", currentOrderCode: orderCode, attempts: [
      { orderCode, status: "PENDING", amount: 2000, paymentLinkId: `link-${orderCode}`, currency: "VND" },
    ], manualConfirmation: { confirmedAt: paidAt, confirmedByUid: "cashier", confirmedByName: "Nhân viên", reason: "PAYOS_NOT_CONFIRMED", previousPaymentStatus: "PENDING", note: "Đã kiểm tra" } },
    payosReconciliation: { dueAt: new Date(Date.now() - 60000).toISOString(), nextCheckAt: new Date(Date.now() - 60000).toISOString() },
    ...overrides,
  };
  const ref = db.collection("pos_orders").doc(localOrderId);
  await ref.set(value);
  return { ref, value, attempt: value.paymentDetails.attempts[0] };
}
const payment = (attempt, overrides = {}) => ({ code: "00", orderCode: attempt.orderCode, amount: 2000, currency: "VND", paymentLinkId: attempt.paymentLinkId, confirmationSource: "WEBHOOK", ...overrides });

test("completed PayOS orders reconcile safely", async (t) => {
  const original = provider.getPayOS;
  const originalAuth = auth.getPosAuthSession;
  const device = { warehouseId: "reconcile-warehouse" };
  auth.getPosAuthSession = async () => ({ warehouses: [{ id: device.warehouseId }], permissions: { global: { "pos.orders.read": true } } });
  try {
    await t.test("badge list contains only orders created today in Vietnam, including viewed notifications", async () => {
      const { getCurrentVietnamDayRange } = require("../lib/order/orderHistoryRange");
      const today = getCurrentVietnamDayRange();
      const recent = await fixture({ createdAt: today.startAt });
      const old = await fixture({ createdAt: new Date(Date.parse(today.startAt) - 1).toISOString() });
      const tomorrow = await fixture({ createdAt: today.endAt });
      await recent.ref.update({ "payosReconciliation.acknowledgedBy": ["cashier"] });
      provider.getPayOS = () => ({ paymentRequests: { get: async () => ({ status: "PENDING" }) } });
      const list = await handlePayOSReconciliation("cashier", device, "reconcile-list", {});
      assert.ok(list.orders.some((order) => order.localOrderId === recent.value.localOrderId && order.acknowledged));
      assert.ok(!list.orders.some((order) => order.localOrderId === old.value.localOrderId));
      assert.ok(!list.orders.some((order) => order.localOrderId === tomorrow.value.localOrderId));
      assert.equal((await old.ref.get()).data().paymentVerificationStatus, "UNVERIFIED");
    });
    await t.test("late webhook verifies manual order while preserving completion and audit; replay is a no-op", async () => {
      const o = await fixture();
      assert.equal(await markPayOSPaymentPaid(o.ref, o.attempt.orderCode, payment(o.attempt)), "ALREADY_COMPLETED");
      const first = (await o.ref.get()).data();
      assert.equal(first.paymentVerificationStatus, "VERIFIED");
      assert.equal(first.payosReconciliation.nextCheckAt, null);
      assert.equal(first.paidAt, o.value.paidAt);
      assert.equal(first.status, "SYNC_SUCCESS");
      assert.deepEqual(first.paymentDetails.manualConfirmation, o.value.paymentDetails.manualConfirmation);
      await markPayOSPaymentPaid(o.ref, o.attempt.orderCode, payment(o.attempt));
      assert.deepEqual((await o.ref.get()).data(), first);
    });
    await t.test("API checks completed orders and historical QR attempts", async () => {
      const o = await fixture();
      const old = { ...o.attempt, orderCode: ++code, paymentLinkId: `old-${code}` };
      await o.ref.update({ "paymentDetails.attempts": [old, o.attempt] });
      const calls = [];
      provider.getPayOS = () => ({ paymentRequests: { get: async (orderCode) => {
        calls.push(orderCode);
        return orderCode === old.orderCode ? { status: "PAID", id: old.paymentLinkId, amountPaid: 2000, transactions: [{ reference: "reference" }] } : { status: "PENDING" };
      } } });
      const result = await reconcileCompletedPayOSOrder(o.ref);
      assert.equal(result.paymentVerificationStatus, "VERIFIED");
      assert.equal(result.payosReconciliation.orderCode, old.orderCode);
      assert.equal(result.payosReconciliation.confirmationSource, "API_CHECK");
      assert.equal(result.paidAt, o.value.paidAt);
      assert.deepEqual(calls, [o.attempt.orderCode, old.orderCode]);
    });
    await t.test("legacy PAID evidence repairs UNVERIFIED without an external call", async () => {
      const o = await fixture();
      await o.ref.update({ "paymentDetails.attempts": [{ ...o.attempt, status: "PAID", paidAmount: 2000, confirmationSource: "WEBHOOK" }] });
      provider.getPayOS = () => { throw Error("Unexpected provider call"); };
      assert.equal((await reconcileCompletedPayOSOrder(o.ref)).paymentVerificationStatus, "VERIFIED");
    });
    await t.test("timeout and amount mismatch remain unverified and raise a persistent overdue alert", async () => {
      for (const fail of [true, false]) {
        const o = await fixture();
        provider.getPayOS = () => ({ paymentRequests: { get: async () => {
          if (fail) throw Error("PayOS unavailable");
          return { status: "PAID", id: o.attempt.paymentLinkId, amountPaid: 1000, transactions: [] };
        } } });
        const result = await reconcileCompletedPayOSOrder(o.ref);
        assert.equal(result.paymentVerificationStatus, "UNVERIFIED");
        assert.ok(result.payosReconciliation.alertedAt);
        assert.ok(result.payosReconciliation.lastError);
        assert.equal(result.paidAt, o.value.paidAt);
      }
    });
    await t.test("cash, fixed QR, draft and cancelled orders never trigger a check or alert", async () => {
      provider.getPayOS = () => { throw Error("Unexpected provider call"); };
      for (const overrides of [{ paymentMethod: "CASH" }, { fixedTransferDetails: { status: "MANUALLY_CONFIRMED" } }, { status: "DRAFT" }, { syncStatus: "CANCELLED" }, { paymentStatus: "REFUNDED" }]) {
        const o = await fixture(overrides);
        assert.deepEqual(await reconcileCompletedPayOSOrder(o.ref), o.value);
      }
    });
    await t.test("acknowledgement persists per employee without settling the order; cross-store access is rejected", async () => {
      const o = await fixture();
      await handlePayOSReconciliation("cashier", device, "reconcile-ack", { localOrderId: o.value.localOrderId });
      const value = (await o.ref.get()).data();
      assert.deepEqual(value.payosReconciliation.acknowledgedBy, ["cashier"]);
      assert.equal(value.paymentVerificationStatus, "UNVERIFIED");
      await o.ref.update({ warehouseId: "other-store" });
      await assert.rejects(handlePayOSReconciliation("cashier", device, "reconcile-check", { localOrderId: o.value.localOrderId }), { code: "permission-denied" });
    });
    await t.test("an early check does not raise the five-minute alert", async () => {
      const dueAt = new Date(Date.now() + 300000).toISOString();
      const o = await fixture({ paidAt: new Date().toISOString(), payosReconciliation: { dueAt, nextCheckAt: dueAt } });
      provider.getPayOS = () => ({ paymentRequests: { get: async () => ({ status: "PENDING" }) } });
      const result = await reconcileCompletedPayOSOrder(o.ref);
      assert.equal(result.payosReconciliation.alertedAt, undefined);
      assert.equal(result.payosReconciliation.nextCheckAt, dueAt);
    });
    await t.test("webhook during an API timeout wins and cannot be overwritten by an overdue alert", async () => {
      const o = await fixture();
      provider.getPayOS = () => ({ paymentRequests: { get: async () => {
        await markPayOSPaymentPaid(o.ref, o.attempt.orderCode, payment(o.attempt));
        throw Error("API timeout after webhook");
      } } });
      const result = await reconcileCompletedPayOSOrder(o.ref);
      assert.equal(result.paymentVerificationStatus, "VERIFIED");
      assert.equal(result.payosReconciliation.alertedAt, undefined);
      assert.equal(result.payosReconciliation.nextCheckAt, null);
    });
    await t.test("scheduler persists overdue alerts and removes non-PayOS jobs", async () => {
      const dueAt = new Date(Date.now() - 2 * 60 * 60000).toISOString();
      const pending = await fixture({ payosReconciliation: { dueAt, nextCheckAt: dueAt } });
      const cash = await fixture({ paymentMethod: "CASH", payosReconciliation: { dueAt, nextCheckAt: dueAt } });
      provider.getPayOS = () => ({ paymentRequests: { get: async () => ({ status: "PENDING" }) } });
      await reconcilePendingPayOSPayments.run({});
      assert.ok((await pending.ref.get()).data().payosReconciliation.alertedAt);
      const excluded = (await cash.ref.get()).data();
      assert.equal(excluded.payosReconciliation.nextCheckAt, null);
      assert.equal(excluded.payosReconciliation.alertedAt, undefined);
    });
    await t.test("backfill previews without writes and repairs/initializes only eligible legacy PayOS orders", async () => {
      const legacy = await fixture();
      await legacy.ref.update({ payosReconciliation: admin.firestore.FieldValue.delete() });
      const paidLegacy = await fixture();
      await paidLegacy.ref.update({ payosReconciliation: admin.firestore.FieldValue.delete(), "paymentDetails.attempts": [{ ...paidLegacy.attempt, status: "PAID", paidAmount: 2000, confirmationSource: "WEBHOOK", paidAt: new Date().toISOString() }] });
      const { execFileSync } = require("node:child_process");
      const script = require("node:path").resolve(__dirname, "../../scripts/backfill-payos-reconciliation.cjs");
      const preview = JSON.parse(execFileSync(process.execPath, [script, "--project=demo-pos-payment"], { encoding: "utf8", env: process.env }));
      assert.ok(preview.initialized >= 1);
      assert.ok(preview.repaired >= 1);
      assert.equal((await legacy.ref.get()).data().payosReconciliation, undefined);
      assert.equal((await paidLegacy.ref.get()).data().paymentVerificationStatus, "UNVERIFIED");
      execFileSync(process.execPath, [script, "--project=demo-pos-payment", "--apply"], { encoding: "utf8", env: process.env });
      assert.ok((await legacy.ref.get()).data().payosReconciliation.nextCheckAt);
      assert.equal((await paidLegacy.ref.get()).data().paymentVerificationStatus, "VERIFIED");
      assert.equal((await paidLegacy.ref.get()).data().paidAt, paidLegacy.value.paidAt);
    });
  } finally {
    provider.getPayOS = original;
    auth.getPosAuthSession = originalAuth;
  }
});
