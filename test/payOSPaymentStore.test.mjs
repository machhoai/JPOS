import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

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
