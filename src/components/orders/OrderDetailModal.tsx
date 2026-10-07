"use client";

// =============================================================================
// OrderDetailModal — Chi tiết đơn hàng đầy đủ
// =============================================================================

import type { PosOrder } from "@/lib/types/order";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getOrderCustomerDisplay } from "@/lib/utils/orderCustomer";
import { getOrderDisplayStatus } from "@/lib/utils/orderLifecycle";
import { isPayOSOrder } from "@/features/payments/helpers/payOSReconciliation";
import ReceiptPrintButton from "@/features/receipt/components/ReceiptPrintButton";
import TicketPrintButton from "@/features/ticket/components/TicketPrintButton";
import LuckyDrawPrintButton from "@/features/lucky-draw/components/LuckyDrawPrintButton";
import { buildPrintableLuckyDrawTickets } from "@/features/lucky-draw/helpers/buildPrintableLuckyDrawTickets";

interface OrderDetailModalProps {
    order: PosOrder;
    onClose: () => void;
    isRetrying: boolean;
    onRetrySync: () => void | Promise<void>;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    SYNC_SUCCESS: { label: "Đã đồng bộ", color: "text-emerald-400" },
    REFUNDED: { label: "Đã hoàn tiền", color: "text-violet-600" },
    REFUNDING: { label: "Đang hoàn tiền", color: "text-amber-600" },
    REFUND_FAILED: { label: "Hoàn tiền thất bại", color: "text-red-600" },
    REFUND_UNKNOWN: { label: "Cần đối soát hoàn tiền", color: "text-orange-600" },
    CANCELLED: { label: "Đã hủy", color: "text-slate-600" },
    LOCAL_PAID: { label: "Chờ đồng bộ", color: "text-amber-400" },
    SYNCING: { label: "Đang đồng bộ", color: "text-blue-400" },
    SYNC_FAILED: { label: "Lỗi đồng bộ", color: "text-red-400" },
    DRAFT: { label: "Nháp", color: "text-gray-400" },
};

