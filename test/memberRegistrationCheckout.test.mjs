import assert from "node:assert/strict";
import test from "node:test";
import { checkoutCallback } from "./helpers/checkoutRegressionHarness.mjs";

const packageProduct = { goodsId: "gold", category: 1 };
const ticket = { goodsId: "ticket", category: 4 };
const member = { uid: "new-member", phone: "0900000000" };

function setup(items, { registered = null, registerResult = member, mutateCart = false } = {}) {
  const calls = [];
  let cart = { items, vouchers: [], clearCart: () => calls.push(["clearCart"]) };
  const submit = checkoutCallback("../../src/lib/hooks/useMembersPageController.ts", "handleRegisterAndCheckout", {
    isPaymentLocked: false,
    registrationInFlightRef: { current: false },
    hasStartedInitialCardReadRef: { current: false },
    completedRegistrationMember: registered,
    useCartStore: { getState: () => cart },
    products: [packageProduct, ticket],
    isMemberPackageProduct: (product) => product === packageProduct,
    handleRegister: async () => {
      calls.push(["register"]);
      if (mutateCart) cart = { ...cart, items: [{ goodsId: ticket.goodsId, quantity: 1 }] };
      return registerResult;
    },
    openCheckoutForProduct: (id) => { calls.push(["packageCheckout", id]); return true; },
    setSelectedPhone() {}, setMode() {}, setQuery() {},
    completeLookup: (profile) => calls.push(["member", profile.uid]),
    setOperation: (operation) => calls.push(["operation", operation]),
    requestCheckoutModal: () => calls.push(["retailCheckout"]),
    router: { push: (path) => calls.push(["navigate", path]) },
    showWarning: (title) => calls.push(["warning", title]),
  });
  return { submit, calls };
}

test("registration hands the selected package to the existing member checkout after card issuance", async () => {
  const { submit, calls } = setup([{ goodsId: packageProduct.goodsId, quantity: 1 }]);
  await submit();
  assert.deepEqual(calls, [["register"], ["packageCheckout", "gold"], ["member", "new-member"], ["clearCart"], ["operation", "LOOKUP"]]);
});

test("an existing registration continues without creating the member again", async () => {
  const { submit, calls } = setup([{ goodsId: packageProduct.goodsId, quantity: 1 }], { registered: member });
  await submit();
  assert.equal(calls[0][0], "packageCheckout");
  assert.ok(!calls.some(([name]) => name === "register"));
});

test("registration leaves tickets in the retail checkout", async () => {
  const { submit, calls } = setup([{ goodsId: ticket.goodsId, quantity: 2 }]);
  await submit();
  assert.deepEqual(calls, [["register"], ["retailCheckout"], ["navigate", "/"]]);
});

test("mixed carts, failed card issuance and a changed cart never open checkout", async () => {
  const item = { goodsId: packageProduct.goodsId, quantity: 1 };
  const mixed = setup([item, { goodsId: ticket.goodsId, quantity: 1 }]);
  await mixed.submit();
  assert.deepEqual(mixed.calls, [["warning", "Thanh toán gói riêng"]]);

  const failed = setup([item], { registerResult: null });
  await failed.submit();
  assert.deepEqual(failed.calls, [["register"]]);

  const changed = setup([item], { mutateCart: true });
  await changed.submit();
  assert.deepEqual(changed.calls, [["register"], ["warning", "Giỏ hàng đã thay đổi"]]);
});

test("the member checkout initializes the registration package and a fresh order together", () => {
  const calls = [];
  const available = [{ goodsId: "gold", paymentAmountVnd: 2035000 }];
  const open = checkoutCallback("../../src/lib/hooks/useMemberPackageSaleController.ts", "openCheckoutForProduct", {
    cachedPackages: available,
    setPackages: (packages) => calls.push(["packages", packages]),
    selectPackage: (id) => calls.push(["select", id]),
    setPaymentMethod: (method) => calls.push(["payment", method]),
    beginCheckout: () => calls.push(["beginCheckout"]),
  });
  assert.equal(open("unavailable"), false);
  assert.deepEqual(calls, []);
  assert.equal(open("gold"), true);
  assert.deepEqual(calls, [["packages", available], ["select", "gold"], ["payment", "CASH"], ["beginCheckout"]]);
});
