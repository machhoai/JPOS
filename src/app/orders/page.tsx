"use client";

// =============================================================================
// Trang Lịch sử Đơn hàng — /orders (Giao diện Row Card Hiện Đại)
// =============================================================================

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/AuthContext";
import { useOrderHistoryStore } from "@/lib/stores/useOrderHistoryStore";
import type { PosOrder } from "@/lib/types/order";
import Sidebar from "@/components/layout/Sidebar";
import OrderFilters, { DEFAULT_FILTERS, type OrderFilterState } from "@/components/orders/OrderFilters";
import OrderTable from "@/components/orders/OrderTable";
import OrderDetailModal from "@/components/orders/OrderDetailModal";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { filterAndSortOrders } from "@/lib/utils/filterOrders";
import {
    getOrderDisplayStatus,
    isOrderRevenueEligible,
} from "@/lib/utils/orderLifecycle";
import { retryOrderSync } from "@/lib/services/orderService";
import { showError, showPromise } from "@/lib/utils/toast";
import { useLuckyDrawSettingsSync } from "@/features/lucky-draw/hooks/useLuckyDrawSettingsSync";
import { ORDER_HISTORY_READ_PERMISSION } from "@/lib/auth/permissions";
import {
    formatOrderHistoryDate,
    getVietnamDateInputValue,
    getOrderHistoryDayRange,
} from "@/lib/utils/orderHistoryDate";

const EMPTY_ORDERS: PosOrder[] = [];

