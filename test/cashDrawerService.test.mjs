import assert from "node:assert/strict";
import test from "node:test";
import { loadCashDrawerService as loadService } from "./helpers/cashDrawerHarness.mjs";

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

test("corrupt drawer cache and a failed toast never reject a completed payment", async () => {
  const { service, settings, calls, failNotice } = loadService();
  Object.defineProperty(settings, "cashDrawerEnabled", { get() { throw new Error("cache unavailable"); } });
  failNotice(new Error("toast unavailable"));
  await assert.doesNotReject(service.openCashDrawerAfterPayment("JPOS-1", "warehouse-a", "CASH"));
  assert.equal(calls.length, 0);
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
