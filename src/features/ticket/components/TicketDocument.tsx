"use client";

import { formatDateTime } from "@/lib/utils/dateFormat";

import { QRCodeSVG } from "qrcode.react";
import {
    DEFAULT_PRINT_TOP_MARGIN_MM,
    normalizePrintTopMarginMm,
} from "@/features/printer/config/printerConfig";
import { RECEIPT_PAPER_PROFILES } from "@/features/receipt/config/receiptConfig";
import type { TicketDocumentProps } from "@/features/ticket/types/ticket";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const TicketDocument: React.FC<TicketDocumentProps> = ({
    ticket,
    settings,
    printableWidthMm,
    topMarginMm = DEFAULT_PRINT_TOP_MARGIN_MM,
}) => {
    const profile = RECEIPT_PAPER_PROFILES[settings.paperSize];
    const resolvedPrintableWidthMm = printableWidthMm ?? profile.printableWidthMm;
    const resolvedTopMarginMm = normalizePrintTopMarginMm(topMarginMm);
    const issuedAt = formatDateTime(ticket.issuedAt);

    return (
        <article
            data-ticket-page
            style={{
                width: `${resolvedPrintableWidthMm}mm`,
                height: `${settings.ticketHeightMm}mm`,
                overflow: "hidden",
                padding: `${resolvedTopMarginMm}mm 0 4mm`,
                background: "#fff",
                color: "#000",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: `${settings.bodyFontSizePt}pt`,
                lineHeight: 1.0,
                overflowWrap: "anywhere",
            }}
        >
            <header style={{ borderBottom: "1px dashed #000", paddingBottom: "2.5mm", display: "flex" }}>
                {settings.showLogo && settings.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={settings.logoDataUrl}
                        alt=""
                        style={{
                            display: "block",
                            width: `${settings.logoWidthMm}mm`,
                            maxHeight: `${settings.logoMaxHeightMm}mm`,
                            objectFit: "contain",
                            margin: "0 auto 1.5mm",
                            filter: `grayscale(1) contrast(${settings.logoContrastPercent}%)`,
                        }}
                    />
                ) : null}
                <div style={{ margin: "auto 0", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "start" }}>
                    <div style={{ fontWeight: 700, fontSize: `${settings.titleFontSizePt}pt`, letterSpacing: "0.5px" }}>
                        {settings.ticketTitle}
                    </div>
                    <div style={{ marginTop: "1mm", fontWeight: 700 }}>{settings.storeName}</div>
                    {settings.subtitle ? <div style={{ marginTop: "1mm" }}>{settings.subtitle}</div> : null}
                </div>
            </header>

            <main style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1.5mm 0" }}>
                <div style={{ fontSize: `${settings.productFontSizePt}pt`, fontWeight: settings.fontWeight, lineHeight: 1.2 }}>
                    {ticket.goodsName}
                </div>
                {settings.showSequence && ticket.totalForItem > 1 ? (
                    <div style={{ marginTop: "1mm", fontWeight: 700 }}>Vé {ticket.sequence}/{ticket.totalForItem}</div>
                ) : null}
                {settings.showPrice ? <div style={{ marginTop: "1mm" }}>{formatCurrency(ticket.price)}</div> : null}
                <div style={{ margin: "2mm 0 1mm" }}>
                    <QRCodeSVG
                        value={ticket.ticketCode}
                        size={256}
                        level="M"
                        marginSize={1}
                        bgColor="#ffffff"
                        fgColor="#000000"
                        title={`Mã vé ${ticket.ticketCode}`}
                        style={{ width: `${settings.qrSizeMm}mm`, height: `${settings.qrSizeMm}mm` }}
                    />
                </div>
                <div style={{ maxWidth: "100%", overflowWrap: "anywhere", fontFamily: "monospace", fontSize: `${Math.max(6, settings.bodyFontSizePt - 1)}pt`, fontWeight: 700 }}>
                    {ticket.ticketCode}
                </div>
            </main>

            <footer style={{ borderTop: "1px dashed #000", paddingTop: "2mm" }}>
                <div style={{ display: "grid", gap: "0.5mm", textAlign: "left" }}>
                    {settings.showOrderCode ? <div><strong>Mã đơn:</strong> {ticket.orderId}</div> : null}
                    {settings.showIssuedAt ? <div><strong>Phát hành:</strong> {issuedAt}</div> : null}
                </div>
                {settings.instructions ? <div style={{ marginTop: "1.5mm" }}>{settings.instructions}</div> : null}
                {settings.footerMessage ? <div style={{ marginTop: "1.5mm", fontWeight: 700 }}>{settings.footerMessage}</div> : null}
            </footer>
        </article>
    );
};

export default TicketDocument;
