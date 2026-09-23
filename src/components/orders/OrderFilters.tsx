"use client";

// =============================================================================
// OrderFilters — Bộ lọc đơn hàng trong ngày được chọn
// =============================================================================

export interface OrderFilterState {
    searchQuery: string;
    sortBy: "newest" | "oldest" | "highest" | "lowest";
    statusFilter: string;
    paymentMethodFilter: string;
    employeeFilter: string;
}

export interface OrderEmployeeOption {
    id: string;
    name: string;
}

interface OrderFiltersProps {
    filters: OrderFilterState;
    selectedDate: string;
    maxDate: string;
    warehouseName: string;
    employees: OrderEmployeeOption[];
    onChange: (filters: OrderFilterState) => void;
    onDateChange: (selectedDate: string) => void;
}

export const DEFAULT_FILTERS: OrderFilterState = {
    searchQuery: "",
    sortBy: "newest",
    statusFilter: "all",
    paymentMethodFilter: "all",
    employeeFilter: "all",
};

const STATUS_TABS = [
    { id: "all", label: "Tất cả" },
    { id: "SYNC_SUCCESS", label: "Đã đồng bộ" },
    { id: "REFUNDED", label: "Đã hoàn tiền" },
    { id: "REFUNDING", label: "Đang hoàn tiền" },
    { id: "REFUND_UNKNOWN", label: "Cần đối soát hoàn tiền" },
    { id: "LOCAL_PAID", label: "Chờ đồng bộ" },
    { id: "SYNCING", label: "Đang đồng bộ" },
    { id: "SYNC_FAILED", label: "Lỗi đồng bộ" },
];

const PAYMENT_METHODS = [
    { id: "all", label: "Tất cả phương thức" },
    { id: "CASH", label: "Tiền mặt" },
    { id: "QR_CODE", label: "Chuyển khoản / QR" },
];

const OrderFilters: React.FC<OrderFiltersProps> = ({
    filters,
    selectedDate,
    maxDate,
    warehouseName,
    employees,
    onChange,
    onDateChange,
}) => {
    const update = (partial: Partial<OrderFilterState>) => {
        onChange({ ...filters, ...partial });
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto lg:grid-cols-4">
                    <label className="flex items-center gap-2">
                        <span className="whitespace-nowrap text-xs font-semibold text-[var(--color-text-muted)]">
                            Ngày:
                        </span>
                        <input
                            type="date"
                            value={selectedDate}
                            max={maxDate}
                            onChange={(event) => {
                                if (event.target.value) onDateChange(event.target.value);
                            }}
                            required
                            className="min-h-10 min-w-0 flex-1 cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent)] md:text-sm"
                            aria-label="Ngày xem lịch sử đơn hàng"
                        />
                    </label>
                    <label className="flex items-center gap-2">
                        <span className="whitespace-nowrap text-xs font-semibold text-[var(--color-text-muted)]">
                            Trạng thái:
                        </span>
                        <select
                            value={filters.statusFilter}
                            onChange={(event) => update({ statusFilter: event.target.value })}
                            className="min-h-10 min-w-0 flex-1 cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent)] md:text-sm"
                        >
                            {STATUS_TABS.map((tab) => (
                                <option key={tab.id} value={tab.id}>
                                    {tab.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2">
                        <span className="sr-only">Phương thức thanh toán</span>
                        <select
                            value={filters.paymentMethodFilter}
                            onChange={(event) => update({ paymentMethodFilter: event.target.value })}
                            className="min-h-10 min-w-0 flex-1 cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent)] md:text-sm"
                        >
                            {PAYMENT_METHODS.map((method) => (
                                <option key={method.id} value={method.id}>
                                    {method.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2">
                        <span className="sr-only">Nhân viên</span>
                        <select
                            value={filters.employeeFilter}
                            onChange={(event) => update({ employeeFilter: event.target.value })}
                            className="min-h-10 min-w-0 flex-1 cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent)] md:text-sm"
                        >
                            <option value="all">Tất cả nhân viên</option>
                            {employees.map((employee) => (
                                <option key={employee.id} value={employee.id}>
                                    {employee.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <span
                    className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-orange-500/10 px-3 text-xs font-bold text-[var(--color-accent)]"
                    title={warehouseName}
                >
                    <svg className="size-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15l-.75 4.5a3 3 0 0 1-5.25 1.5 3 3 0 0 1-5.25 0A3 3 0 0 1 3 7.5L4.5 3Zm.75 7.5V21m13.5-10.5V21M9 21v-6h6v6" />
                    </svg>
                    <span className="truncate">Cửa hàng: {warehouseName}</span>
                </span>
            </div>

            <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative flex items-center">
                    <svg
                        className="pointer-events-none absolute left-3.5 size-4 text-[var(--color-text-muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                        type="search"
                        value={filters.searchQuery}
                        onChange={(event) => update({ searchQuery: event.target.value })}
                        placeholder="Tìm theo mã đơn, sản phẩm, tên, SĐT hoặc mã thành viên..."
                        aria-label="Tìm đơn hàng trong ngày đã chọn"
                        className="min-h-10 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-10 pr-3 text-xs text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] md:text-sm"
                    />
                </div>

                <select
                    value={filters.sortBy}
                    onChange={(event) => update({ sortBy: event.target.value as OrderFilterState["sortBy"] })}
                    aria-label="Sắp xếp đơn hàng"
                    className="min-h-10 cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)]"
                >
                    <option value="newest">Mới nhất</option>
                    <option value="oldest">Cũ nhất</option>
                    <option value="highest">Giá giảm dần</option>
                    <option value="lowest">Giá tăng dần</option>
                </select>
            </div>
        </div>
    );
};

export default OrderFilters;
