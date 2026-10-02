"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Laptop,
  Printer,
  RefreshCw,
  Ruler,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import SettingsTabs from "@/components/settings/SettingsTabs";
import CashDrawerSettings from "@/features/printer/components/CashDrawerSettings";
import {
  MAX_PRINT_TOP_MARGIN_MM,
  MIN_PRINT_TOP_MARGIN_MM,
  PRINT_TOP_MARGIN_STEP_MM,
} from "@/features/printer/config/printerConfig";
import {
  listLocalPrinters,
  printTopMarginCalibration,
} from "@/features/printer/services/printerService";
import { usePrinterSettingsStore } from "@/features/printer/store/usePrinterSettingsStore";
import type {
  LocalPrinter,
  PrinterStatus,
} from "@/features/printer/types/printer";
import { useAuth } from "@/lib/contexts/AuthContext";
import { showError, showSuccess } from "@/lib/utils/toast";

const STATUS_LABELS: Record<PrinterStatus, string> = {
  READY: "Sẵn sàng",
  BUSY: "Đang xử lý",
  PAUSED: "Đang tạm dừng",
  OFFLINE: "Mất kết nối",
  ERROR: "Cần kiểm tra",
};

function describePrinterLoadError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Không thể đọc danh sách máy in trên thiết bị này.";
}

