import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(relativePath, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", code)((name) => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const policy = load("../src/features/payments/helpers/payOSReconciliation.ts");
const lifecycle = load("../src/lib/utils/orderLifecycle.ts");
const { buildCloseoutReport } = load("../src/features/shift-close/helpers/buildCloseoutReport.ts", {
  "@/lib/utils/orderLifecycle": lifecycle,
  "@/features/payments/helpers/payOSReconciliation": policy,
});
const base = {
  localOrderId: "order", status: "SYNC_SUCCESS", paymentMethod: "QR_CODE", paymentMethodId: "QR_CODE",
  totalAmount: 2000, paymentVerificationStatus: "UNVERIFIED", operatorName: "Nhân viên", items: [],
  paymentDetails: { provider: "payos", attempts: [{ status: "PENDING", paymentLinkId: "link" }] },
};
test("closeout separates confirmed and pending PayOS while leaving revenue intact", () => {
  const report = buildCloseoutReport([
    base,
    { ...base, localOrderId: "verified", paymentVerificationStatus: "VERIFIED", totalAmount: 3000 },
    { ...base, localOrderId: "fixed", fixedTransferDetails: { status: "MANUALLY_CONFIRMED" }, totalAmount: 4000 },
    { ...base, localOrderId: "cash", paymentMethod: "CASH", paymentMethodId: "CASH", totalAmount: 5000 },
    { ...base, localOrderId: "draft", status: "DRAFT" },
    { ...base, localOrderId: "refunded", paymentStatus: "REFUNDED" },
    { ...base, localOrderId: "cancelled", syncStatus: "CANCELLED" },
  ]);
  assert.equal(report.totalRevenue, 14000);
  assert.equal(report.orderCount, 4);
  assert.equal(report.payosVerifiedAmount, 3000);
  assert.equal(report.payosUnverifiedAmount, 2000);
  assert.deepEqual(report.payosPendingOrders.map((order) => order.localOrderId), ["order"]);
});
test("pending alert rules match backend for every excluded payment/lifecycle", () => {
  const backend = load("../functions/src/payment/payosReconciliationPolicy.ts");
  for (const overrides of [
    {}, { status: "DRAFT" }, { paymentMethod: "CASH" }, { paymentDetails: undefined },
    { fixedTransferDetails: { status: "MANUALLY_CONFIRMED" } },
    { paymentVerificationStatus: "VERIFIED" }, { paymentStatus: "REFUNDED" },
    { paymentStatus: "REFUNDING" }, { syncStatus: "CANCELLED" },
  ]) assert.equal(policy.needsPayOSReconciliation({ ...base, ...overrides }), backend.needsPayOSReconciliation({ ...base, ...overrides }));
});
test("an unverified order in refund processing is neither a PayOS warning nor confirmed money", () => {
  const report = buildCloseoutReport([{ ...base, paymentStatus: "REFUNDING" }]);
  assert.equal(report.payosPendingOrders.length, 0);
  assert.equal(report.payosVerifiedAmount, 0);
});
