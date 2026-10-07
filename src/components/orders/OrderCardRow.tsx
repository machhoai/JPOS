"use client";

// =============================================================================
// OrderCardRow — Thẻ đơn hàng dạng hàng (Row Card)
// =============================================================================

import type { PosOrder } from "@/lib/types/order";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getOrderCustomerDisplay } from "@/lib/utils/orderCustomer";
import {
    getOrderDisplayStatus,
    type OrderDisplayStatus,
} from "@/lib/utils/orderLifecycle";
import { IoCash, IoQrCode } from "react-icons/io5";

interface OrderCardRowProps {
    order: PosOrder;
    onSelectOrder: (order: PosOrder) => void;
    onRetrySync?: (order: PosOrder, e: React.MouseEvent) => void;
    isHighlighted?: boolean;
}

const STATUS_CONFIG: Record<
    OrderDisplayStatus,
    { label: string; bgClass: string; textClass: string; borderLeftClass: string; dotClass: string }
> = {
    SYNC_SUCCESS: {
        label: "Đã đồng bộ",
        bgClass: "bg-emerald-500/10",
        textClass: "text-emerald-600 dark:text-emerald-400",
        borderLeftClass: "border-l-emerald-500",
        dotClass: "bg-emerald-500",
    },
    REFUNDED: {
        label: "Đã hoàn tiền",
        bgClass: "bg-violet-50",
        textClass: "text-violet-700",
        borderLeftClass: "border-l-violet-500",
        dotClass: "bg-violet-500",
    },
    REFUNDING: {
        label: "Đang hoàn tiền",
        bgClass: "bg-amber-50",
        textClass: "text-amber-700",
        borderLeftClass: "border-l-amber-500",
        dotClass: "bg-amber-500 animate-pulse",
    },
    REFUND_FAILED: {
        label: "Hoàn tiền thất bại",
        bgClass: "bg-red-50",
        textClass: "text-red-700",
        borderLeftClass: "border-l-red-500",
        dotClass: "bg-red-500",
    },
    REFUND_UNKNOWN: {
        label: "Cần đối soát hoàn tiền",
        bgClass: "bg-orange-50",
        textClass: "text-orange-700",
        borderLeftClass: "border-l-orange-500",
        dotClass: "bg-orange-500",
    },
    CANCELLED: {
        label: "Đã hủy",
        bgClass: "bg-slate-100",
        textClass: "text-slate-700",
        borderLeftClass: "border-l-slate-400",
        dotClass: "bg-slate-400",
    },
    LOCAL_PAID: {
        label: "Chờ đồng bộ",
        bgClass: "bg-amber-500/10",
        textClass: "text-amber-600 dark:text-amber-400",
        borderLeftClass: "border-l-amber-500",
        dotClass: "bg-amber-500 animate-pulse",
    },
    SYNCING: {
        label: "Đang đồng bộ",
        bgClass: "bg-blue-500/10",
        textClass: "text-blue-600 dark:text-blue-400",
        borderLeftClass: "border-l-blue-500",
        dotClass: "bg-blue-500 animate-ping",
    },
    SYNC_FAILED: {
        label: "Lỗi đồng bộ",
        bgClass: "bg-red-500/10",
        textClass: "text-red-600 dark:text-red-400",
        borderLeftClass: "border-l-red-500",
        dotClass: "bg-red-500",
    },
    DRAFT: {
        label: "Nháp",
        bgClass: "bg-gray-500/10",
        textClass: "text-gray-600 dark:text-gray-400",
        borderLeftClass: "border-l-gray-400",
        dotClass: "bg-gray-400",
    },
};

