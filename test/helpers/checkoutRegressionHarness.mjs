import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const quiet = { error() {}, info() {}, warn() {} };
export const orderId = "ORD-1791540000000-ABC123";

/** Execute the actual callback from source; payment logic is not recreated by the test. */
export function checkoutCallback(file, name, scope) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback && ts.isArrowFunction(callback), `Missing real callback: ${name}`);
  const js = ts.transpileModule(`exports.callback = ${callback.getText(source)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function(...Object.keys(scope), "console", "exports", js)(...Object.values(scope), quiet, exports);
  return exports.callback;
}

export function cartHarness() {
  const requests = [], journal = [];
  const control = { error: null };
  const services = {
    checkoutOrder: async (input) => {
      requests.push(input);
      if (control.error) throw control.error;
      return { localOrderId: input.localOrderId, status: "LOCAL_PAID", hkOrderNumber: null };
    },
    generateLocalOrderId: () => orderId,
    fetchOrderSyncStatus: async () => ({ status: "LOCAL_PAID", hkOrderNumber: null }),
    prepareOrder: async () => { throw new Error("Unexpected order preparation"); },
  };
  const journalService = {
    saveCheckoutJournal: async (record) => { journal.push(structuredClone(record)); return record; },
    clearCheckoutJournal: async () => {}, loadCheckoutJournal: async () => null, recordPendingFailure: async () => {},
  };
  const source = ts.transpileModule(readFileSync(new URL("../../src/lib/stores/useCartStore.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "console", source)((name) => {
    if (name === "zustand") return require(name);
    if (name.endsWith("orderService")) return services;
    if (name.endsWith("checkoutJournalService")) return journalService;
    throw new Error(`Unexpected cart import: ${name}`);
  }, exports, quiet);
  const store = exports.useCartStore;
  store.setState({ items: [{ goodsId: "g1", goodsName: "Test product", price: 3000, quantity: 2 }], draftOrderId: orderId,
    checkoutContext: { shopId: 20692, warehouseId: "warehouse-a" }, paymentMethod: "CASH" });
  return { store, requests, journal, control };
}
