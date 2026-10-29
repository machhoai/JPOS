/* Synthetic local data only. Never run against a real Firebase project. */
const test = require("node:test");
const assert = require("node:assert/strict");
if (process.env.GCLOUD_PROJECT !== "demo-pos-payment" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8085") throw Error("Local demo emulator required");
const { db } = require("../lib/config/firebase");
const auth = require("../lib/services/posAuthService");
const { listPosOrdersForUser, listCloseoutOrdersForUser, getPosOrderForUser } = require("../lib/order/functions");
const { handlePayOSReconciliation } = require("../lib/payment/payosReconciliation");
const { getCurrentVietnamDayRange } = require("../lib/order/orderHistoryRange");

test("report permissions enforce ownership/date/store at the real backend entry points", async (t) => {
  const today = getCurrentVietnamDayRange();
  const yesterday = { startAt: new Date(Date.parse(today.startAt) - 86400000).toISOString(), endAt: today.startAt };
  const store = "report-permissions-store";
  const originalAuth = auth.getPosAuthSession;
  let keys = [];
  auth.getPosAuthSession = async () => ({ warehouses: [{ id: store }], permissions: { [store]: Object.fromEntries(keys.map((key) => [key, true])) } });
  const refs = [];
  let suffix = 910001;
  async function fixture(createdBy, range, warehouseId = store) {
    const id = `ORD-${Date.now()}-${suffix++}`;
    const ref = db.collection("pos_orders").doc(id);
    refs.push(ref);
    const createdAt = new Date(Date.parse(range.startAt) + 3600000).toISOString();
    await ref.set({ localOrderId: id, warehouseId, createdBy, createdAt, paidAt: createdAt,
      status: "SYNC_SUCCESS", paymentStatus: "PAID", syncStatus: "SYNC_SUCCESS", totalAmount: 1000,
      paymentMethod: "CASH", paymentMethodId: "CASH", invoiceRequestToken: "A".repeat(43), items: [] });
    return id;
  }
  const input = (range = today, scope = "CURRENT_USER", purpose = "VIEW") => ({ ...range, scope, purpose, warehouseId: store });
  const denied = (promise) => assert.rejects(promise, { code: "permission-denied" });
  try {
    const mine = await fixture("me", today);
    const other = await fixture("other", today);
    const old = await fixture("me", yesterday);
    await fixture("me", today, "other-store");
    await t.test("own history filters other employees; rejects old dates, other stores and direct IDs", async () => {
      keys = ["pos.orders.read_own_today"];
      assert.deepEqual((await listPosOrdersForUser("me", input())).orders.map((order) => order.localOrderId), [mine]);
      await denied(listPosOrdersForUser("me", input(yesterday)));
      await denied(listPosOrdersForUser("me", { ...input(), warehouseId: "other-store" }));
      await denied(getPosOrderForUser("me", { localOrderId: other }));
      await denied(getPosOrderForUser("me", { localOrderId: old }));
    });
    await t.test("full history reads all employees and past dates", async () => {
      keys = ["pos.orders.read"];
      assert.deepEqual(new Set((await listPosOrdersForUser("me", input())).orders.map((order) => order.localOrderId)), new Set([mine, other]));
      assert.deepEqual((await listPosOrdersForUser("me", input(yesterday))).orders.map((order) => order.localOrderId), [old]);
    });
    await t.test("own closeout: paid today only, own creator, and explicit print permission", async () => {
      keys = ["pos.shift.read_own_today"];
      assert.deepEqual((await listCloseoutOrdersForUser("me", input())).orders.map((order) => order.localOrderId), [mine]);
      await denied(listCloseoutOrdersForUser("me", input(today, "ALL_USERS")));
      await denied(listCloseoutOrdersForUser("me", input(yesterday)));
      await denied(listCloseoutOrdersForUser("me", input(today, "CURRENT_USER", "PRINT")));
      keys.push("pos.shift.print_own_today");
      assert.equal((await listCloseoutOrdersForUser("me", input(today, "CURRENT_USER", "PRINT"))).orders.length, 1);
      await denied(handlePayOSReconciliation("me", { warehouseId: store }, "reconcile-closeout", input(today, "ALL_USERS", "PRINT")));
    });
    await t.test("full view with own print cannot print all or historical reports; view alone cannot print", async () => {
      keys = ["pos.shift.close", "pos.shift.print_own_today"];
      assert.equal((await listCloseoutOrdersForUser("me", input(today, "ALL_USERS"))).orders.length, 2);
      await denied(listCloseoutOrdersForUser("me", input(today, "ALL_USERS", "PRINT")));
      await denied(listCloseoutOrdersForUser("me", input(yesterday, "CURRENT_USER", "PRINT")));
      keys = ["pos.shift.close", "pos.shift.print"];
      assert.equal((await handlePayOSReconciliation("me", { warehouseId: store }, "reconcile-closeout", input(yesterday, "ALL_USERS", "PRINT"))).orders.length, 1);
      await denied(handlePayOSReconciliation("me", { warehouseId: "other-store" }, "reconcile-closeout", input()));
      keys = ["pos.shift.print"];
      await denied(listCloseoutOrdersForUser("me", input()));
      await denied(listCloseoutOrdersForUser("me", input(today, "ALL_USERS", "PRINT")));
    });
    await t.test("own PayOS access rejects cross-account and historical check/ack", async () => {
      keys = ["pos.orders.read_own_today"];
      for (const localOrderId of [other, old]) for (const action of ["reconcile-check", "reconcile-ack"]) {
        await denied(handlePayOSReconciliation("me", { warehouseId: store }, action, { localOrderId }));
      }
      await handlePayOSReconciliation("me", { warehouseId: store }, "reconcile-ack", { localOrderId: mine });
    });
    await t.test("invalid purpose rejected rather than downgraded to view", async () => {
      keys = ["pos.shift.close"];
      await assert.rejects(listCloseoutOrdersForUser("me", { ...input(), purpose: "export" }), { code: "invalid-argument" });
    });
    await t.test("sales receipts stay available for own sales today without granting order-history access", async () => {
      keys = ["pos.sales.create"];
      assert.equal((await getPosOrderForUser("me", { localOrderId: mine })).order.localOrderId, mine);
      await denied(getPosOrderForUser("me", { localOrderId: other }));
      await denied(getPosOrderForUser("me", { localOrderId: old }));
      await denied(listPosOrdersForUser("me", input()));
    });
    await t.test("PayOS list and badges honor own-day access; full readers retain all employees", async () => {
      const pending = { paymentMethod: "QR_CODE", paymentVerificationStatus: "UNVERIFIED",
        paymentDetails: { provider: "payos", attempts: [{ status: "PENDING", paymentLinkId: "synthetic-link" }] },
        payosReconciliation: { dueAt: today.endAt, nextCheckAt: today.endAt } };
      await Promise.all([mine, other, old].map((id) => db.collection("pos_orders").doc(id).update(pending)));
      keys = ["pos.orders.read_own_today"];
      assert.deepEqual((await handlePayOSReconciliation("me", { warehouseId: store }, "reconcile-list", {})).orders.map((order) => order.localOrderId), [mine]);
      keys = ["pos.orders.read"];
      assert.deepEqual(new Set((await handlePayOSReconciliation("me", { warehouseId: store }, "reconcile-list", {})).orders.map((order) => order.localOrderId)), new Set([mine, other]));
    });
  } finally {
    auth.getPosAuthSession = originalAuth;
    await Promise.all(refs.map((ref) => ref.delete()));
  }
});
