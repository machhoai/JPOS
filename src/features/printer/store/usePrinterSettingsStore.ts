"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
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
        };
      },
    },
  ),
);