function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString("vi-VN", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

export default function OrderDetailModal({
    order,
    onClose,
    isRetrying,
    onRetrySync,
}: OrderDetailModalProps) {
    const displayStatus = getOrderDisplayStatus(order);
    const status = STATUS_LABELS[displayStatus] || STATUS_LABELS.DRAFT;
    const discountAmount = order.discountAmount ?? order.voucherDiscount ?? 0;
    const subtotalAmount = order.subtotalAmount ?? order.totalAmount;
    const finalAmount = order.subtotalAmount !== undefined
        ? order.totalAmount
        : order.totalAmount - discountAmount;
    const isPaymentUnverified = order.paymentVerificationStatus === "UNVERIFIED";
    const customer = getOrderCustomerDisplay(order);
    const luckyDrawTicketCount = buildPrintableLuckyDrawTickets(order).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-[var(--color-text-primary)]">Chi tiết đơn hàng</h2>
                        <code className="text-xs text-[var(--color-text-muted)] font-mono">{order.localOrderId}</code>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-active)] transition-colors"
                    >
                        <svg className="w-5 h-5 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {isPayOSOrder(order) && order.paymentVerificationStatus === "VERIFIED" && (
                        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                            <p className="text-sm font-bold">PayOS đã xác nhận thanh toán</p>
                            {order.payosReconciliation?.verifiedAt && <p className="mt-1 text-xs">Đối soát lúc {formatDateTime(order.payosReconciliation.verifiedAt)}</p>}
                            {order.paymentDetails?.manualConfirmation && <p className="mt-1 text-xs">Đơn đã được {order.paymentDetails.manualConfirmation.confirmedByName} hoàn thành thủ công lúc {formatDateTime(order.paymentDetails.manualConfirmation.confirmedAt)}.</p>}
                        </div>
                    )}
                    {isPaymentUnverified && (
                        <div className="rounded-xl border border-amber-500/60 bg-amber-500/15 p-3 text-amber-300">
                            <p className="text-sm font-extrabold">Chưa được xác nhận thanh toán</p>
                            <p className="mt-1 text-xs leading-relaxed">
                                Đơn được nhân viên hoàn tất thủ công khi hệ thống chưa thể xác nhận giao dịch. Hãy kiểm tra giao dịch ngân hàng khi cần.
                            </p>
                            {order.fixedTransferDetails?.confirmedByName && (
                                <p className="mt-2 text-xs font-semibold">
                                    Nhân viên xác nhận: {order.fixedTransferDetails.confirmedByName}
                                </p>
                            )}
                        </div>
                    )}
                    {/* Thông tin chung */}
                    <div className="grid grid-cols-2 gap-3">
                        <InfoRow label="Trạng thái" value={status.label} className={status.color} />
                        <InfoRow label="Thời gian" value={formatDateTime(order.createdAt)} />
                        <InfoRow label="Thanh toán" value={order.paymentMethodName || order.paymentMethod} />
                        <InfoRow label="Mã HK" value={order.hkOrderNumber || "—"} />
                        {order.operatorName && <InfoRow label="Nhân viên" value={order.operatorName} />}
                        {order.refundOrderNumber && <InfoRow label="Mã hoàn tiền" value={order.refundOrderNumber} />}
                    </div>

                    {/* Thành viên / khách hàng */}
                    {customer.isMember ? (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                                    Thành viên mua hàng
                                </p>
                                {customer.levelName && (
                                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                        {customer.levelName}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                <InfoRow label="Họ tên" value={customer.name || "Khách thành viên"} />
                                {customer.phone && <InfoRow label="Số điện thoại" value={customer.phone} />}
                                {customer.memberCode && <InfoRow label="Mã thành viên" value={customer.memberCode} />}
                                {customer.uid && <InfoRow label="UID" value={customer.uid} />}
                            </div>
                        </div>
                    ) : customer.name ? (
                        <div className="p-3 bg-[var(--color-surface-hover)] rounded-xl space-y-1">
                            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Khách hàng</p>
                            <p className="text-sm text-[var(--color-text-primary)]">{customer.name}</p>
                            {customer.phone && (
                                <p className="text-xs text-[var(--color-text-muted)]">📞 {customer.phone}</p>
                            )}
                        </div>
                    ) : null}

                    {/* Danh sách sản phẩm */}
                    <div>
                        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2">Sản phẩm</p>
                        <ul className="space-y-2">
                            {order.items.map((item, idx) => (
                                <li key={idx} className="flex items-center justify-between py-2 px-3 bg-[var(--color-surface-hover)] rounded-xl">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-[var(--color-text-primary)] truncate">{item.goodsName}</p>
                                        <p className="text-xs text-[var(--color-text-muted)]">{formatCurrency(item.price)} × {item.quantity}</p>
                                        {(item.ticketCodes?.length ?? 0) > 0 && <p className="mt-0.5 text-xs font-bold text-emerald-600">{item.ticketCodes?.length} vé</p>}
                                        {(item.luckyDrawTicketsPerUnit ?? 0) > 0 && <p className="mt-0.5 text-xs font-bold text-amber-600">{(item.luckyDrawTicketsPerUnit ?? 0) * item.quantity} phiếu bốc thăm</p>}
                                    </div>
                                    <span className="text-sm font-semibold text-[var(--color-accent)] ml-3">
                                        {formatCurrency(item.price * item.quantity)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Voucher */}
                    {(order.voucherCodes?.length || order.voucherCode) && (
                        <div className="flex items-center justify-between p-3 bg-amber-900/15 border border-amber-700/20 rounded-xl">
                            <div>
                                <p className="text-xs font-medium text-amber-300">Voucher: {order.voucherCodes?.join(", ") || order.voucherCode}</p>
                            </div>
                            <span className="text-sm font-medium text-amber-400">
                                -{formatCurrency(discountAmount)}
                            </span>
                        </div>
                    )}

                    {/* Sync info */}
                    <div className="p-3 bg-[var(--color-surface-hover)] rounded-xl space-y-1">
                        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Đồng bộ</p>
                        <InfoRow label="Lần thử" value={String(order.sync.retryCount)} />
                        {order.sync.syncedAt && <InfoRow label="Thời điểm" value={formatDateTime(order.sync.syncedAt)} />}
                        {order.sync.lastError && <InfoRow label="Lỗi" value={order.sync.lastError} className="text-red-400" />}
                    </div>
                </div>

                {/* Footer — Tổng tiền */}
                <div className="px-5 py-4 border-t border-[var(--color-border)] shrink-0 space-y-1">
                    <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Tạm tính</span>
                        <span>{formatCurrency(subtotalAmount)}</span>
                    </div>
                    {discountAmount > 0 && (
                        <div className="flex justify-between text-sm text-amber-400">
                            <span>Giảm giá</span>
                            <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-[var(--color-border)]">
                        <span className="text-sm font-bold text-[var(--color-text-primary)]">Tổng cộng</span>
                        <span className="text-xl font-bold text-[var(--color-accent)]">{formatCurrency(finalAmount)}</span>
                    </div>
                    <ReceiptPrintButton
                        order={order}
                        className="mt-3 flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#202124] px-4 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50"
                    />
                    {order.items.some((item) => (item.ticketCodes?.length ?? 0) > 0) && (
                        <TicketPrintButton
                            order={order}
                            className="mt-2 flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-[var(--color-accent)] bg-white px-4 text-sm font-bold text-[var(--color-accent)] active:scale-[0.98] disabled:opacity-50"
                        />
                    )}
                    {luckyDrawTicketCount > 0 && (
                        <LuckyDrawPrintButton
                            order={order}
                            label="In lại phiếu bốc thăm"
                            className="mt-2 flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-amber-500 bg-amber-50 px-4 text-sm font-bold text-amber-700 active:scale-[0.98] disabled:opacity-50"
                        />
                    )}
                    {displayStatus === "SYNC_FAILED" && (
                        <button
                            type="button"
                            onClick={onRetrySync}
                            disabled={isRetrying}
                            className="mt-3 min-h-12 w-full touch-manipulation rounded-xl bg-[var(--color-accent)] px-4 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50"
                        >
                            {isRetrying ? "Đang xếp lại..." : "Thử đồng bộ lại"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function InfoRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
    return (
        <div>
            <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
            <p className={`text-sm font-medium ${className || "text-[var(--color-text-primary)]"}`}>{value}</p>
        </div>
    );
}
