import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(relativePath, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("require", "exports", code)((name) => name in dependencies ? dependencies[name] : require(name), exports);
  return exports;
}

test("own-day order filters disable date and employee selection while full access leaves them enabled", () => {
  const { default: OrderFilters, DEFAULT_FILTERS } = load("../src/components/orders/OrderFilters.tsx", {
    "@/components/ui/DateInput": { __esModule: true, default: (props) => React.createElement("input", { "data-date": true, disabled: props.disabled }) },
  });
  const props = { filters: DEFAULT_FILTERS, selectedDate: "2026-10-29", maxDate: "2026-10-29", warehouseName: "Store", employees: [], onChange() {}, onDateChange() {} };
  const own = renderToStaticMarkup(React.createElement(OrderFilters, { ...props, ownTodayOnly: true }));
  const all = renderToStaticMarkup(React.createElement(OrderFilters, { ...props, ownTodayOnly: false }));
  assert.match(own, /data-date="true" disabled/);
  assert.match(own, /select disabled=""/);
  assert.match(own, /Chỉ tài khoản của tôi/);
  assert.doesNotMatch(all, /disabled/);
  assert.match(all, /Tất cả nhân viên/);
});

test("closeout print control remains disabled without the required print scope", () => {
  const { default: PrintButton } = load("../src/features/shift-close/components/CloseoutPrintButton.tsx", {
    "@/features/receipt/config/receiptConfig": { RECEIPT_PAPER_PROFILES: {} },
    "@/features/receipt/store/useReceiptSettingsStore": { useReceiptSettingsStore: (select) => select({ settings: {} }) },
    "@/features/shift-close/components/CloseoutReceiptDocument": { __esModule: true, default: () => null },
    "@/lib/utils/toast": { showError() {} },
  });
  for (const allowed of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(PrintButton, { allowed, report: {}, meta: {}, refreshBeforePrint: async () => undefined }));
    assert.equal(html.includes('disabled=""'), !allowed);
  }
});

test("own-day receipt dates retain the Vietnam calendar day on machines in another timezone", () => {
  const { default: Receipt } = load("../src/features/shift-close/components/CloseoutReceiptDocument.tsx", {
    "@/lib/utils/dateFormat": load("../src/lib/utils/dateFormat.ts"),
    "@/features/receipt/config/receiptConfig": { RECEIPT_PAPER_PROFILES: { K80: { paperWidthMm: 80, printableWidthMm: 72 } } },
  });
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const html = renderToStaticMarkup(React.createElement(Receipt, {
      settings: { paperSize: "K80" },
      meta: { timeZone: "Asia/Ho_Chi_Minh", periodMode: "DAY", startAt: "2026-10-28T17:00:00.000Z", endAt: "2026-10-29T17:00:00.000Z" },
      report: { products: [], payments: [], payosPendingOrders: [], operatorNames: [], productQuantity: 0, totalRevenue: 0, orderCount: 0, payosVerifiedAmount: 0, payosUnverifiedAmount: 0 },
    }));
    assert.match(html, /29\/10\/2026 00:00/);
    assert.match(html, /30\/10\/2026 00:00/);
    assert.doesNotMatch(html, /28\/10\/2026 17:00/);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("order cache isolates account/scope and ignores responses arriving after scope reset", async () => {
  let resolveRequest;
  const { useOrderHistoryStore: store, orderHistoryQueryKey } = load("../src/lib/stores/useOrderHistoryStore.ts", {
    "@/lib/services/orderService": { fetchOrderHistory: () => new Promise((resolve) => { resolveRequest = resolve; }) },
  });
  const query = { warehouseId: "store", startAt: "start", endAt: "end", accessKey: "manager:all" };
  assert.notEqual(orderHistoryQueryKey(query), orderHistoryQueryKey({ ...query, accessKey: "cashier:own" }));
  assert.notEqual(orderHistoryQueryKey(query), orderHistoryQueryKey({ ...query, accessKey: "manager:own" }));
  const first = store.getState().fetchOrders(query);
  resolveRequest({ orders: [{ localOrderId: "private" }], fetchedAt: "time" });
  await first;
  assert.equal(store.getState().orders.length, 1);
  const second = store.getState().fetchOrders({ ...query, accessKey: "cashier:own" });
  assert.deepEqual(store.getState().orders, []);
  store.getState().reset();
  resolveRequest({ orders: [{ localOrderId: "late" }], fetchedAt: "time" });
  await second;
  assert.deepEqual(store.getState().orders, []);
  assert.equal(store.getState().queryKey, null);
});
