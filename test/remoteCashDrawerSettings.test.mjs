import assert from "node:assert/strict";
import test from "node:test";
import { parseRemoteCashDrawerSettings, getEffectiveCashDrawerConfig } from "../src/features/printer/helpers/remoteCashDrawerSettings.ts";

const remote = { id: "d1", device_id: "d1", warehouse_id: "w1", version: 3, auto_open_enabled: false, protocol: "TSPL", pin: 2, is_deleted: false };
const local = { cashDrawerEnabled: true, cashDrawerProtocol: "ESCPOS", cashDrawerPin: 5, remoteCashDrawerSettings: null, cashDrawerDeviceScope: { deviceId: "d1", warehouseId: "w1" } };

test("remote per-device settings override local settings and remain usable from a persisted cache", () => {
  const cached = JSON.parse(JSON.stringify(remote));
  assert.deepEqual(getEffectiveCashDrawerConfig({ ...local, remoteCashDrawerSettings: cached }), { enabled: false, protocol: "TSPL", pin: 2, managed: true, version: 3 });
  assert.equal(getEffectiveCashDrawerConfig(local).enabled, true);
});

test("cash drawer cache never matches another device or transferred warehouse", () => {
  assert.equal(parseRemoteCashDrawerSettings(remote, "d2", "w1"), null);
  assert.equal(parseRemoteCashDrawerSettings(remote, "d1", "w2"), null);
  assert.equal(getEffectiveCashDrawerConfig({ ...local, cashDrawerDeviceScope: { deviceId: "d2", warehouseId: "w1" }, remoteCashDrawerSettings: remote }).managed, false);
});

test("invalid remote configuration and soft-deleted documents are rejected", () => {
  for (const patch of [{ protocol: "TSPL", pin: 5 }, { protocol: "RAW" }, { auto_open_enabled: "true" }, { version: 0 }, { is_deleted: true }]) {
    assert.equal(parseRemoteCashDrawerSettings({ ...remote, ...patch }, "d1", "w1"), null);
  }
});
