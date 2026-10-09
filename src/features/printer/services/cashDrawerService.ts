import { usePrinterSettingsStore } from "@/features/printer/store/usePrinterSettingsStore";
import { getEffectiveCashDrawerConfig } from "@/features/printer/helpers/remoteCashDrawerSettings";
import { showWarning } from "@/lib/utils/toast";

interface DrawerDispatch {
  printerName: string;
  alreadyAttempted: boolean;
}

export function describeCashDrawerError(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Vui lòng kiểm tra máy in, dây kết nối và khóa két tiền.";
}

export async function openCashDrawer(
  warehouseId: string,
  orderId: string | null = null,
): Promise<DrawerDispatch> {
  const settings = usePrinterSettingsStore.getState();
  const config = getEffectiveCashDrawerConfig(settings);
  if (!settings.selectedPrinterName) {
    throw new Error("Chưa chọn máy in trong Cài đặt → Máy in.");
  }
  const { invoke, isTauri } = await import("@tauri-apps/api/core");
  if (!isTauri()) {
    throw new Error("Mở két tiền chỉ khả dụng trong JPOS desktop trên Windows.");
  }
  return invoke<DrawerDispatch>("open_cash_drawer", {
    printerName: settings.selectedPrinterName,
    pin: config.pin,
    protocol: config.protocol,
    warehouseId,
    orderId,
  });
}

/** Only call after a confirmed cash payment, never from receipt printing. */
export async function openCashDrawerAfterPayment(orderId: string, warehouseId: string, paymentMethod: string): Promise<void> {
  if (paymentMethod !== "CASH") return;
  try {
    if (!getEffectiveCashDrawerConfig(usePrinterSettingsStore.getState()).enabled) return;
    await openCashDrawer(warehouseId, orderId);
  } catch (error: unknown) {
    console.error("[Két tiền] Không thể gửi lệnh mở sau thanh toán:", error);
    try {
      showWarning("Thanh toán thành công nhưng chưa mở được két", describeCashDrawerError(error));
    } catch (noticeError: unknown) {
      console.error("[Két tiền] Không hiển thị được cảnh báo thiết bị:", noticeError);
    }
  }
}
