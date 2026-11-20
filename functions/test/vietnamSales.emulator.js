const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

if (process.env.GCLOUD_PROJECT !== "demo-pos-vietnam-sales" ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw new Error("Run with a loopback Firestore emulator and GCLOUD_PROJECT=demo-pos-vietnam-sales.");
}

process.env.HK_API_BASE_URL = "http://127.0.0.1:19999";
process.env.HK_API_APP_ID = "demo-pos-vietnam-sales";
process.env.HK_API_KEY = "demo-key";

const { db, admin } = require("../lib/config/firebase");
const posAuth = require("../lib/services/posAuthService");
const { loadPosProductCatalog } = require("../lib/services/productSyncService");
const {
  checkoutPosOrderForUser,
  onOrderLocalPaid,
  retryPosOrderSyncForUser,
  stagePosOrderForPayOS,
} = require("../lib/order/functions");
const { markPayOSPaymentPaid } = require("../lib/payment/payosFunctions");

test("store pricing and HK policy persist across checkout, PayOS and retries", async (t) => {
  const warehouseId = randomUUID();
  const localGoodsId = randomUUID();
  const hkGoodsId = randomUUID();
  const userId = "demo-cashier";
  const touched = [];
  const ref = (path) => {
    const document = db.doc(path);
    touched.push(document);
    return document;
  };
  t.after(async () => {
    await Promise.all(touched.map((document) => document.delete()));
    await admin.app().delete();
  });
  t.mock.method(posAuth, "getPosAuthSession", async () => ({
    user: { employee_id: "demo", full_name: "Demo" },
    warehouses: [{ id: warehouseId }],
    permissions: { [warehouseId]: { "pos.sales.create": true, "pos.orders.retry_sync": true } },
  }));
  const requests = [];
  let hkPaid = false;
  let allowHkPayment = false;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, "http://127.0.0.1:19999/openapi/action");
    const { action, body } = JSON.parse(request.body);
    requests.push({ action, body: JSON.parse(body) });
    if (action === "order_create") {
      return Response.json({ success: true, data: { orderNumber: "DEMO-HK", actualPayment: 200 } });
    }
    if (action === "order_pay") {
      hkPaid = allowHkPayment;
      return Response.json({ success: hkPaid, code: hkPaid ? 0 : 1, msg: "Demo" });
    }
    assert.equal(action, "order_pay_query");
    return Response.json({ success: true, data: { payStatus: hkPaid ? 2 : 0 } });
  });

  const store = ref(`pos_vietnam_product_settings/${warehouseId}`);
  const localConfig = ref(`${store.path}/products/${localGoodsId}`);
  const hkConfig = ref(`${store.path}/products/${hkGoodsId}`);
  const ticket = { goodsName: "Vé thử", category: 4, price: 190, afterTaxPrice: 200, ticketsPerUnit: 1 };
  const souvenir = { goodsName: "Quà thử", category: 10, price: 200, afterTaxPrice: 200 };
  const orderSettings = { version: 1, selling_price_vnd: 500, vat_rate: "KCT", effective_date: "2020-01-01" };
  await Promise.all([
    store.set({ enabled: true }),
    ref(`jpos_products/${localGoodsId}`).set({ ...ticket, is_deleted: true, syncStatus: "disabled" }),
    ref(`jpos_products/${hkGoodsId}`).set(souvenir),
    localConfig.set({ ...orderSettings, import_from_hk: false, send_sale_to_hk: false, local_product: ticket }),
    hkConfig.set({ ...orderSettings, import_from_hk: true, send_sale_to_hk: true, vat_rate: "8%" }),
  ]);

  let ordinal = 0;
  const input = (items) => ({
    localOrderId: `ORD-${Date.now()}-${String(++ordinal).padStart(6, "0")}`,
    shopId: 1,
    warehouseId,
    paymentMethodId: "CASH",
    items,
  });
  const orderRef = (data) => ref(`pos_orders/${data.localOrderId}`);
  const line = (goodsId, quotedPrice = 500) => ({ goodsId, quantity: 1, quotedPrice });
  const trigger = async (current, priorStatus = "DRAFT") => {
    const orderId = current.localOrderId;
    ref(`audit_logs/${priorStatus === "DRAFT" ? `pos-order-paid-${orderId}` : `pos-order-retry-${orderId}-${current.sync.retryCount}`}`);
    await onOrderLocalPaid.run({
      params: { orderId },
      data: {
        before: { exists: true, data: () => ({ ...current, status: priorStatus }) },
        after: { exists: true, data: () => current },
      },
    });
  };

  const catalog = await loadPosProductCatalog(warehouseId);
  assert.equal(catalog.products.find((product) => product.goodsId === localGoodsId).afterTaxPrice, 500);
  assert.equal(catalog.products.find((product) => product.goodsId === hkGoodsId).afterTaxPrice, 500);
  await assert.rejects(checkoutPosOrderForUser(userId, input([line(localGoodsId, 200)])), /Giá tại quầy/);
  await assert.rejects(checkoutPosOrderForUser(userId, input([line(localGoodsId), line(hkGoodsId)])), /tách sản phẩm/);

  const cash = input([line(localGoodsId)]);
  const cashRef = orderRef(cash);
  assert.equal((await checkoutPosOrderForUser(userId, cash)).syncStatus, "SKIPPED");
  const cashOrder = (await cashRef.get()).data();
  await trigger(cashOrder);
  assert.equal(cashOrder.hkOrderNumber, null);
  assert.equal(cashOrder.totalAmount, 500);
  assert.equal(cashOrder.items[0].vatRateName, "KCT");
  assert.equal(cashOrder.items[0].ticketCodes.length, 1);
  assert.equal((await retryPosOrderSyncForUser(userId, cash)).queued, false);
  assert.deepEqual(requests, []);

  const qr = input([line(localGoodsId)]);
  const qrRef = orderRef(qr);
  const draft = await stagePosOrderForPayOS(userId, qr);
  const orderCode = 123456;
  const paymentLinkId = "demo-qr";
  await qrRef.update({ paymentDetails: { currentOrderCode: orderCode, attempts: [{
    orderCode, paymentLinkId, status: "PENDING", amount: draft.totalAmount,
  }] } });
  await localConfig.update({ selling_price_vnd: 700, send_sale_to_hk: true, version: 2 });
  await assert.rejects(stagePosOrderForPayOS(userId, qr), /đang có phiên chuyển khoản/);
  await assert.rejects(checkoutPosOrderForUser(userId, qr), /đang có phiên chuyển khoản/);
  assert.equal(await markPayOSPaymentPaid(qrRef, orderCode, {
    orderCode, paymentLinkId, code: "00", amount: 500, currency: "VND",
  }), "PAID");
  const paidQr = (await qrRef.get()).data();
  assert.equal(paidQr.totalAmount, 500);
  assert.equal(paidQr.items[0].vietnamSettingsVersion, 1);
  assert.equal(paidQr.syncStatus, "SKIPPED");
  await trigger(paidQr);
  assert.deepEqual(requests, []);

  const hk = input([line(hkGoodsId)]);
  const hkRef = orderRef(hk);
  await checkoutPosOrderForUser(userId, hk);
  await trigger((await hkRef.get()).data());
  assert.equal((await hkRef.get()).get("status"), "SYNC_FAILED");
  assert.equal((await hkRef.get()).get("remoteActualPayment"), 200);
  await hkConfig.update({ send_sale_to_hk: false, selling_price_vnd: 900, version: 2 });
  allowHkPayment = true;
  assert.equal((await retryPosOrderSyncForUser(userId, hk)).queued, true);
  await trigger((await hkRef.get()).data(), "SYNC_FAILED");
  const hkOrder = (await hkRef.get()).data();
  assert.equal(hkOrder.status, "SYNC_SUCCESS");
  assert.equal(hkOrder.totalAmount, 500);
  assert.equal(hkOrder.items[0].taxAmount, 37);
  assert.equal(requests.filter(({ action }) => action === "order_create").length, 1);
  assert.deepEqual(requests.filter(({ action }) => action === "order_pay").map(({ body }) => body.PayAmount), [200, 200]);

  await store.update({ enabled: false });
  const paused = input([line(hkGoodsId, 200)]);
  orderRef(paused);
  assert.equal((await checkoutPosOrderForUser(userId, paused)).totalAmount, 200);
});
