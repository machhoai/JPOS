"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { parseRemoteCashDrawerSettings, type RemoteCashDrawerSettings } from "@/features/printer/helpers/remoteCashDrawerSettings";
import {
  DEFAULT_PRINT_TOP_MARGIN_MM,
  normalizePrintTopMarginMm,
} from "@/features/printer/config/printerConfig";

interface PrinterSettingsState {
  selectedPrinterName: string | null;
  topMarginMm: number;
  cashDrawerEnabled: boolean;
  cashDrawerPin: 2 | 5;
  cashDrawerProtocol: "ESCPOS" | "TSPL";
  remoteCashDrawerSettings: RemoteCashDrawerSettings | null;
  cashDrawerDeviceScope: { deviceId: string; warehouseId: string } | null;
  bindCashDrawerDevice: (deviceId: string, warehouseId: string) => void;
  applyRemoteCashDrawerSettings: (value: unknown, deviceId: string, warehouseId: string) => void;
  setCashDrawerEnabled: (enabled: boolean) => void;
  setCashDrawerPin: (pin: 2 | 5) => void;
  setCashDrawerProtocol: (protocol: "ESCPOS" | "TSPL") => void;
  selectPrinter: (printerName: string) => void;
  clearSelection: () => void;
  setTopMarginMm: (topMarginMm: number) => void;
}

export const usePrinterSettingsStore = create<PrinterSettingsState>()(
  persist(
    (set) => ({
      selectedPrinterName: null,
      topMarginMm: DEFAULT_PRINT_TOP_MARGIN_MM,
      cashDrawerEnabled: false,
      cashDrawerPin: 2,
      cashDrawerProtocol: "ESCPOS",
      remoteCashDrawerSettings: null,
      cashDrawerDeviceScope: null,
      bindCashDrawerDevice: (deviceId, warehouseId) => set((state) => ({
        cashDrawerDeviceScope: { deviceId, warehouseId },
        ...((state.cashDrawerDeviceScope && (state.cashDrawerDeviceScope.deviceId !== deviceId || state.cashDrawerDeviceScope.warehouseId !== warehouseId))
          || (state.remoteCashDrawerSettings && (state.remoteCashDrawerSettings.device_id !== deviceId || state.remoteCashDrawerSettings.warehouse_id !== warehouseId))
          ? { cashDrawerEnabled: false, remoteCashDrawerSettings: null } : {}),
      })),
      applyRemoteCashDrawerSettings: (value, deviceId, warehouseId) => set((state) => {
        const scope = state.cashDrawerDeviceScope;
        if (!scope || scope.deviceId !== deviceId || scope.warehouseId !== warehouseId) return {};
        const remote = parseRemoteCashDrawerSettings(value, deviceId, warehouseId);
        const current = parseRemoteCashDrawerSettings(state.remoteCashDrawerSettings, deviceId, warehouseId);
        if (value !== null && !remote && !(typeof value === "object" && value && "is_deleted" in value && value.is_deleted === true)) return {};
        if (remote && current && remote.version < current.version) return {};
        return { remoteCashDrawerSettings: remote, ...(!remote && current ? { cashDrawerEnabled: false } : {}) };
      }),
      setCashDrawerEnabled: (cashDrawerEnabled) => set({ cashDrawerEnabled }),
      setCashDrawerPin: (cashDrawerPin) => set({ cashDrawerPin }),
      setCashDrawerProtocol: (cashDrawerProtocol) => set((state) => ({
        cashDrawerProtocol,
        cashDrawerPin: cashDrawerProtocol === "TSPL" ? 2 : state.cashDrawerPin,
      })),
      selectPrinter: (selectedPrinterName) => set({ selectedPrinterName }),
      clearSelection: () => set({ selectedPrinterName: null }),
      setTopMarginMm: (topMarginMm) => set({
        topMarginMm: normalizePrintTopMarginMm(topMarginMm),
      }),
    }),
    {
      name: "pos_local_printer_settings_v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedPrinterName: state.selectedPrinterName,
        topMarginMm: state.topMarginMm,
        cashDrawerEnabled: state.cashDrawerEnabled,
        cashDrawerPin: state.cashDrawerPin,
        cashDrawerProtocol: state.cashDrawerProtocol,
        remoteCashDrawerSettings: state.remoteCashDrawerSettings,
      }),
      merge: (persistedState, currentState) => {
        const savedState = (persistedState ?? {}) as Partial<PrinterSettingsState>;
        return {
          ...currentState,
          ...savedState,
          topMarginMm: normalizePrintTopMarginMm(savedState.topMarginMm),
          cashDrawerEnabled: savedState.cashDrawerEnabled === true,
          cashDrawerPin: savedState.cashDrawerProtocol !== "TSPL" && savedState.cashDrawerPin === 5 ? 5 : 2,
          cashDrawerProtocol: savedState.cashDrawerProtocol === "TSPL" ? "TSPL" : "ESCPOS",
          cashDrawerDeviceScope: null,
          remoteCashDrawerSettings: savedState.remoteCashDrawerSettings
            ? parseRemoteCashDrawerSettings(savedState.remoteCashDrawerSettings, savedState.remoteCashDrawerSettings.device_id, savedState.remoteCashDrawerSettings.warehouse_id) : null,
        };
      },
    },
  ),
);
