import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { cartHarness, checkoutCallback } from "./helpers/checkoutRegressionHarness.mjs";

const require = createRequire(import.meta.url);
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides = {}) {
  const exports = {};
  const services = {
    createPayOSPayment: async () => result(),
    fetchPayOSPaymentStatus: async () => result(),
    waitForPayOSStatusCheck: async () => undefined,
    handlePayOSPaymentTimeout: async () => result(),
    ...overrides,
  };
  const source = ts.transpileModule(readFileSync(new URL("../src/lib/stores/usePayOSPaymentStore.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", source)((name) => {
    if (name === "zustand") return require(name);
    if (name.endsWith("payOSService")) return services;
    if (name.endsWith("orderService")) return { fetchOrderSyncStatus: async () => ({ status: "DRAFT" }) };
    if (name.endsWith("checkoutTelemetryService")) return { logCheckoutTelemetry: () => undefined };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports.usePayOSPaymentStore;
}
const id = "ORD-1791208105614-ABC123";
function result(code = 100) {
  return {
    localOrderId: id, orderStatus: "DRAFT", nextAction: "WAIT", totalAmount: 1000,
    serverTime: new Date().toISOString(), fixedTransfer: null, manualConfirmation: null,
    payment: { orderCode: code, status: "PENDING", displayExpiresAt: new Date(Date.now() + 300000).toISOString() },
  };
}
const paid = { localOrderId: id, orderCode: 100, orderStatus: "LOCAL_PAID", paymentStatus: "PAID", paidAt: new Date().toISOString() };

test("realtime payment cannot be undone by an older status response", async () => {
  const pending = deferred();
  const store = harness({ fetchPayOSPaymentStatus: () => pending.promise });
  await store.getState().startPayment({ localOrderId: id });
  const check = store.getState().fallbackCheck();
  store.getState().receivePaymentStatus(paid);
  pending.resolve(result());
  await check;
  assert.equal(store.getState().nextAction, "COMPLETED");
  assert.equal(store.getState().orderStatus, "LOCAL_PAID");
});

test("reset invalidates an in-flight response even when the same order is reopened", async () => {
  const pending = deferred();
  const store = harness({ fetchPayOSPaymentStatus: () => pending.promise });
  await store.getState().startPayment({ localOrderId: id });
  const check = store.getState().fallbackCheck();
  store.getState().resetPayment();
  await store.getState().startPayment({ localOrderId: id });
  pending.resolve({ ...result(), nextAction: "COMPLETED", orderStatus: "LOCAL_PAID" });
  await check;
  assert.equal(store.getState().nextAction, "WAIT");
});

test("only the active order can complete, including a paid historical attempt", async () => {
  const store = harness();
  await store.getState().startPayment({ localOrderId: id });
  store.getState().receivePaymentStatus({ ...paid, localOrderId: "another-order" });
  assert.equal(store.getState().nextAction, "WAIT");
  store.getState().receivePaymentStatus({ ...paid, orderCode: 99 });
  assert.equal(store.getState().nextAction, "COMPLETED");
});

test("expiry waits for the pending API check and skips another call if it already paid", async () => {
  const pending = deferred();
  let timeoutCalls = 0;
  const store = harness({
    waitForPayOSStatusCheck: () => pending.promise,
    handlePayOSPaymentTimeout: async () => { timeoutCalls++; return result(); },
  });
  await store.getState().startPayment({ localOrderId: id });
  const expiry = store.getState().handleDisplayTimeout();
  assert.equal(timeoutCalls, 0);
  store.getState().receivePaymentStatus(paid);
  pending.resolve();
  await expiry;
  assert.equal(timeoutCalls, 0);
  assert.equal(store.getState().isChecking, false);
});

test("parallel periodic checks do not issue duplicate requests", async () => {
  const pending = deferred();
  let calls = 0;
  const store = harness({ fetchPayOSPaymentStatus: () => { calls++; return pending.promise; } });
  await store.getState().startPayment({ localOrderId: id });
  const first = store.getState().fallbackCheck();
  await store.getState().fallbackCheck();
  assert.equal(calls, 1);
  pending.resolve(result());
  await first;
});

test("manual realtime confirmation retains the unverified-payment UI flag", async () => {
  const store = harness();
  await store.getState().startPayment({ localOrderId: id });
  store.getState().receivePaymentStatus({ ...paid, confirmationSource: "MANUAL" });
  assert.equal(store.getState().nextAction, "COMPLETED");
  assert.equal(store.getState().manuallyConfirmed, true);
});

test("device pilot settings choose realtime and the five-second fallback", async () => {
  const store = harness({ createPayOSPayment: async () => ({ ...result(), paymentRuntime: { realtimeEnabled: true, pollingIntervalMs: 5000 } }) });
  await store.getState().startPayment({ localOrderId: id });
  assert.equal(store.getState().realtimeEnabled, true);
  assert.equal(store.getState().pollingIntervalMs, 5000);
});

function cancellationHarness(cancelPayOSPayment) {
  const payment = harness({ cancelPayOSPayment });
  const cart = cartHarness();
  const warnings = [];
  cart.store.setState({ paymentMethod: "QR_CODE" });
  assert.equal(cart.store.getState().lockCartForPayOS(id), true);
  const cancel = checkoutCallback("../../src/lib/hooks/usePayOSCheckoutController.ts", "cancelPayment", {
    manageCartLock: true,
    useCartStore: cart.store,
    usePayOSPaymentStore: payment,
    fixedTransfer: null,
    window: { confirm: () => true },
    showInfo() {},
    showWarning: (...message) => warnings.push(message),
    showError: (message) => assert.fail(message),
    showSuccess() {},
    cancelPayOS: payment.getState().cancelPayment,
    resetPayment: payment.getState().resetPayment,
    unlockCartAfterCancellation: cart.store.getState().unlockCartAfterPayOSCancellation,
    onCancelled: undefined,
  });
  return { ...cart, payment, cancel, warnings };
}

test("a recovered PayOS checkout can unlock and keep the cart when cancellation is unreachable", async () => {
  const { store, payment, cancel, journal, warnings, requests } = cancellationHarness(async (orderId) => {
    assert.equal(orderId, id);
    throw Object.assign(new Error("Offline"), { code: "functions/unavailable" });
  });
  const original = store.getState().items;
  let returnedToCart = false;
  await cancel(() => { returnedToCart = true; });
  assert.equal(returnedToCart, true);
  const cart = store.getState();
  assert.equal(cart.isPaymentLocked, false);
  assert.equal(cart.paymentLockOrderId, null);
  assert.deepEqual(cart.items, original);
  assert.notEqual(cart.draftOrderId, id);
  assert.equal(journal.at(-1).localOrderId, cart.draftOrderId);
  assert.equal(journal.at(-1).checkpoint, "CART_READY");
  assert.equal(payment.getState().localOrderId, null);
  assert.equal(warnings.length, 1);
  store.getState().setPaymentMethod("CASH");
  await store.getState().checkout(20692, "warehouse-a");
  assert.equal(requests[0].localOrderId, cart.draftOrderId);
  assert.equal(requests[0].paymentMethodId, "CASH");
});

test("local-only cancellation keeps the old PayOS order separate from the editable cart", async () => {
  const { store, cancel, warnings } = cancellationHarness(async () => ({
    ...result(), nextAction: "RECREATE", cancellationMode: "LOCAL_ONLY",
  }));
  await cancel();
  assert.equal(store.getState().isPaymentLocked, false);
  assert.notEqual(store.getState().draftOrderId, id);
  assert.equal(warnings.length, 1);
});

test("a confirmed cancellation allows the existing draft to be reused", async () => {
  const { store, payment, cancel, warnings } = cancellationHarness(async () => ({
    ...result(), nextAction: "RECREATE", cancellationMode: "REMOTE_CONFIRMED",
  }));
  await cancel();
  assert.equal(store.getState().isPaymentLocked, false);
  assert.equal(store.getState().draftOrderId, id);
  assert.equal(payment.getState().localOrderId, null);
  assert.equal(warnings.length, 0);
});

test("a payment confirmed while cancelling still follows the completed checkout", async () => {
  const pending = deferred();
  const { store, payment, cancel, warnings } = cancellationHarness(() => pending.promise);
  const cancellation = cancel(() => assert.fail("A completed payment must not use the cancellation callback"));
  payment.getState().receivePaymentStatus(paid);
  pending.resolve({ ...result(), nextAction: "RECREATE", cancellationMode: "LOCAL_ONLY" });
  await cancellation;
  assert.equal(store.getState().isPaymentLocked, true);
  assert.equal(payment.getState().nextAction, "COMPLETED");
  assert.equal(warnings.length, 0);
});
