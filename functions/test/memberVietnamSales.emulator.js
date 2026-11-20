const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

if (process.env.GCLOUD_PROJECT !== "demo-pos-vietnam-member-sales" ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw new Error("Use a loopback Firestore emulator and project demo-pos-vietnam-member-sales.");
}

const { db, admin } = require("../lib/config/firebase");
const hk = require("../lib/services/hkApiService");
const auth = require("../lib/services/posAuthService");
const remotePackages = require("../lib/services/memberPackageService");
const { loadPosProductCatalog } = require("../lib/services/productSyncService");
const { checkoutPosOrderForUser, stagePosOrderForPayOS } = require("../lib/order/functions");
const { markPayOSPaymentPaid } = require("../lib/payment/payosFunctions");
const { finalizeMemberPackageSaleForUser, listMemberPackagesForUser, prepareMemberPackageOrderForUser, sellMemberPackageForCashForUser } = require("../lib/member/packageFunctions");

test("member package Vietnam pricing and HK entitlement settlement", async (t) => {
  const warehouseId = randomUUID();
  const goodsId = randomUUID();
  const userId = "cashier";
  const scope = { warehouseId, shopId: 1, uid: "demo-member" };
  const members = { uid: scope.uid, memberCode: null, fullName: "Demo", phone: "0900000000", levelName: "Demo" };
  const documents = [];
  const ref = (path) => { const document = db.doc(path); documents.push(document); return document; };
  t.after(async () => {
    await Promise.all(documents.map((document) => document.delete()));
    await admin.app().delete();
  });
  const remotePackage = { goodsId, category: 1, name: "Gói thử", paymentAmountVnd: 200, taxRate: 0, taxRateType: 1, totalPoints: 80 };
  t.mock.method(auth, "getPosAuthSession", async () => ({
    warehouses: [{ id: warehouseId }], user: { employee_id: "demo", full_name: "Demo" },
    permissions: { [warehouseId]: { "pos.sales.create": true } },
  }));
  t.mock.method(remotePackages, "loadRemoteMemberPackage", async () => remotePackage);
  t.mock.method(remotePackages, "loadRemoteMemberPackages", async () => [remotePackage]);
  const requests = [];
  const statusByNumber = new Map();
  let nextPayStatus = 2;
  t.mock.method(hk, "createRemoteOrder", async (body) => {
    assert.deepEqual(body, { uid: scope.uid, goodsItems: [{ goodsId, quantity: "1" }] });
    const orderNumber = `HK-${statusByNumber.size + 1}`;
    statusByNumber.set(orderNumber, null);
    return { success: true, data: { orderNumber, actualPayment: 200 } };
  });
  t.mock.method(hk, "queryPaymentStatus", async ({ orderNumber }) => {
    const status = statusByNumber.get(orderNumber);
    if (status === null) return { success: false, code: 2001, msg: "Thông tin đặt hàng thanh toán không tồn tại", data: null };
    if (status === "invalid-child") return { success: false, code: 2001, msg: "Xử lý đơn đặt hàng con không thành công", data: null };
    return { success: true, data: { payStatus: status } };
  });
  t.mock.method(hk, "confirmRemotePayment", async (body) => {
    requests.push(body);
    statusByNumber.set(body.orderNumber, nextPayStatus);
    return { success: true, data: null };
  });

  const store = ref(`pos_vietnam_product_settings/${warehouseId}`);
  const settings = ref(`${store.path}/products/${goodsId}`);
  await Promise.all([
    store.set({ enabled: true, member_packages_enabled: false }),
    settings.set({ version: 1, selling_price_vnd: 500, vat_rate: "10%", send_sale_to_hk: true, import_from_hk: true, effective_date: "2020-01-01" }),
    ref(`jpos_products/${goodsId}`).set({ goodsName: "Gói thử", category: 1, price: 200, afterTaxPrice: 200, principalPoints: 80 }),
  ]);
  const catalogPrice = async () => (await loadPosProductCatalog(warehouseId)).products.find((product) => product.goodsId === goodsId)?.afterTaxPrice;
  assert.equal(await catalogPrice(), 200);
  await store.update({ member_packages_enabled: true });
  assert.equal(await catalogPrice(), 500);
  assert.equal((await listMemberPackagesForUser(userId, scope)).packages[0].totalPoints, 80);
  assert.equal((await listMemberPackagesForUser(userId, scope)).packages[0].paymentAmountVnd, 500);

  let ordinal = 0;
  const draftInput = (quotedPrice) => ({ ...scope, localOrderId: `ORD-${Date.now()}-${String(++ordinal).padStart(6, "0")}`, goodsId, member: members, quotedPrice });
  const staleQuote = draftInput(200);
  await assert.rejects(sellMemberPackageForCashForUser(userId, staleQuote), (error) => error.details?.action === "MEMBER_PACKAGE_QUOTE_CHANGED");
  assert.equal((await db.doc(`pos_orders/${staleQuote.localOrderId}`).get()).exists, false);
  await assert.rejects(checkoutPosOrderForUser(userId, {
    ...draftInput(500), paymentMethodId: "CASH", items: [{ goodsId, quantity: 1, quotedPrice: 500 }],
  }), /mục Thành viên/);

  const cash = draftInput(500);
  const cashRef = ref(`pos_orders/${cash.localOrderId}`);
  nextPayStatus = 1;
  await assert.rejects(sellMemberPackageForCashForUser(userId, cash));
  await assert.rejects(finalizeMemberPackageSaleForUser(userId, cash), /HK chưa xác nhận/);
  statusByNumber.set("HK-1", null);
  await assert.rejects(finalizeMemberPackageSaleForUser(userId, cash), /HK chưa xác nhận/);
  assert.equal(requests.length, 1);
  statusByNumber.set("HK-1", 2);
  assert.equal((await finalizeMemberPackageSaleForUser(userId, cash)).status, "SYNC_SUCCESS");
  assert.equal((await finalizeMemberPackageSaleForUser(userId, cash)).status, "SYNC_SUCCESS");
  const cashOrder = (await cashRef.get()).data();
  assert.equal(cashOrder.totalAmount, 500);
  assert.equal(cashOrder.items[0].vatRateName, "10%");
  assert.equal(cashOrder.items[0].taxAmount, 45);
  assert.ok(cashOrder.invoiceRequestToken);

  const qr = draftInput(500);
  const qrRef = ref(`pos_orders/${qr.localOrderId}`);
  assert.equal((await prepareMemberPackageOrderForUser(userId, qr)).totalAmount, 500);
  await settings.update({ selling_price_vnd: 700, vat_rate: "KCT", version: 2 });
  const staged = await stagePosOrderForPayOS(userId, { ...qr, items: [{ goodsId, quantity: 1, quotedPrice: 500 }] });
  assert.equal(staged.totalAmount, 500);
  await qrRef.update({ paymentDetails: { currentOrderCode: 123456, attempts: [{ orderCode: 123456, paymentLinkId: "demo", status: "PENDING", amount: 500 }] } });
  await assert.rejects(sellMemberPackageForCashForUser(userId, qr), /đang có phiên chuyển khoản/);
  assert.equal(await markPayOSPaymentPaid(qrRef, 123456, { orderCode: 123456, paymentLinkId: "demo", amount: 500, currency: "VND", code: "00" }), "PAID");
  nextPayStatus = 2;
  await finalizeMemberPackageSaleForUser(userId, qr);
  assert.equal((await qrRef.get()).get("totalAmount"), 500);
  assert.equal((await qrRef.get()).get("items")[0].vatRateName, "10%");
  assert.deepEqual(requests, [{ orderNumber: "HK-1", payAmount: 200 }, { orderNumber: "HK-2", payAmount: 200 }]);

  const legacy = draftInput(700);
  const legacyRef = ref(`pos_orders/${legacy.localOrderId}`);
  await prepareMemberPackageOrderForUser(userId, legacy);
  await legacyRef.update({ status: "SYNC_FAILED", syncStatus: "SYNC_FAILED", hkOrderNumber: "HK-existing",
    remoteActualPayment: 200, paidAt: new Date().toISOString(),
    "sync.lastError": "HK chưa xác nhận đơn có thể thanh toán. Hãy kiểm tra hoặc thử lại đơn hiện tại." });
  statusByNumber.set("HK-existing", "invalid-child");
  await assert.rejects(finalizeMemberPackageSaleForUser(userId, legacy), /HK chưa xác nhận/);
  assert.equal(requests.length, 2);
  statusByNumber.set("HK-existing", null);
  assert.equal((await finalizeMemberPackageSaleForUser(userId, legacy)).remoteOrderNumber, "HK-existing");
  assert.deepEqual(requests.at(-1), { orderNumber: "HK-existing", payAmount: 200 });
  assert.ok((await legacyRef.get()).get("remotePaymentAttemptedAt"));

  await settings.update({ send_sale_to_hk: false });
  assert.equal(await catalogPrice(), undefined);
  await assert.rejects(prepareMemberPackageOrderForUser(userId, draftInput(700)), /cấp quyền lợi/);
});
