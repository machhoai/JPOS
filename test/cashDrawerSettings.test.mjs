import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getEffectiveCashDrawerConfig } from "../src/features/printer/helpers/remoteCashDrawerSettings.ts";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function renderSettings(canOpen, printers = [], remoteSettings = null) {
  const state = {
    cashDrawerEnabled: false, selectedPrinterName: "XP-80C", cashDrawerPin: 2,
    setCashDrawerEnabled() {}, setCashDrawerPin() {},
    cashDrawerProtocol: "ESCPOS", setCashDrawerProtocol() {},
    remoteCashDrawerSettings: remoteSettings, cashDrawerDeviceScope: { deviceId: "d1", warehouseId: "w1" },
  };
  const dependencies = {
    "@/features/printer/helpers/remoteCashDrawerSettings": { getEffectiveCashDrawerConfig },
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "zustand/react/shallow": { useShallow: (selector) => selector },
    "@/lib/contexts/AuthContext": { useAuth: () => ({ user: {}, userDoc: {}, effectiveWarehouseId: "w1", hasPermission: () => canOpen }) },
    "@/lib/auth/permissions": { CASH_DRAWER_OPEN_PERMISSION: "pos.cash_drawer.open" },
    "@/features/printer/store/usePrinterSettingsStore": { usePrinterSettingsStore: (selector) => selector(state) },
    "@/features/printer/services/cashDrawerService": { openCashDrawer() { throw new Error("Rendering must not open drawer"); } },
    "@/lib/utils/toast": {},
  };
  const source = fs.readFileSync(new URL("../src/features/printer/components/CashDrawerSettings.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: (name) => {
    assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return renderToStaticMarkup(React.createElement(exports.default, { printers }));
}

test("unauthorized staff see disabled configuration and manual open", () => {
  const html = renderSettings(false, [{ name: "XP-80C", isAvailable: true, status: "READY" }]);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, /Cần quyền mở két tiền/);
});

test("authorized staff can test without enabling auto-open; missing printer disables test", () => {
  const html = renderSettings(true, [{ name: "XP-80C", isAvailable: true, status: "READY" }]);
  assert.doesNotMatch(html, /<fieldset disabled=""/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  const missing = renderSettings(true);
  assert.match(missing, /Máy in điều khiển két: XP-80C/);
  assert.equal((html.match(/<select/g) ?? []).length, 2);
  assert.match(html, /ESC\/POS/);
  assert.match(html, /TSPL/);
  assert.match(missing, /<button[^>]*disabled=""/);
});

test("centrally managed settings are read-only while authorized manual open remains available", () => {
  const html = renderSettings(true, [{ name: "XP-80C", isAvailable: true, status: "READY" }], {
    id: "d1", device_id: "d1", warehouse_id: "w1", version: 2, auto_open_enabled: true, protocol: "TSPL", pin: 2, is_deleted: false,
  });
  assert.match(html, /Cấu hình từ JPULSE/);
  assert.match(html, /<fieldset disabled=""/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""/);
});
