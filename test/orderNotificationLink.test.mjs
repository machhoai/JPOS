import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(relative, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", code)((name) => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const dates = load("../src/lib/utils/orderHistoryDate.ts");
const { buildOrderNotificationHref, readOrderNotificationTarget } = load("../src/features/payments/helpers/orderNotificationLink.ts", {
  "@/lib/utils/orderHistoryDate": dates,
});
const order = { localOrderId: "ORD-1791270000000-ABC123", createdAt: "2026-10-06T16:59:59.000Z", paidAt: "2026-10-06T17:01:00.000Z" };

test("notification opens the creation day in Vietnam even when completion crosses midnight", () => {
  const url = new URL(buildOrderNotificationHref(order, 42), "https://example.test");
  assert.equal(url.pathname, "/orders");
  const target = readOrderNotificationTarget(url.searchParams);
  assert.equal(target.orderId, order.localOrderId);
  assert.equal(target.date, "2026-10-06");
});
test("clicking a notification for the same order again produces another focus request", () => {
  const first = readOrderNotificationTarget(new URL(buildOrderNotificationHref(order, 1), "https://example.test").searchParams);
  const second = readOrderNotificationTarget(new URL(buildOrderNotificationHref(order, 2), "https://example.test").searchParams);
  assert.notEqual(first.key, second.key);
});
test("malformed notification links cannot focus arbitrary elements or invalid dates", () => {
  for (const query of ["", "orderId=javascript:alert(1)&date=2026-10-06", `orderId=${order.localOrderId}&date=2026-02-30`, `orderId=${order.localOrderId}`]) {
    assert.equal(readOrderNotificationTarget(new URLSearchParams(query)), null);
  }
  assert.throws(() => buildOrderNotificationHref({ ...order, localOrderId: "../other" }));
});
test("action warning uses the system warning toast, exposes its action and can dismiss by ID", () => {
  let options;
  let clicked = false;
  let dismissed;
  const { showWarningAction, dismissToast } = load("../src/lib/utils/toast.ts", {
    "goey-toast": { gooeyToast: { warning: (_title, value) => { options = value; return "toast-1"; }, dismiss: (id) => { dismissed = id; } } },
  });
  const id = showWarningAction("PayOS chưa xác nhận", "Đơn ABC123", { label: "Xem đơn", onClick: () => { clicked = true; } });
  assert.equal(options.action.label, "Xem đơn");
  options.action.onClick();
  assert.equal(clicked, true);
  assert.equal(options.preset, "snappy");
  dismissToast(id);
  assert.equal(dismissed, "toast-1");
});

test("PayOS monitor renders no separate UI and its toast action navigates to the exact order", async () => {
  const effects = [];
  const toasts = [];
  const navigations = [];
  const acknowledgements = [];
  const dismissed = [];
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/features/payments/components/PayOSReconciliationMonitor.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const router = { push: (...args) => navigations.push(args) };
  const dependencies = {
    "react": { useEffect: (effect) => effects.push(effect) },
    "react/jsx-runtime": { jsx: (component, props) => component(props) },
    "next/navigation": { usePathname: () => "/", useRouter: () => router },
    "@/lib/contexts/AuthContext": { useAuth: () => ({ user: { uid: "cashier" }, effectiveWarehouseId: "store", hasPermission: () => true }) },
    "@/lib/utils/formatCurrency": { formatCurrency: (amount) => `${amount} đ` },
    "@/lib/utils/toast": {
      showWarningAction: (...args) => { toasts.push(args); return "warning-1"; },
      dismissToast: (id) => dismissed.push(id), showError: () => {},
    },
    "@/lib/services/orderService": { fetchOrderForReceipt: async () => ({ ...order, warehouseId: "store" }) },
    "../api/payOSReconciliationApi": {
      listPendingPayOSOrders: async () => ({ orders: [{ localOrderId: order.localOrderId, totalAmount: 2000, alertedAt: "now", acknowledged: false }] }),
      acknowledgePayOSAlert: async (id) => { acknowledgements.push(id); },
    },
    "../helpers/orderNotificationLink": { buildOrderNotificationHref },
    "../store/usePayOSReconciliationStore": { usePayOSReconciliationStore: { getState: () => ({ setPendingOrders() {}, clearScope() {} }) } },
  };
  new Function("require", "exports", "window", "setTimeout", "clearTimeout", source)(
    (name) => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; },
    exports, { addEventListener() {}, removeEventListener() {} }, () => 1, () => {},
  );
  assert.equal(exports.default(), null);
  const cleanup = effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][2].label, "Xem đơn");
  toasts[0][2].onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const url = new URL(navigations[0][0], "https://example.test");
  assert.equal(url.pathname, "/orders");
  assert.equal(url.searchParams.get("orderId"), order.localOrderId);
  assert.equal(url.searchParams.get("date"), "2026-10-06");
  assert.deepEqual(navigations[0][1], { scroll: false });
  assert.deepEqual(acknowledgements, [order.localOrderId]);
  assert.ok(dismissed.includes("warning-1"));
  cleanup();
});
