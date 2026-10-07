"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import {
    Banknote,
    CalendarDays,
    Clock3,
    Package,
    QrCode,
    ReceiptText,
    RefreshCw,
    Store,
    UserRound,
    UsersRound,
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import CloseoutPrintButton from "@/features/shift-close/components/CloseoutPrintButton";
import { buildCloseoutReport } from "@/features/shift-close/helpers/buildCloseoutReport";
import type {
    CloseoutPeriodMode,
    CloseoutReport,
    CloseoutReportMeta,
} from "@/features/shift-close/types/closeout";
import { useAuth } from "@/lib/contexts/AuthContext";
import {
    fetchCloseoutOrders,
    type CloseoutAccountScope,
} from "@/lib/services/orderService";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { showError, showWarning } from "@/lib/utils/toast";
import { checkPendingPayOSOrder } from "@/features/payments/api/payOSReconciliationApi";

const fieldClassName = "min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm focus:border-[var(--color-accent)] focus:outline-none";

interface ReportRange {
    startAt: string;
    endAt: string;
}

function toDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function toDateTimeInput(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${toDateInput(date)}T${hours}:${minutes}`;
}

function buildReportRange(
    periodMode: CloseoutPeriodMode,
    selectedDate: string,
    shiftStart: string,
    shiftEnd: string,
): ReportRange {
    if (periodMode === "DAY") {
        const start = new Date(`${selectedDate}T00:00:00`);
        if (Number.isNaN(start.getTime())) {
            throw new Error("Vui lòng chọn ngày cần báo cáo.");
        }
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { startAt: start.toISOString(), endAt: end.toISOString() };
    }

    const start = new Date(shiftStart);
    const end = new Date(shiftEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Vui lòng nhập đầy đủ giờ bắt đầu và kết thúc ca.");
    }
    if (start >= end) {
        throw new Error("Giờ kết thúc ca phải sau giờ bắt đầu.");
    }
    if (end.getTime() - start.getTime() > 48 * 60 * 60 * 1000) {
        throw new Error("Một báo cáo ca không được dài quá 48 giờ.");
    }
    return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(value));
}

function getReportError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "Không thể tải dữ liệu kết ca. Vui lòng kiểm tra kết nối và thử lại.";
}

const ShiftClosePage: React.FC = () => {
    const router = useRouter();
    const {
        user,
        userDoc,
        effectiveWarehouseId,
        effectiveWarehouseName,
        isLoading: authLoading,
        logout,
    } = useAuth();
    const initialLoadKeyRef = useRef<string | null>(null);
    const [periodMode, setPeriodMode] = useState<CloseoutPeriodMode>("DAY");
    const [accountScope, setAccountScope] = useState<CloseoutAccountScope>("CURRENT_USER");
    const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
    const [shiftStart, setShiftStart] = useState(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return toDateTimeInput(start);
    });
    const [shiftEnd, setShiftEnd] = useState(() => toDateTimeInput(new Date()));
    const [report, setReport] = useState<CloseoutReport | null>(null);
    const [reportMeta, setReportMeta] = useState<CloseoutReportMeta | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        if (!authLoading && (!user || !userDoc)) router.replace("/login");
    }, [authLoading, router, user, userDoc]);

    const loadReport = useCallback(async () => {
        if (!user || !userDoc || !effectiveWarehouseId) return;

        let range: ReportRange;
        try {
            range = buildReportRange(periodMode, selectedDate, shiftStart, shiftEnd);
        } catch (error: unknown) {
            showError("Bộ lọc chưa hợp lệ", getReportError(error));
            return;
        }

        setIsLoading(true);
        setLoadError(null);
        try {
            const result = await fetchCloseoutOrders({
                ...range,
                warehouseId: effectiveWarehouseId,
                scope: accountScope,
            });
            const nextReport = buildCloseoutReport(result.orders);
            setReport(nextReport);
            if (result.reconciliationIncomplete) {
                showWarning("Chưa kiểm tra hết các đơn PayOS", "Báo cáo vẫn liệt kê các đơn chờ đối soát. Vui lòng làm mới để tiếp tục kiểm tra.");
            }
            const nextMeta: CloseoutReportMeta = {
                periodMode,
                accountScope,
                ...range,
                warehouseName: effectiveWarehouseName || effectiveWarehouseId,
                accountLabel:
                    accountScope === "CURRENT_USER"
                        ? userDoc.full_name
                        : "Tất cả tài khoản",
                generatedBy: userDoc.full_name,
                fetchedAt: result.fetchedAt,
            };
            setReportMeta(nextMeta);
            return { report: nextReport, meta: nextMeta };
        } catch (error: unknown) {
            console.error("[Kết ca] Không thể tải báo cáo:", error);
            const message = getReportError(error);
            setLoadError(message);
            setReport(null);
            setReportMeta(null);
            showError("Không thể tải báo cáo", message);
        } finally {
            setIsLoading(false);
        }
    }, [
        accountScope,
        effectiveWarehouseId,
        effectiveWarehouseName,
        periodMode,
        selectedDate,
        shiftEnd,
        shiftStart,
        user,
        userDoc,
    ]);

    useEffect(() => {
        if (!user || !userDoc || !effectiveWarehouseId) return;
        const loadKey = `${user.uid}:${effectiveWarehouseId}`;
        if (initialLoadKeyRef.current === loadKey) return;
        initialLoadKeyRef.current = loadKey;
        void loadReport();
    }, [effectiveWarehouseId, loadReport, user, userDoc]);

    const reportPeriodLabel = useMemo(() => {
        if (!reportMeta) return "Chưa có dữ liệu";
        if (reportMeta.periodMode === "DAY") {
            return new Intl.DateTimeFormat("vi-VN", {
                weekday: "long",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
            }).format(new Date(reportMeta.startAt));
        }
        return `${formatDateTime(reportMeta.startAt)} – ${formatDateTime(reportMeta.endAt)}`;
    }, [reportMeta]);

    const hasPendingFilterChanges = useMemo(() => {
        if (!reportMeta) return false;
        try {
            const range = buildReportRange(periodMode, selectedDate, shiftStart, shiftEnd);
            return (
                reportMeta.periodMode !== periodMode ||
                reportMeta.accountScope !== accountScope ||
                reportMeta.startAt !== range.startAt ||
                reportMeta.endAt !== range.endAt
            );
        } catch {
            return true;
        }
    }, [accountScope, periodMode, reportMeta, selectedDate, shiftEnd, shiftStart]);

    return (
        <div className="flex h-screen bg-[var(--color-background)]">
            <Sidebar onLogout={logout} />

            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-5 py-3 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-[var(--color-accent)]">
                            <ReceiptText className="size-5" aria-hidden="true" />
                        </div>
                        <div>
                            <h1 className="text-lg font-extrabold tracking-tight text-[var(--color-text-primary)]">Kết ca</h1>
                            <p className="text-xs text-[var(--color-text-muted)]">Tổng hợp hàng đã bán và doanh thu tại quầy</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void loadReport()}
                            disabled={isLoading || authLoading}
                            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-white px-3.5 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                        >
                            <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                            Làm mới
                        </button>
                        <CloseoutPrintButton
                            report={hasPendingFilterChanges || isLoading ? null : report}
                            meta={hasPendingFilterChanges ? null : reportMeta}
                            refreshBeforePrint={loadReport}
                            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#202124] px-4 text-xs font-bold text-white shadow-md transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                        />
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="mx-auto space-y-3">
                        <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm" aria-label="Bộ lọc báo cáo">
                            <div className="grid gap-4 xl:grid-cols-[280px_minmax(330px,1fr)_260px_auto] xl:items-end">
                                <fieldset>
                                    <legend className="mb-1.5 text-xs font-bold text-[var(--color-text-secondary)]">Thời gian báo cáo</legend>
                                    <div className="grid grid-cols-2 rounded-xl bg-[var(--color-background)] p-1">
                                        <SegmentButton active={periodMode === "SHIFT"} onClick={() => setPeriodMode("SHIFT")} icon={<Clock3 className="size-4" />}>Theo ca</SegmentButton>
                                        <SegmentButton active={periodMode === "DAY"} onClick={() => setPeriodMode("DAY")} icon={<CalendarDays className="size-4" />}>Theo ngày</SegmentButton>
                                    </div>
                                </fieldset>

                                {periodMode === "DAY" ? (
                                    <label className="grid gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">
                                        Chọn ngày
                                        <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className={fieldClassName} />
                                    </label>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <label className="grid gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">Bắt đầu ca<input type="datetime-local" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} className={fieldClassName} /></label>
                                        <label className="grid gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">Kết thúc ca<input type="datetime-local" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} className={fieldClassName} /></label>
                                    </div>
                                )}

                                <fieldset>
                                    <legend className="mb-1.5 text-xs font-bold text-[var(--color-text-secondary)]">Phạm vi nhân viên</legend>
                                    <div className="grid grid-cols-2 rounded-xl bg-[var(--color-background)] p-1">
                                        <SegmentButton active={accountScope === "CURRENT_USER"} onClick={() => setAccountScope("CURRENT_USER")} icon={<UserRound className="size-4" />}>Của tôi</SegmentButton>
                                        <SegmentButton active={accountScope === "ALL_USERS"} onClick={() => setAccountScope("ALL_USERS")} icon={<UsersRound className="size-4" />}>Tất cả</SegmentButton>
                                    </div>
                                </fieldset>

                                <button
                                    type="button"
                                    onClick={() => void loadReport()}
                                    disabled={isLoading || !effectiveWarehouseId}
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 text-sm font-extrabold text-white shadow-[var(--shadow-glow)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                                >
                                    {isLoading ? <RefreshCw className="size-4 animate-spin" /> : <ReceiptText className="size-4" />}
                                    Tải báo cáo
                                </button>
                            </div>
                        </section>

                        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">
                            <div className="flex items-center gap-3">
                                <span className="flex size-9 items-center justify-center rounded-xl bg-white text-[var(--color-accent)] shadow-sm"><Store className="size-4" /></span>
                                <div><p className="text-xs font-semibold text-orange-700">{effectiveWarehouseName || "Điểm bán"}</p><p className="text-sm font-extrabold capitalize text-[var(--color-text-primary)]">{reportPeriodLabel}</p></div>
                            </div>
                            <div className="text-right"><p className="text-xs text-[var(--color-text-muted)]">Phạm vi</p><p className="text-sm font-bold text-[var(--color-text-primary)]">{reportMeta?.accountLabel || (accountScope === "CURRENT_USER" ? userDoc?.full_name : "Tất cả tài khoản")}</p></div>
                        </section>

                        {hasPendingFilterChanges && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">
                                Bộ lọc đã thay đổi. Chọn “Xem báo cáo” để cập nhật số liệu trước khi in.
                            </div>
                        )}

                        {loadError && (
                            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{loadError}</div>
                        )}

                        <section className="grid gap-3 sm:grid-cols-3" aria-label="Tổng quan báo cáo">
                            <MetricCard icon={<ReceiptText className="size-5" />} label="Đơn đã thanh toán" value={(report?.orderCount || 0).toLocaleString("vi-VN")} tone="blue" />
                            <MetricCard icon={<Package className="size-5" />} label="Sản phẩm đã bán" value={(report?.productQuantity || 0).toLocaleString("vi-VN")} tone="violet" />
                            <MetricCard icon={<Banknote className="size-5" />} label="Tổng doanh thu" value={formatCurrency(report?.totalRevenue || 0)} tone="orange" emphasized />
                        </section>

                        {report && (
                            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Đối soát PayOS khi kết ca">
                                <h2 className="font-bold">Đối soát PayOS</h2>
                                <p>PayOS đã xác nhận: {formatCurrency(report.payosVerifiedAmount)}</p>
                                <p>Chờ PayOS xác nhận: {report.payosPendingOrders.length} đơn · {formatCurrency(report.payosUnverifiedAmount)}</p>
                                {report.payosPendingOrders.length > 0 && <p role="alert" className="mt-2 font-bold">Các đơn dưới đây đã hoàn thành thủ công nhưng PayOS chưa xác nhận đã nhận đủ tiền. Cần đối chiếu trước khi kết ca.</p>}
                                {report.payosPendingOrders.map((order) => (
                                    <div key={order.localOrderId} className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
                                        <p className="break-all font-semibold">{order.localOrderId} · {formatCurrency(order.totalAmount)}</p>
                                        <p>{order.operatorName} · Hoàn thành: {order.completedAt ? formatDateTime(order.completedAt) : "Chưa rõ"}</p>
                                        <p>Kiểm tra gần nhất: {order.lastCheckedAt ? formatDateTime(order.lastCheckedAt) : "Chưa kiểm tra"}</p>
                                        {order.lastError && <p className="text-red-700">{order.lastError}</p>}
                                        <button type="button" disabled={isLoading} className="mt-2 rounded border px-3 py-1 font-semibold" onClick={() => {
                                            setIsLoading(true);
                                            void checkPendingPayOSOrder(order.localOrderId)
                                                .then(() => loadReport())
                                                .catch((error: unknown) => showError("Không thể kiểm tra PayOS", getReportError(error)))
                                                .finally(() => setIsLoading(false));
                                        }}>Kiểm tra lại</button>
                                    </div>
                                ))}
                            </section>
                        )}

                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
                            <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
                                <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                                    <div><h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">Sản phẩm đã bán</h2><p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Cộng số lượng từ các đơn đã thanh toán trong kỳ</p></div>
                                    <span className="rounded-lg bg-[var(--color-background)] px-2.5 py-1 text-xs font-bold text-[var(--color-text-secondary)]">{report?.products.length || 0} mặt hàng</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse text-left">
                                        <thead className="bg-[var(--color-surface-alt)] text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                                            <tr><th className="w-14 px-4 py-3 font-bold">STT</th><th className="px-4 py-3 font-bold">Tên sản phẩm</th><th className="px-4 py-3 font-bold">Mã sản phẩm</th><th className="w-32 px-4 py-3 text-right font-bold">Số lượng</th></tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--color-border)]">
                                            {isLoading && !report ? (
                                                Array.from({ length: 5 }, (_, index) => <tr key={index}><td colSpan={4} className="px-4 py-3"><div className="skeleton h-8 w-full" /></td></tr>)
                                            ) : report?.products.length ? report.products.map((product, index) => (
                                                <tr key={product.goodsId} className="hover:bg-[var(--color-surface-hover)]"><td className="px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)]">{index + 1}</td><td className="px-4 py-3 text-sm font-bold text-[var(--color-text-primary)]">{product.goodsName}</td><td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">{product.goodsId}</td><td className="px-4 py-3 text-right text-base font-extrabold text-[var(--color-text-primary)]">{product.quantity.toLocaleString("vi-VN")}</td></tr>
                                            )) : (
                                                <tr><td colSpan={4} className="px-4 py-14 text-center"><Package className="mx-auto mb-2 size-7 text-[var(--color-text-muted)]" /><p className="text-sm font-bold text-[var(--color-text-secondary)]">Chưa có sản phẩm đã bán</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">Hãy kiểm tra lại thời gian và phạm vi tài khoản.</p></td></tr>
                                            )}
                                        </tbody>
                                        <tfoot className="border-t-2 border-[var(--color-border-subtle)] bg-[var(--color-surface-alt)]"><tr><td colSpan={3} className="px-4 py-3 text-sm font-extrabold text-[var(--color-text-primary)]">Tổng số lượng sản phẩm</td><td className="px-4 py-3 text-right text-lg font-black text-[var(--color-accent)]">{(report?.productQuantity || 0).toLocaleString("vi-VN")}</td></tr></tfoot>
                                    </table>
                                </div>
                            </section>

                            <aside className="space-y-4">
                                <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
                                    <div className="mb-4"><h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">Doanh thu thanh toán</h2><p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Tổng tiền theo từng phương thức</p></div>
                                    <div className="space-y-2.5">
                                        {(report?.payments || []).map((payment) => (
                                            <div key={payment.paymentMethodId} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
                                                <div className="flex min-w-0 items-center gap-3"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${payment.paymentMethodId === "CASH" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"}`}>{payment.paymentMethodId === "CASH" ? <Banknote className="size-5" /> : <QrCode className="size-5" />}</span><div className="min-w-0"><p className="truncate text-sm font-bold text-[var(--color-text-primary)]">{payment.paymentMethodName}</p><p className="text-xs text-[var(--color-text-muted)]">{payment.orderCount.toLocaleString("vi-VN")} đơn</p></div></div>
                                                <p className="shrink-0 text-sm font-extrabold text-[var(--color-text-primary)]">{formatCurrency(payment.totalAmount)}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4 flex items-end justify-between gap-4 border-t-2 border-[var(--color-text-primary)] pt-4"><div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Tổng doanh thu</p><p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{report?.orderCount || 0} đơn đã thanh toán</p></div><p className="text-xl font-black text-[var(--color-accent)]">{formatCurrency(report?.totalRevenue || 0)}</p></div>
                                </section>

                                {reportMeta?.accountScope === "ALL_USERS" && report && report.operatorNames.length > 0 && (
                                    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
                                        <div className="mb-3 flex items-center gap-2"><UsersRound className="size-4 text-[var(--color-text-muted)]" /><h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">Nhân viên có bán hàng</h2></div>
                                        <div className="flex flex-wrap gap-2">{report.operatorNames.map((name) => <span key={name} className="rounded-lg bg-[var(--color-background)] px-2.5 py-1.5 text-xs font-bold text-[var(--color-text-secondary)]">{name}</span>)}</div>
                                    </section>
                                )}
                            </aside>
                        </div>

                        {reportMeta && <p className="pb-1 text-right text-[11px] text-[var(--color-text-muted)]">Dữ liệu cập nhật lúc {formatDateTime(reportMeta.fetchedAt)} · chỉ tính đơn đã thanh toán</p>}
                    </div>
                </div>
            </main>
        </div>
    );
};

interface SegmentButtonProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}

const SegmentButton: React.FC<SegmentButtonProps> = ({ active, onClick, icon, children }) => (
    <button type="button" onClick={onClick} className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold transition-all ${active ? "bg-white text-[var(--color-accent)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}>{icon}{children}</button>
);

interface MetricCardProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    tone: "blue" | "violet" | "orange";
    emphasized?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, tone, emphasized = false }) => {
    const toneClassName = tone === "blue" ? "bg-blue-50 text-blue-600" : tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-orange-50 text-[var(--color-accent)]";
    return <div className={`flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm ${emphasized ? "border-orange-200" : "border-[var(--color-border)]"}`}><span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${toneClassName}`}>{icon}</span><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p><p className={`mt-0.5 truncate text-xl font-black ${emphasized ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"}`}>{value}</p></div></div>;
};

export default ShiftClosePage;
