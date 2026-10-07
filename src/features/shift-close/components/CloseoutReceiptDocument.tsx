import { RECEIPT_PAPER_PROFILES } from "@/features/receipt/config/receiptConfig";
import type { ReceiptSettings } from "@/features/receipt/types/receipt";
import type {
    CloseoutReport,
    CloseoutReportMeta,
} from "@/features/shift-close/types/closeout";

interface CloseoutReceiptDocumentProps {
    report: CloseoutReport;
    meta: CloseoutReportMeta;
    settings: ReceiptSettings;
}

const moneyFormatter = new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
});

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "3mm",
};

const valueStyle: React.CSSProperties = {
    flexShrink: 0,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
};

const EMPHASIS_FONT_WEIGHT = 500;

const CloseoutReceiptDocument: React.FC<CloseoutReceiptDocumentProps> = ({
    report,
    meta,
    settings,
}) => {
    const profile = RECEIPT_PAPER_PROFILES[settings.paperSize];
    const isCompact = profile.paperWidthMm <= 58;

    return (
        <article
            aria-label="Báo cáo kết ca"
            style={{
                boxSizing: "border-box",
                width: `${profile.printableWidthMm}mm`,
                padding: isCompact ? "3mm 0 5mm" : "4mm 0 6mm",
                background: "#fff",
                color: "#000",
                fontFamily: "Arial, sans-serif",
                fontSynthesis: "none",
                fontSize: isCompact ? "10px" : "11px",
                fontWeight: 400,
                lineHeight: 1.35,
            }}
        >
            <header style={{ textAlign: "center" }}>
                <div style={{ fontSize: isCompact ? "14px" : "16px", fontWeight: EMPHASIS_FONT_WEIGHT }}>
                    {settings.storeName || "JOY POS"}
                </div>
                {settings.storeAddress && <div style={{ marginTop: "1mm" }}>{settings.storeAddress}</div>}
                <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />
                <div style={{ fontSize: isCompact ? "13px" : "15px", fontWeight: EMPHASIS_FONT_WEIGHT }}>
                    BÁO CÁO KẾT CA
                </div>
            </header>

            <section style={{ display: "grid", gap: "1mm", marginTop: "3mm" }}>
                <div style={rowStyle}><span>Điểm bán</span><span style={valueStyle}>{meta.warehouseName}</span></div>
                <div style={rowStyle}><span>Kiểu báo cáo</span><span style={valueStyle}>{meta.periodMode === "SHIFT" ? "Theo ca" : "Theo ngày"}</span></div>
                <div style={rowStyle}><span>Từ</span><span style={valueStyle}>{dateTimeFormatter.format(new Date(meta.startAt))}</span></div>
                <div style={rowStyle}><span>Đến</span><span style={valueStyle}>{dateTimeFormatter.format(new Date(meta.endAt))}</span></div>
                <div style={rowStyle}><span>Tài khoản</span><span style={valueStyle}>{meta.accountLabel}</span></div>
                <div style={rowStyle}><span>Người in</span><span style={valueStyle}>{meta.generatedBy}</span></div>
            </section>

            <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

            <section aria-label="Sản phẩm đã bán">
                <div style={{ ...rowStyle, fontWeight: EMPHASIS_FONT_WEIGHT, marginBottom: "2mm" }}>
                    <span>SẢN PHẨM ĐÃ BÁN</span><span>SL</span>
                </div>
                <div style={{ display: "grid", gap: "1.5mm" }}>
                    {report.products.length > 0 ? report.products.map((product, index) => (
                        <div key={product.goodsId} style={rowStyle}>
                            <span style={{ minWidth: 0 }}>{index + 1}. {product.goodsName}</span>
                            <span style={valueStyle}>{product.quantity.toLocaleString("vi-VN")}</span>
                        </div>
                    )) : <div style={{ textAlign: "center", padding: "2mm 0" }}>Không có sản phẩm đã bán</div>}
                </div>
                <div style={{ ...rowStyle, borderTop: "1px solid #000", marginTop: "2mm", paddingTop: "1.5mm", fontWeight: EMPHASIS_FONT_WEIGHT }}>
                    <span>Tổng số lượng</span><span>{report.productQuantity.toLocaleString("vi-VN")}</span>
                </div>
            </section>

            <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

            <section aria-label="Doanh thu theo phương thức thanh toán">
                <div style={{ fontWeight: EMPHASIS_FONT_WEIGHT, marginBottom: "2mm" }}>PHƯƠNG THỨC THANH TOÁN</div>
                <div style={{ display: "grid", gap: "1.5mm" }}>
                    {report.payments.map((payment) => (
                        <div key={payment.paymentMethodId} style={rowStyle}>
                            <span>{payment.paymentMethodName} ({payment.orderCount} đơn)</span>
                            <span style={valueStyle}>{moneyFormatter.format(payment.totalAmount)}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section aria-label="Đối soát PayOS" style={{ borderTop: "1px dashed #000", marginTop: "3mm", paddingTop: "2mm" }}>
                <div style={rowStyle}><span>PayOS đã xác nhận</span><span style={valueStyle}>{moneyFormatter.format(report.payosVerifiedAmount)}</span></div>
                <div style={rowStyle}><span>PayOS chờ đối soát ({report.payosPendingOrders.length} đơn)</span><span style={valueStyle}>{moneyFormatter.format(report.payosUnverifiedAmount)}</span></div>
                {report.payosPendingOrders.length > 0 && <div style={{ marginTop: "2mm", fontWeight: EMPHASIS_FONT_WEIGHT }}>CẢNH BÁO: PAYOS CHƯA XÁC NHẬN ĐÃ NHẬN TIỀN</div>}
                {report.payosPendingOrders.map((order) => (
                    <div key={order.localOrderId} style={{ marginTop: "2mm", overflowWrap: "anywhere" }}>
                        <div>{order.localOrderId} · {moneyFormatter.format(order.totalAmount)}</div>
                        <div>{order.operatorName}{order.completedAt ? ` · ${dateTimeFormatter.format(new Date(order.completedAt))}` : ""}</div>
                        {order.lastError && <div>{order.lastError}</div>}
                    </div>
                ))}
            </section>

            <div style={{ borderTop: "2px solid #000", margin: "3mm 0 2mm" }} />
            <section style={{ display: "grid", gap: "1.5mm" }}>
                <div style={{ ...rowStyle, fontWeight: EMPHASIS_FONT_WEIGHT }}><span>TỔNG ĐƠN</span><span>{report.orderCount.toLocaleString("vi-VN")}</span></div>
                <div style={{ ...rowStyle, fontSize: isCompact ? "12px" : "13px", fontWeight: EMPHASIS_FONT_WEIGHT }}>
                    <span>TỔNG DOANH THU</span><span>{moneyFormatter.format(report.totalRevenue)}</span>
                </div>
            </section>

            <footer style={{ borderTop: "1px dashed #000", marginTop: "3mm", paddingTop: "2mm", textAlign: "center", fontSize: "0.9em" }}>
                Lập lúc {dateTimeFormatter.format(new Date(meta.fetchedAt))}
            </footer>
        </article>
    );
};

export default CloseoutReceiptDocument;
