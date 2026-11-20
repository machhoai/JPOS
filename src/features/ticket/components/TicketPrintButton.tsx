"use client";

import { useCallback, useState } from "react";
import { TicketCheck } from "lucide-react";
import { trimPrintImageWhitespace } from "@/features/printer/helpers/trimPrintImageWhitespace";
import {
  printCurrentDocumentSilently,
  resolveLocalPrinterPageWidthMm,
} from "@/features/printer/services/printerService";
import { usePrinterSettingsStore } from "@/features/printer/store/usePrinterSettingsStore";
import TicketBatchDocument from "@/features/ticket/components/TicketBatchDocument";
import TicketDocument from "@/features/ticket/components/TicketDocument";
import { RECEIPT_PAPER_PROFILES } from "@/features/receipt/config/receiptConfig";
import { buildPrintableTickets } from "@/features/ticket/helpers/buildPrintableTickets";
import { useTicketSettingsStore } from "@/features/ticket/store/useTicketSettingsStore";
import type { PrintableTicket, TicketSettings } from "@/features/ticket/types/ticket";
import type { PosOrder } from "@/lib/types/order";
import { showError } from "@/lib/utils/toast";

type TicketPrintMode = "silent" | "dialog";

interface TicketPrintButtonProps {
  order: PosOrder;
  settings?: TicketSettings;
  label?: string;
  className?: string;
  disabled?: boolean;
  printMode?: TicketPrintMode;
}

async function prepareTicketSettingsForPrint(
  settings: TicketSettings,
): Promise<TicketSettings> {
  if (!settings.showLogo || !settings.logoDataUrl) return settings;

  const trimmedLogoDataUrl = await trimPrintImageWhitespace(settings.logoDataUrl);
  if (trimmedLogoDataUrl === settings.logoDataUrl) return settings;
  return { ...settings, logoDataUrl: trimmedLogoDataUrl };
}

