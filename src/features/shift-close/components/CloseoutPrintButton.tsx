"use client";

import { useCallback, useState } from "react";
import { Printer } from "lucide-react";
import { RECEIPT_PAPER_PROFILES } from "@/features/receipt/config/receiptConfig";
import { useReceiptSettingsStore } from "@/features/receipt/store/useReceiptSettingsStore";
import CloseoutReceiptDocument from "@/features/shift-close/components/CloseoutReceiptDocument";
import type {
  CloseoutReport,
  CloseoutReportMeta,
} from "@/features/shift-close/types/closeout";
import { showError } from "@/lib/utils/toast";

interface CloseoutPrintButtonProps {
  report: CloseoutReport | null;
  meta: CloseoutReportMeta | null;
  className?: string;
  refreshBeforePrint?: () => Promise<{ report: CloseoutReport; meta: CloseoutReportMeta } | undefined>;
}

async function printCloseoutReport(
  paperWidthMm: number,
  documentNode: React.ReactNode,
): Promise<void> {
  const frame = document.createElement("iframe");
  frame.title = "Báo cáo kết ca đang in";
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const printWindow = frame.contentWindow;
  const printDocument = frame.contentDocument;
  if (!printWindow || !printDocument) {
    frame.remove();
    throw new Error("Không thể tạo bản in báo cáo.");
  }

  printDocument.open();
  printDocument.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo kết ca</title><style>
    @page { size: ${paperWidthMm}mm auto; margin: 0; }
    html, body { width: ${paperWidthMm}mm; margin: 0; padding: 0; background: #fff; }
    *, *::before, *::after { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  </style></head><body></body></html>`);
  printDocument.close();

  const { createRoot } = await import("react-dom/client");
  const root = createRoot(printDocument.body);
  root.render(documentNode);
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  await printDocument.fonts?.ready;

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    root.unmount();
    frame.remove();
  };
  printWindow.addEventListener("afterprint", cleanup, { once: true });
  printWindow.focus();
  printWindow.print();
  window.setTimeout(cleanup, 300_000);

}

const CloseoutPrintButton: React.FC<CloseoutPrintButtonProps> = ({
  report,
  meta,
  className = "",
  refreshBeforePrint,
}) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const settings = useReceiptSettingsStore((state) => state.settings);

  const handlePrint = useCallback(async () => {
    if (!report || !meta) return;
    setIsPrinting(true);
    try {
      const latest = refreshBeforePrint ? await refreshBeforePrint() : { report, meta };
      if (!latest) return;
      if (latest.report.payosPendingOrders.length > 0 && !window.confirm(
        `Còn ${latest.report.payosPendingOrders.length} đơn PayOS chưa được xác nhận đã nhận tiền. Bạn đã kiểm tra danh sách và muốn in báo cáo có cảnh báo?`,
      )) return;
      await printCloseoutReport(
        RECEIPT_PAPER_PROFILES[settings.paperSize].paperWidthMm,
        <CloseoutReceiptDocument report={latest.report} meta={latest.meta} settings={settings} />,
      );
    } catch (error: unknown) {
      console.error("[Kết ca] Không thể in báo cáo:", error);
      showError(
        "Không thể in báo cáo",
        error instanceof Error ? error.message : "Vui lòng thử lại.",
      );
    } finally {
      setIsPrinting(false);
    }
  }, [meta, report, settings, refreshBeforePrint]);

  return (
    <button
      type="button"
      onClick={() => void handlePrint()}
      disabled={!report || !meta || isPrinting}
      className={className}
    >
      <Printer className="size-4" aria-hidden="true" />
      {isPrinting ? "Đang mở bản in..." : "In báo cáo"}
    </button>
  );
};

export default CloseoutPrintButton;
