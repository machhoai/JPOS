import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getEffectiveCashDrawerConfig } from "../../src/features/printer/helpers/remoteCashDrawerSettings.ts";

export function loadCashDrawerService() {
  const settings = { cashDrawerEnabled: true, selectedPrinterName: "XP-80C", cashDrawerPin: 2, cashDrawerProtocol: "ESCPOS" };
  const calls = [], warnings = [];
  let failure, pending, warningFailure;
  let desktop = true;
  const dependencies = {
    "@/features/printer/helpers/remoteCashDrawerSettings": { getEffectiveCashDrawerConfig },
    "@/features/printer/store/usePrinterSettingsStore": { usePrinterSettingsStore: { getState: () => settings } },
    "@/lib/utils/toast": { showWarning: (...args) => { if (warningFailure) throw warningFailure; warnings.push(args); } },
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: async (...args) => {
        calls.push(args);
        if (failure) throw failure;
        if (pending) await pending;
        return { printerName: settings.selectedPrinterName, alreadyAttempted: false };
      },
    },
  };
  const source = fs.readFileSync(new URL("../../src/features/printer/services/cashDrawerService.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: (name) => { assert.ok(dependencies[name], `Unexpected dependency: ${name}`); return dependencies[name]; }, console: { error() {} }, Error });
  return { service: exports, settings, calls, warnings,
    fail: (error) => { failure = error; }, browser: () => { desktop = false; },
    waitFor: (promise) => { pending = promise; }, failNotice: (error) => { warningFailure = error; },
  };
}
