/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateVoucherDiscount,
  listVoucherCodeFormats,
  normalizeVoucherCode,
} = require("../lib/services/voucherService");
const { db } = require("../lib/config/firebase");

test("lists distinct suffixes, including blank, for active campaigns enabled at the POS store", async (t) => {
  const setting = (id, overrides = {}) => ({
    id: `store-a__${id}`,
    data: () => ({ campaign_id: id, enabled: true, ...overrides }),
  });
  const campaign = (prefix, suffix, overrides = {}) => ({
    data: () => ({
      prefix, suffix, status: "ACTIVE", valid_from: "2000-01-01", valid_to: "2100-01-01",
      ...overrides,
    }),
  });
  t.mock.method(db, "collection", (name) => {
    if (name === "marketing_voucher_campaigns") return { doc: (id) => id };
    assert.equal(name, "pos_voucher_campaign_settings");
    return {
      where: (...args) => {
        assert.deepEqual(args, ["warehouse_id", "==", "store-a"]);
        return {
          get: async () => ({
            docs: [
              setting("with-suffix"), setting("without-suffix"), setting("duplicate"),
              setting("another-prefix"), setting("inactive"), setting("expired"),
              setting("disabled", { enabled: false }), setting("deleted", { is_deleted: true }),
            ],
          }),
        };
      },
    };
  });
  t.mock.method(db, "getAll", async (...args) => {
    assert.deepEqual(args.slice(0, -1), [
      "with-suffix", "without-suffix", "duplicate", "another-prefix", "inactive", "expired",
    ]);
    return [
      campaign("A", "B"), campaign("A", ""), campaign("a", "b"),
      campaign("C", "D"), campaign("A", "X", { status: "PAUSED" }),
      campaign("C", "X", { valid_to: "2001-01-01" }),
    ];
  });
  assert.deepEqual(await listVoucherCodeFormats("store-a"), [
    { prefix: "A", suffixes: ["", "B"] },
    { prefix: "C", suffixes: ["D"] },
  ]);
});

const product = {
  goodsId: "TICKET-01",
  goodsName: "Vé vui chơi",
  price: 200000,
  quantity: 1,
};

test("normalizes voucher codes before lookup", () => {
  assert.equal(normalizeVoucherCode("  jp-abc123  "), "JP-ABC123");
  assert.equal(
    normalizeVoucherCode("AMTP-Voucher;123456;513245"),
    "AMTP-VOUCHER",
  );
  assert.throws(() => normalizeVoucherCode("bad code"));
});

test("applies free products before the whole-order percentage voucher", () => {
  const result = calculateVoucherDiscount(
    [
      { ...product, quantity: 2 },
      { goodsId: "GIFT-01", goodsName: "Quà", price: 50000, quantity: 1 },
    ],
    [
      {
        code: "FREE-001",
        campaignId: "campaign-free",
        campaignName: "Tặng vé",
        rewardType: "FREE_TICKET",
        rewardValue: 0,
        product,
      },
      {
        code: "PERCENT-001",
        campaignId: "campaign-percent",
        campaignName: "Giảm 20%",
        rewardType: "DISCOUNT_PERCENT",
        rewardValue: 20,
        product,
      },
    ],
  );

  assert.equal(result.subtotalAmount, 450000);
  assert.equal(result.discountAmount, 250000);
  assert.equal(result.totalAmount, 200000);
});

test("allows many free vouchers but rejects a second percentage voucher", () => {
  const free = (code) => ({
    code,
    campaignId: "campaign-free",
    campaignName: "Tặng vé",
    rewardType: "FREE_TICKET",
    rewardValue: 0,
    product,
  });
  assert.equal(
    calculateVoucherDiscount(
      [{ ...product, quantity: 2 }],
      [free("FREE-001"), free("FREE-002")],
    ).totalAmount,
    0,
  );

  const percent = (code) => ({
    ...free(code),
    rewardType: "DISCOUNT_PERCENT",
    rewardValue: 10,
  });
  assert.throws(() => calculateVoucherDiscount(
    [{ ...product, quantity: 2 }],
    [percent("PERCENT-001"), percent("PERCENT-002")],
  ));
});