export default function OrderHistoryPage() {
    const router = useRouter();
    const {
        user,
        userDoc,
        effectiveWarehouseId,
        effectiveWarehouseName,
        isLoading: authLoading,
        hasPermission,
        logout,
    } = useAuth();
    useLuckyDrawSettingsSync(effectiveWarehouseId);
    const [filters, setFilters] = useState<OrderFilterState>(DEFAULT_FILTERS);
    const [selectedDate, setSelectedDate] = useState(() => getVietnamDateInputValue());
    const [selectedOrder, setSelectedOrder] = useState<PosOrder | null>(null);
    const [isRetrying, setIsRetrying] = useState(false);

    // Zustand store
    const orders = useOrderHistoryStore((state) =>
        Array.isArray(state.orders) ? state.orders : EMPTY_ORDERS
    );
    const isLoadingOrders = useOrderHistoryStore((state) => state.isLoading);
    const orderError = useOrderHistoryStore((state) => state.error);
    const fetchOrders = useOrderHistoryStore((state) => state.fetchOrders);
    const canReadOrderHistory = hasPermission(
        ORDER_HISTORY_READ_PERMISSION,
        effectiveWarehouseId || undefined,
    );
    const historyQuery = useMemo(() => {
        if (!effectiveWarehouseId) return null;
        const range = getOrderHistoryDayRange(selectedDate);
        return { warehouseId: effectiveWarehouseId, ...range };
    }, [effectiveWarehouseId, selectedDate]);

    // Auth guard
    useEffect(() => {
        if (!authLoading && (!user || !userDoc)) {
            router.replace("/login");
        }
    }, [authLoading, user, userDoc, router]);

    useEffect(() => {
        if (!user || !userDoc || !canReadOrderHistory || !historyQuery) return;
        void fetchOrders(historyQuery).catch(() => {
            showError(
                "Không thể tải lịch sử đơn",
                "Vui lòng kiểm tra kết nối và thử lại.",
            );
        });
    }, [user, userDoc, canReadOrderHistory, historyQuery, fetchOrders]);

    const employeeOptions = useMemo(() => {
        const employees = new Map<string, string>();
        const todayOrders = effectiveWarehouseId
            ? filterAndSortOrders(orders, DEFAULT_FILTERS, effectiveWarehouseId)
            : [];
        todayOrders.forEach((order) => {
            const employeeId = order.createdBy || order.operatorFirebaseUid;
            if (!employeeId) return;
            employees.set(
                employeeId,
                order.operatorName?.trim() || order.operatorId?.trim() || employeeId,
            );
        });
        return Array.from(employees, ([id, name]) => ({ id, name })).sort(
            (left, right) => left.name.localeCompare(right.name, "vi"),
        );
    }, [effectiveWarehouseId, orders]);

    const effectiveFilters = useMemo(
        () => filters.employeeFilter === "all" ||
            employeeOptions.some((employee) => employee.id === filters.employeeFilter)
            ? filters
            : { ...filters, employeeFilter: "all" },
        [employeeOptions, filters],
    );

    const filteredOrders = useMemo(
        () => effectiveWarehouseId
            ? filterAndSortOrders(orders, effectiveFilters, effectiveWarehouseId)
            : [],
        [effectiveFilters, effectiveWarehouseId, orders],
    );

    const handleRetrySync = useCallback(async (orderToRetry?: PosOrder) => {
        const targetOrder = orderToRetry || selectedOrder;
        if (!targetOrder) return;
        setIsRetrying(true);
        try {
            await showPromise(retryOrderSync(targetOrder.localOrderId), {
                loading: "Đang xếp lại đơn...",
                success: "Đã xếp lại đơn",
                error: "Không thể đồng bộ lại",
                successDescription: "Hệ thống sẽ tiếp tục thanh toán đơn ở chế độ nền.",
                errorDescription: "Vui lòng kiểm tra cấu hình thanh toán và thử lại.",
            });
            if (historyQuery) {
                await fetchOrders(historyQuery);
            }
            if (selectedOrder && selectedOrder.localOrderId === targetOrder.localOrderId) {
                setSelectedOrder(null);
            }
        } catch (error: unknown) {
            console.error("[Lịch sử đơn] Không thể đồng bộ lại:", error);
        } finally {
            setIsRetrying(false);
        }
    }, [selectedOrder, fetchOrders, historyQuery]);

    // Stats calculation
    const totalRevenue = useMemo(
        () => filteredOrders.reduce(
            (sum, order) => isOrderRevenueEligible(order) ? sum + order.totalAmount : sum,
            0,
        ),
        [filteredOrders]
    );

    const successCount = useMemo(
        () => filteredOrders.filter(
            (order) => getOrderDisplayStatus(order) === "SYNC_SUCCESS",
        ).length,
        [filteredOrders]
    );

    const pendingOrFailedCount = useMemo(
        () => filteredOrders.filter((order) => {
            const status = getOrderDisplayStatus(order);
            return status === "LOCAL_PAID" || status === "SYNC_FAILED" || status === "SYNCING";
        }).length,
        [filteredOrders]
    );

    if (authLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[var(--color-background)]">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                    <div className="text-sm font-semibold text-[var(--color-text-muted)]">Đang tải ứng dụng...</div>
                </div>
            </div>
        );
    }

    if (user && userDoc && !canReadOrderHistory) {
        return (
            <div className="flex h-screen bg-[var(--color-background)]">
                <Sidebar onLogout={logout} />
                <main className="flex flex-1 items-center justify-center p-6">
                    <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-7 text-center shadow-sm">
                        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700" aria-hidden="true">
                            <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5A2.25 2.25 0 0 1 19.5 12.75v6A2.25 2.25 0 0 1 17.25 21H6.75A2.25 2.25 0 0 1 4.5 18.75v-6a2.25 2.25 0 0 1 2.25-2.25Z" />
                            </svg>
                        </div>
                        <h1 className="mt-4 text-xl font-extrabold text-[var(--color-text-primary)]">
                            Chưa được cấp quyền xem lịch sử đơn
                        </h1>
                        <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                            Tài khoản cần quyền <code>{ORDER_HISTORY_READ_PERMISSION}</code> tại cửa hàng này. Vui lòng liên hệ quản trị viên POS.
                        </p>
                        <button
                            type="button"
                            onClick={() => router.replace("/")}
                            className="mt-6 min-h-11 rounded-xl bg-[var(--color-accent)] px-5 text-sm font-bold text-white"
                        >
                            Về trang bán hàng
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-[var(--color-background)]">
            <Sidebar onLogout={logout} />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <header className="py-2 px-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-4 mx-auto">
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight">
                                    Lịch sử đơn hàng
                                </h1>
                            </div>
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                Theo dõi và tra cứu đơn hàng POS ngày {formatOrderHistoryDate(selectedDate)}
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => historyQuery && void fetchOrders(historyQuery)}
                            disabled={isLoadingOrders || !historyQuery}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] hover:bg-[var(--color-surface-hover)] text-sm font-bold text-[var(--color-text-primary)] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 shadow-sm"
                        >
                            <svg
                                className={`w-4 h-4 text-[var(--color-text-secondary)] ${isLoadingOrders ? "animate-spin" : ""}`}
                                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            {isLoadingOrders ? "Đang tải..." : "Làm mới"}
                        </button>
                    </div>
                </header>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto">
                    <div className="mx-auto space-y-4 p-2 pt-3">
                        {/* Top KPI Metric Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-3">
                            {/* KPI 1: Total Orders */}
                            <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.25 10.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm7.5 0a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Tổng đơn hàng</p>
                                    <p className="text-lg md:text-xl font-extrabold text-[var(--color-text-primary)]">
                                        {filteredOrders.length}
                                    </p>
                                </div>
                            </div>

                            {/* KPI 2: Total Revenue */}
                            <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-[var(--color-accent)] flex items-center justify-center shrink-0">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Doanh thu thành công</p>
                                    <p className="text-lg md:text-xl font-extrabold text-[var(--color-accent)]">
                                        {formatCurrency(totalRevenue)}
                                    </p>
                                </div>
                            </div>

                            {/* KPI 3: Synced Count */}
                            <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Đã đồng bộ</p>
                                    <p className="text-lg md:text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                                        {successCount}
                                    </p>
                                </div>
                            </div>

                            {/* KPI 4: Pending / Failed */}
                            <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Chờ / Lỗi đồng bộ</p>
                                    <p className="text-lg md:text-xl font-extrabold text-amber-600 dark:text-amber-400">
                                        {pendingOrFailedCount}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Filters Bar */}
                        <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm">
                            <OrderFilters
                                filters={effectiveFilters}
                                selectedDate={selectedDate}
                                maxDate={getVietnamDateInputValue()}
                                warehouseName={effectiveWarehouseName || "Chưa chọn cửa hàng"}
                                employees={employeeOptions}
                                onChange={setFilters}
                                onDateChange={setSelectedDate}
                            />
                        </div>

                        {/* Row Cards List */}
                        {orderError && orders.length === 0 ? (
                            <div className="p-8 text-center bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-sm font-semibold">
                                {orderError}
                            </div>
                        ) : (
                            <OrderTable
                                orders={filteredOrders}
                                onSelectOrder={setSelectedOrder}
                                onRetrySync={(order) => void handleRetrySync(order)}
                                isLoading={isLoadingOrders && orders.length === 0}
                            />
                        )}
                    </div>
                </div>
            </main>

            {/* Detail Modal */}
            {selectedOrder && (
                <OrderDetailModal
                    order={selectedOrder}
                    isRetrying={isRetrying}
                    onRetrySync={() => void handleRetrySync()}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
}
