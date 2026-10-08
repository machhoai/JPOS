import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getEffectiveCashDrawerConfig } from "../src/features/printer/helpers/remoteCashDrawerSettings.ts";

function loadService() {
  const settings = { cashDrawerEnabled: true, selectedPrinterName: "XP-80C", cashDrawerPin: 2, cashDrawerProtocol: "ESCPOS" };
  const calls = [];
  const warnings = [];
  let failure;
  let desktop = true;
  const dependencies = {
    "@/features/printer/helpers/remoteCashDrawerSettings": { getEffectiveCashDrawerConfig },
    "@/features/printer/store/usePrinterSettingsStore": { usePrinterSettingsStore: { getState: () => settings } },
    "@/lib/utils/toast": { showWarning: (...args) => warnings.push(args) },
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: async (...args) => {
        calls.push(args);
        if (failure) throw failure;
        return { printerName: settings.selectedPrinterName, alreadyAttempted: false };
      },
    },
  };
  const source = fs.readFileSync(new URL("../src/features/printer/services/cashDrawerService.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: (name) => {
    assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, console: { error() {} }, Error });
  return { service: exports, settings, calls, warnings,
    fail: (error) => { failure = error; }, browser: () => { desktop = false; } };
}

test("cash payment dispatches to the selected drawer printer and pin", async () => {
  const { service, settings, calls } = loadService();
  settings.cashDrawerPin = 5;
  await service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", "CASH");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "open_cash_drawer");
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify({ printerName: "XP-80C", pin: 5, protocol: "ESCPOS", warehouseId: "warehouse-a", orderId: "JPOS-1" }));
});

test("TSPL selection is used for both manual and automatic cash dispatch", async () => {
  const { service, settings, calls } = loadService();
  settings.cashDrawerProtocol = "TSPL";
  settings.selectedPrinterName = "4BARCODE 3B-365B";
  await service.openCashDrawer("warehouse-a");
  await service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", "CASH");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].protocol, "TSPL");
  assert.equal(calls[1][1].protocol, "TSPL");
});

test("central device settings override local protocol and auto-open switch", async () => {
  const { service, settings, calls } = loadService();
  settings.cashDrawerDeviceScope = { deviceId: "d1", warehouseId: "warehouse-a" };
  settings.remoteCashDrawerSettings = { device_id: "d1", warehouse_id: "warehouse-a", version: 2, auto_open_enabled: false, protocol: "TSPL", pin: 2, is_deleted: false };
  await service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", "CASH");
  assert.equal(calls.length, 0);
  settings.remoteCashDrawerSettings.auto_open_enabled = true;
  await service.openCashDrawerAfterPayment("JPOS-2", "warehouse-a", "CASH");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].protocol, "TSPL");
  assert.equal(calls[0][1].pin, 2);
});

test("disabled drawer and all non-cash payments do not dispatch", async () => {
  const { service, settings, calls } = loadService();
  for (const method of ["QR_CODE", "BANK_TRANSFER", "", "CARD"]) {
    await service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", method);
  }
  settings.cashDrawerEnabled = false;
  await service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", "CASH");
  assert.equal(calls.length, 0);
});

test("drawer failure warns without rejecting successful payment", async () => {
  const { service, calls, warnings, fail } = loadService();
  fail("Máy in điều khiển két chưa sẵn sàng.");
  await assert.doesNotReject(service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", "CASH"));
  assert.equal(calls.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1], "Máy in điều khiển két chưa sẵn sàng.");
});

test("manual open is independent of auto-open and carries no order claim", async () => {
  const { service, settings, calls } = loadService();
  settings.cashDrawerEnabled = false;
  await service.openCashDrawer("warehouse-a");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].orderId, null);
});

test("missing printer never falls back and browser rejects manual open", async () => {
  const { service, settings, calls, browser } = loadService();
  settings.selectedPrinterName = null;
  await assert.rejects(service.openCashDrawer("warehouse-a"), /Chưa chọn máy in/);
  assert.equal(calls.length, 0);
  settings.selectedPrinterName = "XP-80C";
  browser();
  await assert.rejects(service.openCashDrawer("warehouse-a"), /desktop/);
  assert.equal(calls.length, 0);
});

test("switching the receipt printer switches drawer routing and ignores legacy drawer selection", async () => {
  const { service, settings, calls } = loadService();
  settings.cashDrawerPrinterName = "Old drawer printer";
  await service.openCashDrawer("warehouse-a");
  settings.selectedPrinterName = "BT-T080";
  await service.openCashDrawer("warehouse-a");
  assert.equal(calls[0][1].printerName, "XP-80C");
  assert.equal(calls[1][1].printerName, "BT-T080");
});
