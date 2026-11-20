/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRemoteMemberRegistrationBody,
  buildRemoteOrderCreateBody,
  buildRemoteOrderPayBody,
  readRemoteOrderPayAmount,
} = require("../lib/services/hkApiService");

test("member_join never sends an unsupported physical card field", () => {
  const body = buildRemoteMemberRegistrationBody({
    openId: "stable-open-id",
    phone: "0901234567",
    realName: "Khách hàng",
    memberCode: "01PAYJOYW003467",
  });

  assert.deepEqual(body, {
    openId: "stable-open-id",
    phone: "0901234567",
    realName: "Khách hàng",
  });
  assert.equal("memberCode" in body, false);
});

test("order_create sends only member and goods fields to the HK system", () => {
  const body = buildRemoteOrderCreateBody({
    uid: "member-001",
    goodsItems: [{ goodsId: "goods-001", quantity: "2" }],
  });

  assert.deepEqual(body, {
    Uid: "member-001",
    GoodsItems: [{ GoodsId: "goods-001", Quantity: "2" }],
  });
  assert.equal("paymentMethod" in body, false);
  assert.equal("PaymentMethod" in body, false);
  assert.equal("PayType" in body, false);
});

test("order_pay relies on the HK default payment method", () => {
  const body = buildRemoteOrderPayBody("HK-ORDER-001");

  assert.deepEqual(body, {
    OrderNumber: "HK-ORDER-001",
    PayAmount: null,
  });
  assert.equal("paymentMethod" in body, false);
  assert.equal("PaymentMethod" in body, false);
  assert.equal("PayType" in body, false);
});

test("order_pay uses the amount calculated by HK even when the local order costs more", () => {
  const localOrder = { totalAmount: 500 };
  const hkOrder = { totalAmount: 220, discountAmount: 20, actualPayment: "200" };
  const payload = buildRemoteOrderPayBody("HK-ORDER-002", readRemoteOrderPayAmount(hkOrder.actualPayment));
  assert.deepEqual(payload, {
    OrderNumber: "HK-ORDER-002",
    PayAmount: 200,
  });
  assert.equal(localOrder.totalAmount, 500);
});

test("an unavailable HK amount defaults to the HK order total", () => {
  for (const amount of [undefined, null, true, " ", "2e2", 0, -1, 1.5, Infinity]) {
    assert.equal(readRemoteOrderPayAmount(amount), null);
  }
  assert.equal(readRemoteOrderPayAmount(200), 200);
});
