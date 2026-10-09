import assert from "node:assert/strict";
import test from "node:test";
import { loadCashDrawerService } from "./helpers/cashDrawerHarness.mjs";
import { cartHarness, checkoutCallback, orderId } from "./helpers/checkoutRegressionHarness.mjs";

function mainCheckout(cart, drawer, printed) {
  return checkoutCallback("../../src/app/page.tsx", "handleCheckout", {
    useCartStore: cart.store, checkout: (...args) => cart.store.getState().checkout(...args),
    effectiveWarehouseId: "warehouse-a", shopId: 20692,
    openCashDrawerAfterPayment: drawer.service.openCashDrawerAfterPayment,
    handleAutoPrint: async (id) => { printed.push(id); },
    logCheckoutTelemetry() {}, showError() {}, showPromise: (promise) => promise,
  });
}

test("real cash checkout remains paid, clears cart and prints even when drawer dispatch fails", async () => {
  const cart = cartHarness(), drawer = loadCashDrawerService(), printed = [];
  drawer.fail(new Error("printer disconnected"));
  await mainCheckout(cart, drawer, printed)();
  assert.equal(cart.requests.length, 1);
  assert.equal(cart.requests[0].paymentMethodId, "CASH");
  assert.deepEqual(cart.requests[0].items, [{ goodsId: "g1", quantity: 2 }]);
  assert.equal(cart.store.getState().currentOrderStatus, "LOCAL_PAID");
  assert.equal(cart.store.getState().items.length, 0);
  assert.equal(cart.store.getState().isCheckingOut, false);
  assert.deepEqual(printed, [orderId]);
});

test("a pending drawer command cannot delay real checkout completion or printing", { timeout: 1000 }, async () => {
  const cart = cartHarness(), drawer = loadCashDrawerService(), printed = [];
  let release;
  drawer.waitFor(new Promise((resolve) => { release = resolve; }));
  try {
    await mainCheckout(cart, drawer, printed)();
    assert.equal(cart.store.getState().currentOrderStatus, "LOCAL_PAID");
    assert.deepEqual(printed, [orderId]);
    assert.equal(cart.requests.length, 1);
  } finally { release(); }
});

test("failed real checkout keeps the cart and never opens the drawer or prints", async () => {
  const cart = cartHarness(), drawer = loadCashDrawerService(), printed = [];
  cart.control.error = new Error("payment unavailable");
  await assert.rejects(mainCheckout(cart, drawer, printed)(), /payment unavailable/);
  assert.equal(cart.requests.length, 1);
  assert.equal(cart.store.getState().items.length, 1);
  assert.equal(cart.store.getState().currentOrderStatus, null);
  assert.equal(cart.store.getState().isCheckingOut, false);
  assert.equal(drawer.calls.length, 0);
  assert.equal(printed.length, 0);
});

test("real PayOS completion still unlocks cart and prints without dispatching a drawer", async () => {
  const cart = cartHarness(), drawer = loadCashDrawerService(), printed = [];
  cart.store.getState().lockCartForPayOS(orderId);
  const complete = checkoutCallback("../../src/app/page.tsx", "handlePayOSCompleted", {
    completePayOSCheckout: (...args) => cart.store.getState().completePayOSCheckout(...args),
    handleAutoPrint: async (id) => { printed.push(id); },
    openCashDrawerAfterPayment: drawer.service.openCashDrawerAfterPayment,
  });
  complete(orderId, "LOCAL_PAID");
  assert.equal(cart.store.getState().currentOrderStatus, "LOCAL_PAID");
  assert.equal(cart.store.getState().isPaymentLocked, false);
  assert.equal(cart.store.getState().items.length, 0);
  assert.deepEqual(printed, [orderId]);
  assert.equal(drawer.calls.length, 0);
});

function memberScope(drawer, events, error = null) {
  return {
    member: { uid: "u1", memberCode: "c1", fullName: "QA", phone: "0900000000", levelName: "Test" },
    selectedPackage: { goodsId: "g1" }, warehouseId: "warehouse-a", localOrderId: orderId, shopId: 20692,
    setPaymentCollected() {}, startMutation() {}, setCheckoutOpen() {}, markWaitingApi() {}, logCheckoutTelemetry() {}, clickButton() {},
    sellMemberPackageForCash: async () => { if (error) throw error; return { remoteOrderNumber: "REMOTE-1" }; },
    finalizeMemberPackageSale: async () => { if (error) throw error; return { remoteOrderNumber: "REMOTE-1" }; },
    completeSuccessfulSale: async (id) => { events.push(["completed", id]); },
    failMutation: (message) => { events.push(["failed", message]); },
    toMemberServiceError: (e) => ({ message: e.message, code: "test-error" }), showPromise: (promise) => promise,
    openCashDrawerAfterPayment: drawer.service.openCashDrawerAfterPayment,
  };
}

test("real member cash sale succeeds even when the drawer fails; sale failure never dispatches", async () => {
  const drawer = loadCashDrawerService(), events = [];
  drawer.fail(new Error("drawer error"));
  await checkoutCallback("../../src/lib/hooks/useMemberPackageSaleController.ts", "sellForCash", memberScope(drawer, events))();
  assert.deepEqual(events, [["completed", orderId]]);
  const failedDrawer = loadCashDrawerService(), failedEvents = [];
  await checkoutCallback("../../src/lib/hooks/useMemberPackageSaleController.ts", "sellForCash", memberScope(failedDrawer, failedEvents, new Error("sale failed")))();
  assert.deepEqual(failedEvents, [["failed", "sale failed"]]);
  assert.equal(failedDrawer.calls.length, 0);
});

test("real member QR finalization completes without opening drawer, while cash retry uses the original order", async () => {
  const drawer = loadCashDrawerService(), events = [];
  const finish = checkoutCallback("../../src/lib/hooks/useMemberPackageSaleController.ts", "finishRemoteSale", memberScope(drawer, events));
  await finish(orderId, "QR_CODE");
  assert.equal(drawer.calls.length, 0);
  await finish(orderId, "CASH");
  assert.equal(drawer.calls.length, 1);
  assert.equal(drawer.calls[0][1].orderId, orderId);
  assert.deepEqual(events, [["completed", orderId], ["completed", orderId]]);
});
