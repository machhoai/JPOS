import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

async function listenerHarness({ bindFailure = false, applyFailure = false } = {}) {
  let effect, next;
  const applied = [];
  const deps = {
    react: { useEffect: (callback) => { effect = callback; } },
    "next/navigation": { usePathname: () => "/" },
    "firebase/firestore": { doc: (_db, collection, id) => ({ collection, id }), onSnapshot: (_doc, callback) => { next = callback; return () => {}; } },
    "@/lib/contexts/AuthContext": { useAuth: () => ({ user: {}, effectiveWarehouseId: "w1" }) },
    "@/lib/firebase/client": { db: {} },
    "@/lib/services/deviceEnrollmentService": { loadDeviceCredential: async () => ({ device_id: "d1", warehouse_id: "w1" }) },
    "@/lib/utils/remoteSettingsPolling": { isRemoteSettingsOwnerPathname: () => true },
    "@/features/printer/store/usePrinterSettingsStore": { usePrinterSettingsStore: { getState: () => ({
      bindCashDrawerDevice: () => { if (bindFailure) throw new Error("cache write failed"); },
      applyRemoteCashDrawerSettings: (value) => { if (applyFailure) throw new Error("cache write failed"); applied.push(value); },
    }) } },
  };
  const js = ts.transpileModule(readFileSync(new URL("../src/features/printer/components/CashDrawerSettingsSync.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", "console", js)((name) => { assert.ok(deps[name], `Unexpected drawer dependency ${name}`); return deps[name]; }, exports, { error() {} });
  assert.equal(exports.default(), null);
  const dispose = effect();
  await Promise.resolve(); await Promise.resolve();
  return { next, applied, dispose };
}

test("drawer cache quota failure stays inside its listener, never escapes to shared auth/payment handlers", async () => {
  const initialized = await listenerHarness({ bindFailure: true });
  assert.equal(initialized.next, undefined);
  initialized.dispose();
  const listener = await listenerHarness({ applyFailure: true });
  assert.doesNotThrow(() => listener.next({ metadata: { fromCache: false }, exists: () => true, data: () => ({ version: 1 }) }));
  listener.dispose();
});

test("offline empty snapshot does not discard the existing remote drawer cache", async () => {
  const listener = await listenerHarness();
  listener.next({ metadata: { fromCache: true }, exists: () => false });
  assert.equal(listener.applied.length, 0);
  listener.dispose();
});
