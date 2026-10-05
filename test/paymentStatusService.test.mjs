import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("cached/offline PAID is ignored until Firestore confirms the server snapshot", () => {
  const exports = {};
  let onSnapshot;
  let onError;
  let stops = 0;
  const source = ts.transpileModule(readFileSync(new URL("../src/lib/services/paymentStatusService.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", source)((name) => {
    if (name === "firebase/firestore") return {
      doc: () => ({}),
      onSnapshot: (_doc, _options, success, error) => { onSnapshot = success; onError = error; return () => { stops++; }; },
    };
    if (name === "firebase/functions") return {};
    if (name.endsWith("firebase/client")) return {};
    if (name.endsWith("firebase/collections")) return { POS_CLIENT_COLLECTIONS: { paymentStatus: "pos_payment_status" } };
    if (name.endsWith("deviceEnrollmentService")) return {};
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  const statuses = [];
  const health = [];
  const stop = exports.watchPaymentStatus("test", (status) => statuses.push(status), (healthy) => health.push(healthy));
  const snapshot = { exists: () => true, data: () => ({ orderStatus: "LOCAL_PAID" }), metadata: { fromCache: true, hasPendingWrites: false } };
  onSnapshot(snapshot);
  assert.equal(statuses.length, 0);
  assert.equal(health.at(-1), false);
  onSnapshot({ ...snapshot, metadata: { fromCache: false, hasPendingWrites: true } });
  assert.equal(statuses.length, 0);
  onSnapshot({ ...snapshot, metadata: { fromCache: false, hasPendingWrites: false } });
  assert.equal(statuses.length, 1);
  assert.equal(health.at(-1), true);
  onError({ code: "permission-denied" });
  assert.equal(health.at(-1), false);
  stop();
  assert.equal(stops, 1);
});
