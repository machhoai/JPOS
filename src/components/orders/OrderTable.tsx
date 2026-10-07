"use client";

// =============================================================================
// OrderTable (OrderCardList) — Danh sách đơn hàng dạng Row Card
// =============================================================================

import type { PosOrder } from "@/lib/types/order";
import OrderCardRow from "./OrderCardRow";

interface OrderTableProps {
    orders: PosOrder[];
    onSelectOrder: (order: PosOrder) => void;
    onRetrySync?: (order: PosOrder, e: React.MouseEvent) => void;
    isLoading?: boolean;
    highlightedOrderId?: string | null;
}

export default function OrderTable({
    orders,
    onSelectOrder,
    onRetrySync,
    isLoading = false,
    highlightedOrderId,
}: OrderTableProps) {
    // Skeleton loading state
    if (isLoading) {
        return (
            <div className="space-y-3 p-6">
                {[1, 2, 3, 4, 5].map((idx) => (
                    <div
                        key={idx}
                        className="h-24 w-full skeleton rounded-2xl border border-[var(--color-border)]"
                    />
                ))}
            </div>
        );
    }

    // Empty state
    if (orders.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="w-16 h-16 rounded-3xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-[var(--color-accent)] mb-4">
                    <svg className="w-8 h-8 opacity-80" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.25 10.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm7.5 0a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
                    </svg>
                </div>
                <h3 className="text-base font-bold text-[var(--color-text-primary)]">Chưa có đơn hàng nào</h3>
                <p className="text-xs text-[var(--color-text-muted)] max-w-sm mt-1">
                    Không tìm thấy đơn hàng hôm nay phù hợp với trạng thái hoặc nội dung tìm kiếm.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3 mx-auto">
            {orders.map((order) => (
                <OrderCardRow
                    key={order.localOrderId}
                    order={order}
                    onSelectOrder={onSelectOrder}
                    onRetrySync={onRetrySync}
                    isHighlighted={order.localOrderId === highlightedOrderId}
                />
            ))}
        </div>
    );
}