function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function OrderCardRow({ order, onSelectOrder, onRetrySync, isHighlighted = false }: OrderCardRowProps) {
    const displayStatus = getOrderDisplayStatus(order);
    const status = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.DRAFT;
    const isPaymentUnverified = order.paymentVerificationStatus === "UNVERIFIED";
    const shortId = order.localOrderId.split("-").pop() || order.localOrderId;
    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
    const hdId = order.hkOrderNumber;
    const customer = getOrderCustomerDisplay(order);

    const handleRetry = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRetrySync) {
            onRetrySync(order, e);
        }
    };

    return (
        <div
            id={`order-${order.localOrderId}`}
            data-order-id={order.localOrderId}
            tabIndex={-1}
            onClick={() => onSelectOrder(order)}
            className={`group relative scroll-mt-4 flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 md:px-5 md:py-2 border border-l-4 rounded-2xl transition-all duration-200 hover:shadow-md hover:translate-y-[-1px] cursor-pointer ${isHighlighted ? "ring-2 ring-orange-500 ring-offset-2" : ""} ${
                isPaymentUnverified
                    ? "bg-amber-500/15 border-amber-500/60 border-l-amber-500 hover:border-amber-500"
                    : `bg-[var(--color-surface)] border-[var(--color-border)] ${status.borderLeftClass} hover:border-[var(--color-border-subtle)]`
            }`}
        >
            {/* Left Section: Order Info & Customer */}
            <div className="flex flex-col items-start justify-center flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold font-mono text-[var(--color-text-primary)]">{shortId}</span>
                    {isPaymentUnverified && (
                        <span className="inline-flex rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-black">
                            Chưa được xác nhận thanh toán
                        </span>
                    )}
                    {/* Created Time */}
                    <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        {formatTime(order.createdAt)} • {formatDate(order.createdAt)}
                    </span>
                </div>
                {/* Main Details */}
                <div className="flex-1 min-w-0 space-y-1">

                    <span className="text-md font-bold text-[var(--color-accent)]">Mã đơn: </span>
                    <span className="text-md font-bold font-mono text-[var(--color-text-primary)]">{hdId}</span>

                    {/* Customer & Items Summary */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm pt-0.5">
                        {/* Customer */}
                        <div className="flex min-w-0 items-center gap-1.5 text-[var(--color-text-primary)] font-medium">
                            <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                            {customer.isMember ? (
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-semibold">
                                        {customer.name || "Khách thành viên"}
                                    </span>
                                    <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                        Thành viên{customer.levelName ? ` · ${customer.levelName}` : ""}
                                    </span>
                                    {(customer.phone || customer.memberCode || customer.uid) && (
                                        <span className="text-xs font-normal text-[var(--color-text-muted)]">
                                            {[customer.phone, customer.memberCode, !customer.phone && !customer.memberCode ? customer.uid : ""]
                                                .filter(Boolean)
                                                .join(" · ")}
                                        </span>
                                    )}
                                </div>
                            ) : customer.name ? (
                                <span>
                                    {customer.name}
                                    {customer.phone && (
                                        <span className="text-xs text-[var(--color-text-muted)] ml-1 font-normal">
                                            ({customer.phone})
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <span className="text-xs text-[var(--color-text-muted)] italic">Khách vãng lai</span>
                            )}
                        </div>

                        {/* Divider */}
                        <span className="hidden sm:inline text-[var(--color-border)]">•</span>

                        {/* Items preview */}
                        <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] truncate max-w-md">
                            <span className="px-1.5 py-0.5 bg-[var(--color-surface-hover)] rounded font-semibold text-[var(--color-text-primary)]">
                                {totalQty} món
                            </span>
                            <span className="truncate">
                                {order.items.map((i) => `${i.quantity}x ${i.goodsName}`).join(", ")}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Section: Price & Action */}
            <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--color-border)]">
                {/* Financial Summary */}
                <div className="text-left md:text-right">
                    <div className="flex gap-2">
                        {/* Payment Method Badge */}
                        <span className="inline-flex items-center gap-1  rounded-full text-sm font-medium text-[var(--color-text-secondary)]">
                            {order.paymentMethod === "QR_CODE" ? <IoQrCode className="size-5" /> : <IoCash className="size-5" />}
                            {order.paymentMethodName || (order.paymentMethod === "QR_CODE" ? "Chuyển khoản / QR" : "Tiền mặt")}
                        </span>
                        <div className="text-base font-extrabold text-[var(--color-accent)]">
                            {formatCurrency(order.totalAmount)}
                        </div>
                    </div>
                    {(order.discountAmount ?? order.voucherDiscount ?? 0) > 0 ? (
                        <div className="text-[11px] font-semibold text-amber-500 flex items-center md:justify-end gap-0.5">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
                            </svg>
                            Giảm {formatCurrency(order.discountAmount ?? order.voucherDiscount ?? 0)}
                        </div>
                    ) : (
                        <div className="text-[11px] text-[var(--color-text-muted)]">
                            {order.operatorName ? `NV: ${order.operatorName}` : "Đã thanh toán"}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    {displayStatus === "SYNC_FAILED" && (
                        <button
                            type="button"
                            onClick={handleRetry}
                            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors active:scale-95 flex items-center gap-1"
                            title="Thử đồng bộ lại"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            Thử lại
                        </button>
                    )}

                    <div className="w-8 h-8 rounded-xl bg-[var(--color-surface-hover)] group-hover:bg-[var(--color-accent)] group-hover:text-white text-[var(--color-text-muted)] flex items-center justify-center transition-colors">
                        <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                </div>
            </div>
        </div>
    );
}
