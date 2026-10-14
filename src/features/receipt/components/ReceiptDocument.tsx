import { formatDateTime } from "@/lib/utils/dateFormat";
import type { CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
    DEFAULT_PRINT_TOP_MARGIN_MM,
    normalizePrintTopMarginMm,
} from "@/features/printer/config/printerConfig";
import { RECEIPT_PAPER_PROFILES } from "@/features/receipt/config/receiptConfig";
import {
    calculateReceiptLine,
    calculateReceiptTotals,
} from "@/features/receipt/helpers/receiptCalculations";
import {
    getLocalizedThemeMessage,
    getReceiptCopy,
    getReceiptLocale,
    translateKnownSettingText,
} from "@/features/receipt/helpers/receiptI18n";
import type {
    ReceiptDocumentProps,
    ReceiptFontWeight,
    ReceiptLanguage,
    ReceiptTheme,
} from "@/features/receipt/types/receipt";
import { buildInvoiceRequestUrl } from "@/features/receipt/helpers/invoiceRequestUrl";

function formatMoney(value: number, language: ReceiptLanguage): string {
    if (language === "vi") {
        return `${Math.round(value).toLocaleString("vi-VN")} đ`;
    }
    return new Intl.NumberFormat(getReceiptLocale(language), {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
    }).format(Math.round(value));
}

function formatTaxRate(value: number, language: ReceiptLanguage): string {
    return Number.isInteger(value)
        ? String(value)
        : value.toLocaleString(getReceiptLocale(language), { maximumFractionDigits: 2 });
}

const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "3mm",
};

const labelStyle: CSSProperties = {
    flex: "1 1 auto",
    minWidth: 0,
};

const valueStyle: CSSProperties = {
    flex: "0 0 auto",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
};

interface ThemeMessageBannerProps {
    theme: ReceiptTheme;
    message: string;
    fontSizePt: number;
    fontWeight: ReceiptFontWeight;
    isCompact: boolean;
}

const VietnamFlagIcon: React.FC<{ heightMm?: number }> = ({ heightMm = 4 }) => {
    const widthMm = heightMm * 1.5;
    return (
        <svg
            viewBox="0 0 30 20"
            style={{
                width: `${widthMm}mm`,
                height: `${heightMm}mm`,
                display: "inline-block",
                verticalAlign: "middle",
                borderRadius: "0.5px",
                flexShrink: 0,
            }}
            aria-label="Lá cờ Việt Nam"
            role="img"
        >
            <rect width="30" height="20" fill="#DA251D" />
            <path
                d="M 15 4 L 16.347 8.146 L 20.706 8.146 L 17.18 10.708 L 18.527 14.854 L 15 12.292 L 11.473 14.854 L 12.82 10.708 L 9.294 8.146 L 13.653 8.146 Z"
                fill="#FFCD00"
            />
        </svg>
    );
};

const ThemeMessageBanner: React.FC<ThemeMessageBannerProps> = ({
    theme,
    message,
    fontSizePt,
    fontWeight,
    isCompact,
}) => {
    const marker = theme === "NATIONAL_DAY" ? "★" : theme === "TET" ? "◆" : "•";

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1mm', flexDirection: 'column' }}>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "auto minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: isCompact ? "1.5mm" : "2.5mm",
                    marginTop: "3mm",
                    padding: isCompact ? "0.8mm 0.5mm" : "0.2mm 1mm",
                    fontSize: `${fontSizePt}pt`,
                    fontWeight,
                    lineHeight: 1.25,
                    letterSpacing: theme === "NATIONAL_DAY" ? "0.25px" : "0",
                    textAlign: "center",
                }}
            >
                <span aria-hidden="true">{marker}</span>
                <span>{message}</span>
                <span aria-hidden="true">{marker}</span>
            </div>
            {
                theme === "NATIONAL_DAY" && <VietnamFlagIcon />
            }
        </div>
    );
};

