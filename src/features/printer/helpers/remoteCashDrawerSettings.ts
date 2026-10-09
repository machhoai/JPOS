export interface RemoteCashDrawerSettings {
  id: string;
  device_id: string;
  warehouse_id: string;
  version: number;
  auto_open_enabled: boolean;
  protocol: "ESCPOS" | "TSPL";
  pin: 2 | 5;
  is_deleted: boolean;
}

export function parseRemoteCashDrawerSettings(value: unknown, deviceId: string, warehouseId: string): RemoteCashDrawerSettings | null {
  if (typeof deviceId !== "string" || !deviceId || typeof warehouseId !== "string" || !warehouseId) return null;
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<RemoteCashDrawerSettings>;
  if (s.device_id !== deviceId || s.warehouse_id !== warehouseId || s.is_deleted !== false
    || !Number.isInteger(s.version) || (s.version ?? 0) < 1
    || typeof s.auto_open_enabled !== "boolean"
    || (s.protocol !== "ESCPOS" && s.protocol !== "TSPL")
    || (s.pin !== 2 && s.pin !== 5) || (s.protocol === "TSPL" && s.pin !== 2)) return null;
  return { id: deviceId, device_id: deviceId, warehouse_id: warehouseId, version: s.version!,
    auto_open_enabled: s.auto_open_enabled, protocol: s.protocol, pin: s.pin, is_deleted: false };
}

interface CashDrawerConfigState {
  cashDrawerEnabled: boolean; cashDrawerProtocol: "ESCPOS" | "TSPL"; cashDrawerPin: 2 | 5;
  remoteCashDrawerSettings: RemoteCashDrawerSettings | null;
  cashDrawerDeviceScope: { deviceId: string; warehouseId: string } | null;
}

export function getEffectiveCashDrawerConfig(state: CashDrawerConfigState) {
  const scope = state.cashDrawerDeviceScope;
  const remote = scope && state.remoteCashDrawerSettings
    ? parseRemoteCashDrawerSettings(state.remoteCashDrawerSettings, scope.deviceId, scope.warehouseId) : null;
  return {
    enabled: remote?.auto_open_enabled ?? (state.remoteCashDrawerSettings ? false : state.cashDrawerEnabled),
    protocol: remote?.protocol ?? state.cashDrawerProtocol,
    pin: remote?.pin ?? state.cashDrawerPin,
    managed: Boolean(remote), version: remote?.version ?? null,
  };
}
