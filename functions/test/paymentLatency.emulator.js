/* eslint-disable @typescript-eslint/no-require-imports */
// Run explicitly against the local Firestore emulator, never production:
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=demo-pos-payment node --test test/paymentLatency.emulator.js
const test = require("node:test");
const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || process.env.GCLOUD_PROJECT !== "demo-pos-payment") {
  throw new Error("This integration test only runs against the local demo-pos-payment emulator.");
}
const { db } = require("../lib/config/firebase");
const { createPaymentWatch } = require("../lib/payment/paymentStatusProjection");
const { markPayOSPaymentPaid, createPayOSPaymentForUser, cancelPayOSPaymentForUser } = require("../lib/payment/payosFunctions");
const { withPayOSCheckLease } = require("../lib/payment/payosCheckLease");
const project = process.env.GCLOUD_PROJECT;
const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: uid, user_id: uid, aud: project, iss: `https://securetoken.google.com/${project}`, iat: now, exp: now + 3600, firebase: { sign_in_provider: "password" } })).toString("base64url"), ""].join(".");
}
function request(path, uid, method = "GET", body) {
  return fetch(url + path, {
    method, headers: { ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const orderId = "ORD-1791208105614-ABC123";
const orderRef = db.collection("pos_orders").doc(orderId);
const device = { id: "test-device", warehouseId: "test-warehouse" };
const attempt = { orderCode: 123, status: "PENDING", amount: 2000, paymentLinkId: "test-link", createdAt: new Date().toISOString(), linkExpiresAt: new Date(Date.now() + 900000).toISOString(), displayExpiresAt: new Date(Date.now() + 300000).toISOString() };
const payment = { code: "00", orderCode: 123, amount: 2000, currency: "VND", paymentLinkId: "test-link" };

test("atomic realtime, access revocation and distributed payment checks", async () => {
  await db.doc("users/test-owner").set({ username: "test", email: "test@example.invalid", full_name: "Test", employee_id: "test", status: "ACTIVE", is_deleted: false });
  await db.doc("roles/test-role").set({ is_deleted: false, permissions: { "pos.login": true, "pos.sales.create": true } });
  await db.doc("user_warehouse_roles/test-assignment").set({ user_id: "test-owner", warehouse_id: device.warehouseId, role_id: "test-role", assigned_by: "test", valid_from: "2026-01-01", valid_until: null, is_active: true, is_deleted: false });
  await db.doc(`warehouses/${device.warehouseId}`).set({ name: "Test", code: "TEST", type: "STORE", status: "ACTIVE", is_deleted: false });
  await db.doc(`pos_devices/${device.id}`).set({ status: "ACTIVE", is_deleted: false, warehouse_id: device.warehouseId });
  await db.doc("user_access/test-owner").set({ is_deleted: false, is_global_admin: false, active_version_id: "v1", access_version: 1 });
  const grantRef = db.doc(`user_access/test-owner/versions/v1/facilities/${device.warehouseId}`);
  const grant = { is_deleted: false, user_id: "test-owner", facility_id: device.warehouseId, access_version_id: "v1", access_version: 1, permissions: { "pos.login": true } };
  await grantRef.set(grant);
  const order = { localOrderId: orderId, orderKind: "MEMBER_PACKAGE", createdBy: "test-owner", deviceId: device.id, warehouseId: device.warehouseId, status: "DRAFT", totalAmount: 2000, updatedAt: new Date().toISOString(), paymentDetails: { provider: "payos", currentOrderCode: 123, attempts: [attempt] } };
  await orderRef.set(order);
  const watch = await createPaymentWatch("test-owner", device, orderId);
  const watchPath = `/pos_payment_status/${watch.watchId}`;
  assert.equal((await request(watchPath, "test-owner")).status, 200, "valid owner with warehouse grant");
  assert.equal((await request(watchPath, "another-owner")).status, 403, "other actor cannot get this subscription");
  assert.equal((await request(watchPath)).status, 403, "anonymous read denied");
  assert.equal((await request(watchPath, "test-owner", "PATCH", { fields: { orderStatus: { stringValue: "LOCAL_PAID" } } })).status, 403, "client cannot forge paid status");
  assert.equal((await request(":runQuery", "test-owner", "POST", { structuredQuery: { from: [{ collectionId: "pos_payment_status" }] } })).status, 403, "collection listing denied");
  await db.doc(`pos_devices/${device.id}`).update({ status: "LOCKED" });
  assert.equal((await request(watchPath, "test-owner")).status, 403, "locked device revokes read");
  await db.doc(`pos_devices/${device.id}`).update({ status: "ACTIVE" });
  await grantRef.update({ permissions: {} });
  assert.equal((await request(watchPath, "test-owner")).status, 403, "permission revocation denies read");
  await grantRef.set(grant);
  await db.doc("user_access/test-owner").update({ active_version_id: "v2", access_version: 2 });
  assert.equal((await request(watchPath, "test-owner")).status, 403, "old materialized RBAC version is invalid");
  await db.doc("user_access/test-owner").update({ active_version_id: "v1", access_version: 1 });
  await db.doc("users/test-owner").update({ status: "SUSPENDED" });
  assert.equal((await request(watchPath, "test-owner")).status, 403, "suspended actor cannot read");
  await db.doc("users/test-owner").update({ status: "ACTIVE" });
  await db.doc(`pos_payment_status/${watch.watchId}`).update({ expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await request(watchPath, "test-owner")).status, 403, "expired watch denied");
  await createPaymentWatch("test-owner", device, orderId);
  await assert.rejects(createPaymentWatch("test-owner", { ...device, id: "another-device" }, orderId), { code: "permission-denied" });

  const outcomes = await Promise.all([
    markPayOSPaymentPaid(orderRef, 123, { ...payment, confirmationSource: "WEBHOOK", webhookReceivedAt: new Date().toISOString() }),
    markPayOSPaymentPaid(orderRef, 123, { ...payment, confirmationSource: "API_CHECK" }),
  ]);
  assert.deepEqual(outcomes.sort(), ["ALREADY_COMPLETED", "PAID"]);
  const first = (await orderRef.get()).data();
  const status = (await db.doc(`pos_payment_status/${watch.watchId}`).get()).data();
  assert.equal(status.orderStatus, "LOCAL_PAID");
  assert.equal(status.paidAt, first.paidAt);
  assert.equal(status.confirmationSource, first.paymentDetails.attempts[0].confirmationSource);
  await markPayOSPaymentPaid(orderRef, 123, { ...payment, confirmationSource: "WEBHOOK" });
  assert.deepEqual((await orderRef.get()).data().paymentDetails.attempts[0], first.paymentDetails.attempts[0], "duplicate confirmation cannot rewrite paidAt/source");

  await orderRef.set(order);
  await markPayOSPaymentPaid(orderRef, 123, payment);
  const lateWatch = await createPaymentWatch("test-owner", device, orderId);
  assert.equal((await db.doc(`pos_payment_status/${lateWatch.watchId}`).get()).data().orderStatus, "LOCAL_PAID", "initial snapshot captures payment before subscription");

  const provider = require("../lib/services/payosService");
  const originalProvider = provider.getPayOS;
  let signalCreating;
  let resolveCreate;
  let creatingInput;
  let cancels = 0;
  const startedCreating = new Promise((resolve) => { signalCreating = resolve; });
  const createReply = new Promise((resolve) => { resolveCreate = resolve; });
  provider.getPayOS = () => ({ paymentRequests: {
    create: (input) => { creatingInput = input; signalCreating(); return createReply; },
    cancel: async () => { cancels++; return cancels === 1 ? null : { status: "CANCELLED" }; },
    get: async () => { throw new Error("No provider GET is needed while the attempt is CREATING"); },
  } });
  try {
    await orderRef.set({ ...order, shopId: 20692, paymentDetails: null, items: [{ goodsId: "test-goods", goodsName: "Test", price: 2000, quantity: 1 }] });
    const creation = createPayOSPaymentForUser("test-owner", { localOrderId: orderId, shopId: 20692, warehouseId: device.warehouseId, deviceId: device.id, items: [{ goodsId: "test-goods", quantity: 1 }] });
    await startedCreating;
    const cancelled = await cancelPayOSPaymentForUser("test-owner", { localOrderId: orderId });
    assert.equal(cancelled.payment.status, "CANCELLED");
    resolveCreate({ status: "PENDING", orderCode: creatingInput.orderCode, amount: 2000, description: creatingInput.description, paymentLinkId: "late-link", checkoutUrl: "https://example.invalid", qrCode: "test-qr", bin: "970422", accountNumber: "test", accountName: "test", currency: "VND" });
    const late = await creation;
    assert.equal(late.payment.status, "CANCELLED", "late create response cannot revive the cancelled attempt");
    assert.equal(late.nextAction, "RECREATE");
    assert.equal(late.fixedTransfer, null, "cancellation must not activate a fixed-transfer fallback");
    assert.equal(cancels, 2, "cancel the provider link that appeared after local cancellation");
  } finally {
    provider.getPayOS = originalProvider;
  }

  await orderRef.set(order);
  await db.doc("pos_payment_checks/123").delete();
  let calls = 0;
  const check = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 40)); return order; };
  await Promise.all([withPayOSCheckLease(orderRef, 123, false, check), withPayOSCheckLease(orderRef, 123, false, check)]);
  assert.equal(calls, 1, "two concurrent requests share one provider GET");
  await withPayOSCheckLease(orderRef, 123, false, check);
  assert.equal(calls, 1, "fresh result skips provider GET");
  await withPayOSCheckLease(orderRef, 123, true, check);
  assert.equal(calls, 2, "final expiry check forces fresh provider result");
});
