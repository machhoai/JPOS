"use client";

import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/lib/contexts/AuthContext";
import { CASH_DRAWER_OPEN_PERMISSION } from "@/lib/auth/permissions";
import { usePrinterSettingsStore } from "@/features/printer/store/usePrinterSettingsStore";
import { getEffectiveCashDrawerConfig } from "@/features/printer/helpers/remoteCashDrawerSettings";
import { describeCashDrawerError, openCashDrawer } from "@/features/printer/services/cashDrawerService";
import type { LocalPrinter } from "@/features/printer/types/printer";
import { showError, showSuccess } from "@/lib/utils/toast";

export default function CashDrawerSettings({ printers }: { printers: LocalPrinter[] }) {
  const auth = useAuth();
  const canOpen = Boolean(auth.user && auth.userDoc && auth.effectiveWarehouseId
    && auth.hasPermission(CASH_DRAWER_OPEN_PERMISSION, auth.effectiveWarehouseId));
  const settings = usePrinterSettingsStore(useShallow((s) => ({
    ...getEffectiveCashDrawerConfig(s), printerName: s.selectedPrinterName,
    setEnabled: s.setCashDrawerEnabled, setPin: s.setCashDrawerPin,
    setProtocol: s.setCashDrawerProtocol,
  })));
  const [isOpening, setIsOpening] = useState(false);
  const opening = useRef(false);
  const available = printers.find((p) => p.name === settings.printerName);
  const canDispatch = canOpen && available?.isAvailable
    && (available.status === "READY" || available.status === "BUSY");

  const handleOpen = async () => {
    if (!canOpen || !auth.effectiveWarehouseId || opening.current) return;
    opening.current = true;
    setIsOpening(true);
    try {
      const result = await openCashDrawer(auth.effectiveWarehouseId);
      showSuccess("Đã gửi lệnh mở két", `Kiểm tra két nối với “${result.printerName}” đã mở.`);
    } catch (error: unknown) {
      showError("Không thể mở két tiền", describeCashDrawerError(error));
    } finally {
      opening.current = false;
      setIsOpening(false);
    }
  };

  return (
    <section className="mt-6 border-t border-[var(--color-border)] pt-5">
      <h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">Két tiền</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
        Cấu hình riêng cho máy POS này. Két được điều khiển qua máy in đã chọn có cổng kết nối két tiền.
      </p>
      {settings.managed && <p className="mt-3 text-xs text-blue-700">Cấu hình từ JPULSE · v{settings.version}. Thay đổi tại Quản lý JPOS → Cấu hình → Két tiền cho máy này.</p>}
      <fieldset disabled={!canOpen || isOpening || settings.managed} className="mt-4 space-y-4 disabled:opacity-60">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => settings.setEnabled(e.target.checked)} className="size-4 accent-orange-600" />
          Tự mở két khi thanh toán tiền mặt thành công
        </label>
        <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5">
          <p className="font-bold">Máy in điều khiển két: {settings.printerName ?? "Chưa chọn máy in"}</p>
          <p className="text-[var(--color-text-muted)]">Dùng máy in đã chọn ở phía trên. Đổi máy in sẽ đổi máy điều khiển két.</p>
        </div>
        <label className="block text-xs font-bold">
          Loại lệnh mở két
          <select value={settings.protocol} onChange={(e) => settings.setProtocol(e.target.value === "TSPL" ? "TSPL" : "ESCPOS")} className="mt-2 h-11 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 text-sm">
            <option value="ESCPOS">ESC/POS · BT-T080, XP-80C và máy in bill</option>
            <option value="TSPL">TSPL · 365B ở chế độ in tem</option>
          </select>
        </label>
        <label className="block text-xs font-bold">
          Chân kích két
          <select value={settings.pin} onChange={(e) => settings.setPin(e.target.value === "5" ? 5 : 2)} className="mt-2 h-11 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 text-sm">
            <option value="2">Chân 2 (thông dụng)</option>
            <option value="5" disabled={settings.protocol === "TSPL"}>Chân 5 (ESC/POS)</option>
          </select>
        </label>
      </fieldset>
      {settings.protocol === "TSPL" && <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">TSPL dùng chân 2 cho máy in tem. Khóa két cần ở vị trí cho phép mở bằng điện.</p>}
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">
        In lại bill, in vé và thanh toán chuyển khoản không tự mở két. Nếu thử chưa mở, kiểm tra dây, khóa két và thử chân kích còn lại.
      </p>
      {!canOpen && <p className="mt-3 text-xs text-amber-700">Cần quyền mở két tiền tại điểm bán để thử hoặc mở thủ công.</p>}
      {!settings.printerName && <p role="status" className="mt-3 text-xs text-amber-700">Hãy chọn máy in ở phía trên để điều khiển két tiền.</p>}
      {settings.printerName && !canDispatch && canOpen && <p role="status" className="mt-3 text-xs text-amber-700">Máy in điều khiển két chưa sẵn sàng. Hãy kiểm tra máy in và làm mới danh sách.</p>}
      <button type="button" onClick={() => void handleOpen()} disabled={!canDispatch || isOpening} className="mt-4 min-h-11 w-full rounded-xl bg-[#202124] px-4 text-sm font-bold text-white disabled:opacity-50">
        {isOpening ? "Đang gửi lệnh..." : "Thử mở két / Mở thủ công"}
      </button>
    </section>
  );
}