async function waitForAssets(container: ParentNode): Promise<void> {
  const ownerDocument = container.nodeType === 9
    ? (container as Document)
    : (container as Node).ownerDocument;
  if (!ownerDocument) throw new Error("Không thể xác định tài liệu chứa vé.");
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all([
    ownerDocument.fonts?.ready,
    ...images.map(async (image) => {
      if (image.complete) return;
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  ]);
  await new Promise<void>((resolve) => {
    (ownerDocument.defaultView ?? window).requestAnimationFrame(() => resolve());
  });
}

async function printWithDialog(
  renderContent: (printableWidthMm: number) => React.ReactNode,
  settings: TicketSettings,
): Promise<void> {
  const profile = RECEIPT_PAPER_PROFILES[settings.paperSize];
  const pageWidthMm = resolveLocalPrinterPageWidthMm(profile.printableWidthMm);
  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Vé đang in thử");
  Object.assign(frame.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    right: "0",
    bottom: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(frame);

  const printWindow = frame.contentWindow;
  const printDocument = frame.contentDocument;
  if (!printWindow || !printDocument) {
    frame.remove();
    throw new Error("Không thể khởi tạo vùng in thử vé.");
  }

  printDocument.open();
  printDocument.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
    @page { size: ${pageWidthMm}mm ${settings.ticketHeightMm}mm; margin: 0; }
    html, body { width: ${pageWidthMm}mm; margin: 0; padding: 0; background: #fff; }
    *, *::before, *::after { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    [data-ticket-page]:last-child { page-break-after: auto !important; break-after: auto !important; }
  </style></head><body></body></html>`);
  printDocument.close();

  const { createRoot } = await import("react-dom/client");
  const root = createRoot(printDocument.body);
  root.render(renderContent(pageWidthMm));
  await waitForAssets(printDocument);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.unmount();
    frame.remove();
  };
  printWindow.addEventListener("afterprint", cleanup, { once: true });
  printWindow.focus();
  printWindow.print();
  window.setTimeout(cleanup, 300_000);
}

export async function printTicketPreviewWithDialog(
  ticket: PrintableTicket,
  settings: TicketSettings,
): Promise<void> {
  const printSettings = await prepareTicketSettingsForPrint(settings);
  const topMarginMm = usePrinterSettingsStore.getState().topMarginMm;
  await printWithDialog(
    (printableWidthMm) => (
      <TicketDocument
        ticket={ticket}
        settings={printSettings}
        printableWidthMm={printableWidthMm}
        topMarginMm={topMarginMm}
      />
    ),
    printSettings,
  );
}

export async function printTicketsWithDialog(
  order: PosOrder,
  settings: TicketSettings,
): Promise<void> {
  if (buildPrintableTickets(order).length === 0) {
    throw new Error("Đơn hàng này không có vé để in.");
  }
  const printSettings = await prepareTicketSettingsForPrint(settings);
  const topMarginMm = usePrinterSettingsStore.getState().topMarginMm;
  await printWithDialog(
    (printableWidthMm) => (
      <TicketBatchDocument
        order={order}
        settings={printSettings}
        printableWidthMm={printableWidthMm}
        topMarginMm={topMarginMm}
      />
    ),
    printSettings,
  );
}

export async function printTicketsSilently(
  order: PosOrder,
  settings: TicketSettings,
): Promise<void> {
  const tickets = buildPrintableTickets(order);
  const ticketCount = tickets.length;
  if (ticketCount === 0) return;

  const printSettings = await prepareTicketSettingsForPrint(settings);
  const profile = RECEIPT_PAPER_PROFILES[printSettings.paperSize];
  const pageWidthMm = resolveLocalPrinterPageWidthMm(profile.printableWidthMm);
  const topMarginMm = usePrinterSettingsStore.getState().topMarginMm;
  const { createRoot } = await import("react-dom/client");
  for (const [ticketIndex, ticket] of tickets.entries()) {
    const rootId = `pos-silent-ticket-${crypto.randomUUID()}`;
    const rootElement = document.createElement("div");
    const printStyle = document.createElement("style");
    rootElement.id = rootId;
    rootElement.setAttribute("aria-hidden", "true");
    Object.assign(rootElement.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${pageWidthMm}mm`,
      background: "#fff",
    });
    document.body.appendChild(rootElement);

    const root = createRoot(rootElement);
    try {
      root.render(
        <TicketDocument
          ticket={ticket}
          settings={printSettings}
          printableWidthMm={pageWidthMm}
          topMarginMm={topMarginMm}
        />,
      );
      await waitForAssets(rootElement);
      printStyle.textContent = `
        @page { size: ${pageWidthMm}mm ${printSettings.ticketHeightMm}mm; margin: 0; }
        @media print {
          html, body { width: ${pageWidthMm}mm !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
          body > * { display: none !important; }
          body > #${rootId} { display: block !important; position: static !important; width: ${pageWidthMm}mm !important; margin: 0 !important; background: #fff !important; }
          [data-ticket-page] { page-break-after: auto !important; break-after: auto !important; }
          *, *::before, *::after { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `;
      document.head.appendChild(printStyle);
      const dispatch = await printCurrentDocumentSilently({
        pageWidthMm,
        pageHeightMm: printSettings.ticketHeightMm,
      });
      console.info("[Vé] Máy in đã nhận từng job", {
        localOrderId: order.localOrderId,
        ticketNumber: ticketIndex + 1,
        ticketCount,
        ticketCode: ticket.ticketCode,
        printerName: dispatch.effectivePrinterName,
        usedFallback: dispatch.usedFallback,
      });
    } finally {
      root.unmount();
      printStyle.remove();
      rootElement.remove();
    }
  }
}

const TicketPrintButton: React.FC<TicketPrintButtonProps> = ({
  order,
  settings: settingsOverride,
  label = "In vé",
  className = "",
  disabled = false,
  printMode = "silent",
}) => {
  const storedSettings = useTicketSettingsStore((state) => state.settings);
  const [isPrinting, setIsPrinting] = useState(false);
  const settings = settingsOverride || storedSettings;
  const ticketCount = buildPrintableTickets(order).length;

  const handlePrint = useCallback(async () => {
    setIsPrinting(true);
    try {
      if (printMode === "dialog") await printTicketsWithDialog(order, settings);
      else await printTicketsSilently(order, settings);
    } catch (error: unknown) {
      console.error("[Vé] Không thể in:", error);
      showError(
        printMode === "dialog" ? "Không thể mở bản in thử" : "Không thể in vé",
        error instanceof Error ? error.message : "Vui lòng kiểm tra máy in và thử lại.",
      );
    } finally {
      setIsPrinting(false);
    }
  }, [order, printMode, settings]);

  return (
    <button
      type="button"
      onClick={() => void handlePrint()}
      disabled={disabled || isPrinting || ticketCount === 0}
      className={className}
      title={ticketCount === 0 ? "Đơn hàng không có vé" : `In ${ticketCount} vé`}
    >
      <TicketCheck className="size-4" aria-hidden="true" />
      {isPrinting ? "Đang in vé..." : `${label}${ticketCount > 0 ? ` (${ticketCount})` : ""}`}
    </button>
  );
};

export default TicketPrintButton;
