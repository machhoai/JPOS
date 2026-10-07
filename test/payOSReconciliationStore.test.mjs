import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { create } from "zustand";

function store() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../src/features/payments/store/usePayOSReconciliationStore.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", code)((name) => {
    assert.equal(name, "zustand");
    return { create };
  }, exports);
  return exports.usePayOSReconciliationStore;
}

test("viewed alerts remain counted until the provider confirms payment", () => {
  const state = store();
  state.getState().setPendingOrders("cashier:store", [
    { localOrderId: "pending-1", acknowledged: true },
    { localOrderId: "pending-2", acknowledged: false },
    { localOrderId: "pending-1", acknowledged: true },
  ]);
  assert.equal(state.getState().pendingCount, 2);
  state.getState().setPendingOrders("cashier:store", [{ localOrderId: "pending-2" }]);
  assert.equal(state.getState().pendingCount, 1);
  state.getState().setPendingOrders("cashier:store", []);
  assert.equal(state.getState().pendingCount, 0);
});

test("an old monitor cleanup cannot clear counts belonging to a new user or store", () => {
  const state = store();
  state.getState().setPendingOrders("cashier:store-1", [{ localOrderId: "old" }]);
  state.getState().setPendingOrders("manager:store-2", [{ localOrderId: "new-1" }, { localOrderId: "new-2" }]);
  state.getState().clearScope("cashier:store-1");
  assert.equal(state.getState().scopeKey, "manager:store-2");
  assert.equal(state.getState().pendingCount, 2);
  state.getState().clearScope("manager:store-2");
  assert.equal(state.getState().scopeKey, null);
  assert.equal(state.getState().pendingCount, 0);
});