const PrinterSettingsPage: React.FC = () => {
  const router = useRouter();
  const { user, userDoc, isLoading: authLoading, logout } = useAuth();
  const selectedPrinterName = usePrinterSettingsStore(
    (state) => state.selectedPrinterName,
  );
  const selectPrinter = usePrinterSettingsStore((state) => state.selectPrinter);
  const topMarginMm = usePrinterSettingsStore((state) => state.topMarginMm);
  const setTopMarginMm = usePrinterSettingsStore((state) => state.setTopMarginMm);
  const [printers, setPrinters] = useState<LocalPrinter[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [isPrintingCalibration, setIsPrintingCalibration] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !userDoc)) router.replace("/login");
  }, [authLoading, router, user, userDoc]);

  const refreshPrinters = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      setPrinters(await listLocalPrinters());
    } catch (error: unknown) {
      setPrinters([]);
      setLoadError(describePrinterLoadError(error));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;
    void listLocalPrinters()
      .then((availablePrinters) => {
        if (!isActive) return;
        setPrinters(availablePrinters);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setPrinters([]);
        setLoadError(describePrinterLoadError(error));
      })
      .finally(() => {
        if (isActive) setIsRefreshing(false);
      });
    return () => {
      isActive = false;
    };
  }, []);

  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.name === selectedPrinterName) ?? null,
    [printers, selectedPrinterName],
  );
  const selectedPrinterIsMissing = Boolean(
    selectedPrinterName && !selectedPrinter,
  );

  const handleSelectPrinter = useCallback(
    (printer: LocalPrinter) => {
      if (!printer.isAvailable) return;
      selectPrinter(printer.name);
      showSuccess(
        "Đã chọn máy in",
        `Bill và vé trên máy POS này sẽ được gửi tới “${printer.name}”.`,
      );
    },
    [selectPrinter],
  );

  const handleTopMarginChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setTopMarginMm(event.currentTarget.valueAsNumber);
    },
    [setTopMarginMm],
  );

  const handlePrintCalibration = useCallback(async () => {
    setIsPrintingCalibration(true);
    try {
      const dispatch = await printTopMarginCalibration();
      showSuccess(
        "Đã in mẫu kiểm tra lề",
        `Hãy đo từ mép cắt đến vạch đen đầu tiên trên bản in từ “${dispatch.effectivePrinterName}”.`,
      );
    } catch (error: unknown) {
      showError(
        "Không thể in mẫu kiểm tra",
        error instanceof Error
          ? error.message
          : "Vui lòng kiểm tra máy in và thử lại.",
      );
    } finally {
      setIsPrintingCalibration(false);
    }
  }, []);

  const isAuthenticated = !authLoading && Boolean(user && userDoc);

  return (
    <div className="flex h-screen bg-[var(--color-background)]">
      {isAuthenticated ? (
        <>
          <Sidebar onLogout={logout} />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-5 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-[var(--color-accent)]">
                  <Printer className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-lg font-extrabold tracking-tight text-[var(--color-text-primary)]">
                    Cấu hình máy in
                  </h1>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Lưu riêng trên thiết bị này · áp dụng cho mọi tài khoản
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refreshPrinters()}
                disabled={isRefreshing}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-white px-4 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {isRefreshing ? "Đang dò máy in..." : "Làm mới danh sách"}
              </button>
            </header>

            <SettingsTabs />

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">
                      Máy in có thể sử dụng
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      Chọn một máy in cố định cho bill và vé. Lựa chọn được lưu ngay, không đồng bộ lên JPULSE.
                    </p>
                  </div>

                  {loadError && (
                    <div className="flex gap-3 rounded-2xl bg-red-50 p-4 text-sm leading-6 text-red-700">
                      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                      <span>{loadError}</span>
                    </div>
                  )}

                  {!loadError && !isRefreshing && printers.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-slate-50 p-8 text-center">
                      <Printer className="mx-auto size-8 text-[var(--color-text-muted)]" aria-hidden="true" />
                      <p className="mt-3 text-sm font-bold text-[var(--color-text-primary)]">
                        Chưa tìm thấy máy in
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        Hãy kết nối máy in, cài driver Windows rồi làm mới danh sách.
                      </p>
                    </div>
                  )}

                  <div className="grid gap-2">
                    {printers.map((printer) => {
                      const isSelected = printer.name === selectedPrinterName;
                      return (
                        <button
                          key={printer.name}
                          type="button"
                          onClick={() => handleSelectPrinter(printer)}
                          disabled={!printer.isAvailable}
                          aria-pressed={isSelected}
                          className={`flex min-h-[76px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all disabled:cursor-not-allowed ${
                            isSelected
                              ? "border-[var(--color-accent)] bg-orange-50 shadow-[0_0_0_1px_var(--color-accent)]"
                              : printer.isAvailable
                                ? "border-[var(--color-border)] bg-white hover:border-orange-200 hover:bg-orange-50/30"
                                : "border-[var(--color-border)] bg-slate-50 opacity-65"
                          }`}
                        >
                          {isSelected ? (
                            <CheckCircle2 className="size-5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                          ) : (
                            <Circle className="size-5 shrink-0 text-slate-300" aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-extrabold text-[var(--color-text-primary)]">
                              {printer.name}
                            </span>
                            <span className={`mt-1 block text-[11px] font-semibold ${printer.isAvailable ? "text-emerald-700" : "text-red-600"}`}>
                              {STATUS_LABELS[printer.status]}
                            </span>
                          </span>
                          {printer.isDefault && (
                            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-[var(--color-text-secondary)]">
                              Mặc định Windows
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-6 border-t border-[var(--color-border)] pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[var(--color-text-secondary)]">
                          <Ruler className="size-4" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">
                            Lề đầu giấy
                          </h2>
                          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                            Áp dụng cho cả bill và vé trên máy POS này.
                          </p>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-secondary)]">
                        <span className="sr-only">Lề đầu giấy tính bằng milimét</span>
                        <input
                          type="number"
                          min={MIN_PRINT_TOP_MARGIN_MM}
                          max={MAX_PRINT_TOP_MARGIN_MM}
                          step={PRINT_TOP_MARGIN_STEP_MM}
                          value={topMarginMm}
                          onChange={handleTopMarginChange}
                          className="h-10 w-20 rounded-xl border border-[var(--color-border)] bg-white px-3 text-right text-sm font-extrabold text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-orange-100"
                        />
                        mm
                      </label>
                    </div>

                    <input
                      type="range"
                      min={MIN_PRINT_TOP_MARGIN_MM}
                      max={MAX_PRINT_TOP_MARGIN_MM}
                      step={PRINT_TOP_MARGIN_STEP_MM}
                      value={topMarginMm}
                      onChange={handleTopMarginChange}
                      aria-label="Điều chỉnh lề đầu giấy"
                      className="mt-4 w-full accent-[var(--color-accent)]"
                    />
                    <div className="mt-1 flex justify-between text-[10px] font-semibold text-[var(--color-text-muted)]">
                      <span>{MIN_PRINT_TOP_MARGIN_MM} mm</span>
                      <span>{MAX_PRINT_TOP_MARGIN_MM} mm</span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {[0, 1, 2, 4].map((marginMm) => (
                        <button
                          key={marginMm}
                          type="button"
                          onClick={() => setTopMarginMm(marginMm)}
                          aria-pressed={topMarginMm === marginMm}
                          className={`min-h-9 rounded-xl border px-3 text-xs font-bold transition-colors ${
                            topMarginMm === marginMm
                              ? "border-[var(--color-accent)] bg-orange-50 text-orange-700"
                              : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-slate-50"
                          }`}
                        >
                          {marginMm} mm
                        </button>
                      ))}
                    </div>

                    <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                      Khuyến nghị 1 mm. Nếu chọn 0 mm, máy vẫn có thể để lại một đoạn trắng nhỏ do khoảng cách vật lý giữa đầu in và dao cắt.
                    </p>

                    <button
                      type="button"
                      onClick={() => void handlePrintCalibration()}
                      disabled={!selectedPrinter?.isAvailable || isPrintingCalibration}
                      className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#202124] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Printer
                        className={`size-4 ${isPrintingCalibration ? "animate-pulse" : ""}`}
                        aria-hidden="true"
                      />
                      {isPrintingCalibration ? "Đang in kiểm tra..." : "In kiểm tra lề"}
                    </button>
                    <p className="mt-2 text-center text-[11px] leading-5 text-[var(--color-text-muted)]">
                      Mẫu đặt một vạch đen tại đúng 0 mm. Khoảng từ mép cắt đến vạch đen là phần do driver hoặc cơ cấu máy in tạo ra.
                    </p>
                  </div>
                  <CashDrawerSettings printers={printers} />
                </section>

                <aside className="space-y-4">
                  <section className="rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
                      <Laptop className="size-4" aria-hidden="true" />
                      <h2 className="text-sm font-extrabold">Đang sử dụng</h2>
                    </div>
                    {selectedPrinterName ? (
                      <div className="mt-4">
                        <p className="break-words text-base font-black text-[var(--color-text-primary)]">
                          {selectedPrinterName}
                        </p>
                        <p className={`mt-2 text-xs font-bold ${selectedPrinter?.isAvailable ? "text-emerald-700" : "text-red-600"}`}>
                          {selectedPrinter?.isAvailable
                            ? "Đã kết nối"
                            : "Không tìm thấy hoặc đã mất kết nối"}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm leading-6 text-amber-700">
                        Chưa chọn máy in. JPOS tạm dùng máy in mặc định của Windows.
                      </p>
                    )}
                  </section>

                  <section className={`rounded-3xl p-5 ${selectedPrinterIsMissing || selectedPrinter?.isAvailable === false ? "bg-amber-50 text-amber-900" : "bg-blue-50 text-blue-900"}`}>
                    <div className="flex gap-3">
                      {selectedPrinterIsMissing || selectedPrinter?.isAvailable === false ? (
                        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                      )}
                      <div>
                        <h2 className="text-sm font-extrabold">Quy tắc khi in</h2>
                        <p className="mt-1 text-xs leading-5">
                          JPOS luôn gửi bill và vé tới máy đã chọn. Chỉ khi máy này mất kết nối, hệ thống mới chuyển sang máy in mặc định của Windows và hiện cảnh báo tên máy nhận lệnh.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-[var(--color-border)] bg-white p-5 text-xs leading-5 text-[var(--color-text-muted)] shadow-sm">
                    <p className="font-bold text-[var(--color-text-secondary)]">Cấu hình local</p>
                    <p className="mt-1">
                      Mọi nhân viên dùng máy POS này đều có thể thay đổi máy in và lề đầu giấy. Cấu hình không ảnh hưởng các máy POS khác.
                    </p>
                  </section>
                </aside>
              </div>
            </div>
          </main>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="size-10 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
            <p className="text-sm text-[var(--color-text-muted)]">Đang mở cấu hình máy in...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrinterSettingsPage;