const ReceiptDocument: React.FC<ReceiptDocumentProps> = ({
    order,
    settings,
    printableWidthMm,
    topMarginMm = DEFAULT_PRINT_TOP_MARGIN_MM,
    language = "vi",
    invoiceRequestUrlOverride,
}) => {
    const profile = RECEIPT_PAPER_PROFILES[settings.paperSize];
    const resolvedPrintableWidthMm = printableWidthMm ?? profile.printableWidthMm;
    const isCompact = settings.paperSize === "POS58";
    const horizontalAndBottomPaddingMm = isCompact ? 3 : 4;
    const resolvedTopMarginMm = normalizePrintTopMarginMm(topMarginMm);
    const fontWeights = settings.fontWeights;
    const logoWidthMm = Math.min(
        Math.max(12, settings.logoWidthMm),
        resolvedPrintableWidthMm - (isCompact ? 6 : 8),
    );
    const invoiceQrSizeMm = Math.min(
        Math.max(22, settings.invoiceQrSizeMm),
        resolvedPrintableWidthMm - (isCompact ? 8 : 12),
    );
    const totals = calculateReceiptTotals(order, settings.defaultTaxRate);
    const copy = getReceiptCopy(language);
    const invoiceRequestUrl = invoiceRequestUrlOverride || buildInvoiceRequestUrl(order);
    const themeMessage = getLocalizedThemeMessage(
        settings.theme,
        settings.themeMessages[settings.theme] ?? "",
        language,
    );
    const storeAddress = translateKnownSettingText(settings.storeAddress, language);
    const afterSalesText = translateKnownSettingText(settings.afterSalesText, language);
    const footerMessage = translateKnownSettingText(settings.footerMessage, language);
    const customerName = order.member?.fullName || order.customerName || "";
    const customerPhone = order.member?.phone || order.customerPhone || "";
    const memberCode = order.member?.memberCode || "";
    const memberLevel = order.member?.levelName || "";
    const borderStyle = settings.theme === "NATIONAL_DAY"
        ? "1px solid #000"
        : settings.theme === "TET"
            ? "2px solid #000"
            : "1px solid #000";

    return (
        <article
            aria-label={`${copy.documentLabel} ${order.localOrderId}`}
            lang={language === "zh" ? "zh-CN" : language}
            style={{
                boxSizing: "border-box",
                width: `${resolvedPrintableWidthMm}mm`,
                minHeight: "40mm",
                padding: `${resolvedTopMarginMm}mm 0 ${horizontalAndBottomPaddingMm}mm`,
                background: "#fff",
                color: "#000",
                fontFamily: 'Arial, "Microsoft YaHei", "Noto Sans SC", Helvetica, sans-serif',
                fontSize: isCompact ? "10px" : "11.5px",
                lineHeight: 1.1,
                overflowWrap: "anywhere",
            }}
        >

            <header style={{ textAlign: "center" }}>
                {settings.showLogo && settings.logoDataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={settings.logoDataUrl}
                        alt={copy.logoAlt}
                        style={{
                            display: "block",
                            width: `${logoWidthMm}mm`,
                            maxHeight: `${settings.logoMaxHeightMm}mm`,
                            objectFit: "contain",
                            filter: `grayscale(1) contrast(${settings.logoContrastPercent}%)`,
                            margin: "0 auto 2mm",
                        }}
                    />
                )}
                <div style={{ fontSize: isCompact ? "15px" : "18px", fontWeight: fontWeights.storeName }}>
                    {settings.storeName || "JOY POS"}
                </div>
                {storeAddress && (
                    <div style={{ marginTop: "0.8mm", fontWeight: fontWeights.storeDetails }}>{storeAddress}</div>
                )}
                {settings.showContact && settings.hotline && (
                    <div style={{ marginTop: "0.5mm", fontWeight: fontWeights.storeDetails }}>{copy.hotline}: {settings.hotline}</div>
                )}
                {settings.showThemeMessage && themeMessage && (
                    <ThemeMessageBanner
                        theme={settings.theme}
                        message={themeMessage}
                        fontSizePt={settings.themeMessageFontSizePt}
                        fontWeight={fontWeights.themeMessage}
                        isCompact={isCompact}
                    />
                )}
                <div
                    style={{
                        borderTop: borderStyle,
                        borderBottom: borderStyle,
                        fontSize: isCompact ? "12px" : "14px",
                        fontWeight: fontWeights.receiptTitle,
                        letterSpacing: "0.5px",
                        margin: "3mm 0",
                        padding: "1.5mm 0",
                    }}
                >
                    {copy.receiptTitle}
                </div>
            </header>

            <section style={{ display: "grid", gap: "0.8mm", fontWeight: fontWeights.orderInfo }}>
                <div style={rowStyle}>
                    <span style={labelStyle}>{copy.orderId}:</span>
                    <strong style={{ ...valueStyle, fontFamily: "monospace", fontWeight: fontWeights.orderInfo }}>
                        {order.localOrderId}
                    </strong>
                </div>
                <div style={rowStyle}>
                    <span style={labelStyle}>{copy.dateTime}:</span>
                    <span style={valueStyle}>{formatDateTime(order.paidAt || order.createdAt)}</span>
                </div>
                {settings.showCashier && order.operatorName && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{copy.cashier}:</span>
                        <span style={valueStyle}>{order.operatorName}</span>
                    </div>
                )}
                {customerName && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{copy.customer}:</span>
                        <span style={valueStyle}>{customerName}</span>
                    </div>
                )}
                {customerPhone && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{copy.phone}:</span>
                        <span style={valueStyle}>{customerPhone}</span>
                    </div>
                )}
                {memberCode && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{copy.memberCode}:</span>
                        <span style={valueStyle}>{memberCode}</span>
                    </div>
                )}
                {memberLevel && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{copy.memberLevel}:</span>
                        <span style={valueStyle}>{memberLevel}</span>
                    </div>
                )}
                <div style={rowStyle}>
                    <span style={labelStyle}>{copy.payment}:</span>
                    <span style={valueStyle}>
                        {language === "vi" && order.paymentMethodName
                            ? order.paymentMethodName
                            : copy.paymentMethods[order.paymentMethod]}
                    </span>
                </div>
            </section>

            <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

            <section aria-label={copy.purchasedItems}>
                <div style={{ ...rowStyle, fontWeight: fontWeights.tableHeader, marginBottom: "1.8mm" }}>
                    <span style={labelStyle}>{copy.goods}</span>
                    <span style={valueStyle}>{copy.amount}</span>
                </div>
                <div style={{ display: "grid", gap: isCompact ? "2.5mm" : "2mm" }}>
                    {order.items.map((item) => {
                        const line = calculateReceiptLine(item, settings.defaultTaxRate);
                        return (
                            <div key={item.goodsId}>
                                <div style={{ fontWeight: fontWeights.itemName }}>{item.goodsName}</div>
                                <div style={{ ...rowStyle, marginTop: "0.5mm", fontWeight: fontWeights.itemDetails }}>
                                    <span style={labelStyle}>
                                        {item.quantity} × {formatMoney(line.unitPriceBeforeTax, language)}
                                    </span>
                                    <span style={valueStyle}>
                                        {formatMoney(line.lineSubtotal, language)}
                                    </span>
                                </div>
                                {settings.showItemTax &&
                                    line.taxRate > 0 &&
                                    line.taxAmount > 0 && (
                                    <div style={{ ...rowStyle, marginTop: "0.5mm", fontSize: "0.92em", fontWeight: fontWeights.itemTax }}>
                                        <span style={labelStyle}>{copy.tax} {formatTaxRate(line.taxRate, language)}%</span>
                                        <span style={valueStyle}>{formatMoney(line.taxAmount, language)}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

            <section style={{ display: "grid", gap: "1mm", fontWeight: fontWeights.summary }}>
                <div style={rowStyle}>
                    <span style={labelStyle}>{copy.subtotal}</span>
                    <span style={valueStyle}>{formatMoney(totals.subtotal, language)}</span>
                </div>
                {totals.discount > 0 && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>
                            {copy.discount}{order.voucherCodes?.length
                              ? ` (${order.voucherCodes.join(", ")})`
                              : order.voucherCode ? ` (${order.voucherCode})` : ""}
                        </span>
                        <span style={valueStyle}>-{formatMoney(totals.discount, language)}</span>
                    </div>
                )}
                {totals.taxTotal > 0 && (
                    <div style={{ ...rowStyle, fontWeight: fontWeights.taxTotal }}>
                        <span style={labelStyle}>{copy.taxTotal}</span>
                        <span style={valueStyle}>{formatMoney(totals.taxTotal, language)}</span>
                    </div>
                )}
                <div
                    style={{
                        ...rowStyle,
                        borderTop: "2px solid #000",
                        marginTop: "1mm",
                        paddingTop: "1.5mm",
                        fontSize: isCompact ? "14px" : "16px",
                        fontWeight: fontWeights.grandTotal,
                    }}
                >
                    <span style={labelStyle}>{copy.grandTotal}</span>
                    <span style={valueStyle}>{formatMoney(totals.grandTotal, language)}</span>
                </div>
            </section>

            <footer style={{ marginTop: "4mm", textAlign: "center" }}>
                {invoiceRequestUrl && settings.showInvoiceRequestQr && (
                    <section
                        aria-label={copy.invoiceRequest}
                        style={{
                            borderTop: "1px dashed #000",
                            paddingTop: "3mm",
                            marginBottom: "3mm",
                        }}
                    >
                        <div
                            style={{
                                fontSize: `${settings.invoiceQrTitleFontSizePt}pt`,
                                fontWeight: fontWeights.invoiceQrTitle,
                            }}
                        >
                            {copy.invoiceRequestQr}
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", margin: "2mm 0" }}>
                            <QRCodeSVG
                                value={invoiceRequestUrl}
                                size={256}
                                level="M"
                                marginSize={1}
                                bgColor="#ffffff"
                                fgColor="#000000"
                                title={copy.invoiceRequestQr}
                                style={{
                                    width: `${invoiceQrSizeMm}mm`,
                                    height: `${invoiceQrSizeMm}mm`,
                                }}
                            />
                        </div>
                        <div
                            style={{
                                fontSize: `${settings.invoiceQrHintFontSizePt}pt`,
                                fontWeight: fontWeights.invoiceQrHint,
                            }}
                        >
                            {copy.invoiceRequestHint}
                        </div>
                    </section>
                )}
                {settings.showContact && afterSalesText && (
                    <div style={{ borderTop: "1px dashed #000", paddingTop: "3mm", fontWeight: fontWeights.footer }}>
                        {afterSalesText}
                    </div>
                )}
                {footerMessage && (
                    <div style={{ marginTop: "2.5mm", fontWeight: fontWeights.footer }}>
                        {footerMessage}
                    </div>
                )}
            </footer>
        </article>
    );
};

export default ReceiptDocument;
