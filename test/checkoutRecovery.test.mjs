import assert from "node:assert/strict";
import test from "node:test";
import { cartHarness } from "./helpers/checkoutRegressionHarness.mjs";

const vietnamMidnight = Date.parse("2026-11-15T17:00:00.000Z");
const item = { goodsId: "g1", goodsName: "Test product", price: 3000, quantity: 1 };

async function recoverCheckout(overrides) {
  const { store, journal } = cartHarness({
    id: "active-checkout",
    schemaVersion: 1,
    checkpoint: "CART_READY",
    localOrderId: null,
    warehouseId: "warehouse-a",
    shopId: 20692,
    items: [item],
    paymentMethod: "CASH",
    totalAmount: 3000,
    orderStatus: "DRAFT",
    startedAt: new Date(vietnamMidnight).toISOString(),
    updatedAt: new Date(vietnamMidnight).toISOString(),
    lastError: null,
    recoveryCount: 0,
    ...overrides,
  });
  store.setState(store.getInitialState(), true);
  store.getState().setCheckoutContext(20692, "warehouse-a");
  await store.getState().hydrateCheckoutJournal();
  assert.equal(store.getState().journalHydrated, true);
  return { state: store.getState(), journal };
}

test("skips yesterday's order even if its journal was saved after Vietnam midnight", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: vietnamMidnight + 60_000 });
  const { state, journal } = await recoverCheckout({
    localOrderId: `ORD-${vietnamMidnight - 1}-ABC123`,
    checkpoint: "PAYMENT_INITIATED",
    paymentMethod: "QR_CODE",
  });
  assert.deepEqual(state.items, []);
  assert.equal(state.draftOrderId, null);
  assert.equal(state.currentOrderId, null);
  assert.equal(state.isPaymentLocked, false);
  assert.equal(state.recoveryNotice, null);
  assert.deepEqual(journal, []);
});

test("restores orders created from Vietnam midnight onwards", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: vietnamMidnight + 60_000 });
  const localOrderId = `ORD-${vietnamMidnight}-ABC123`;
  const { state, journal } = await recoverCheckout({ localOrderId });
  assert.deepEqual(state.items, [item]);
  assert.equal(state.draftOrderId, localOrderId);
  assert.equal(state.recoveryNotice, "CART_READY");
  assert.equal(journal[0].recoveryCount, 1);
});

test("uses the journal start date for a cart that has no order ID yet", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: vietnamMidnight + 60_000 });
  const today = await recoverCheckout({});
  assert.deepEqual(today.state.items, [item]);

  const yesterday = await recoverCheckout({
    startedAt: new Date(vietnamMidnight - 1).toISOString(),
  });
  assert.deepEqual(yesterday.state.items, []);

  const invalid = await recoverCheckout({ startedAt: "invalid" });
  assert.deepEqual(invalid.state.items, []);
});
