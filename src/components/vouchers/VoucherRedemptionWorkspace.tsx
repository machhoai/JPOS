"use client";

import Link from "next/link";
import {
    Check,
    CheckCircle2,
    Copy,
    ExternalLink,
    Gift,
    History,
    Info,
    LoaderCircle,
    Percent,
    Printer,
    ScanLine,
    Search,
    Sparkles,
    Ticket,
    TicketCheck,
    Trash2,
    TriangleAlert,
    X,
    XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
    VoucherRedemptionMode,
    VoucherRedemptionResult,
    VoucherRedemptionResultStatus,
} from "@/lib/types/voucherRedemption";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import VoucherCodeForm from "./VoucherCodeForm";

interface VoucherRedemptionWorkspaceProps {
    mode: VoucherRedemptionMode;
    results: VoucherRedemptionResult[];
    isProcessing: boolean;
    isFinalizing: boolean;
    pendingCount: number;
    batchCount: number;
    canFlush: boolean;
    warehouseId: string;
    warehouseName?: string;
    onModeChange: (mode: VoucherRedemptionMode) => void;
    onSubmit: (code: string) => void;
    onFlush: () => void;
    onReprint?: (orderId: string) => Promise<void>;
    onClearResults?: () => void;
}

const formatTime = (ts?: number): string => {
    if (!ts) return "";
    return new Intl.DateTimeFormat("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(new Date(ts));
};

export default function VoucherRedemptionWorkspace({
    mode,
    results,
    isProcessing,
    isFinalizing,
    pendingCount,
    batchCount,
    canFlush,
    warehouseId,
    warehouseName,
    onModeChange,
    onSubmit,
    onFlush,
    onReprint,
    onClearResults,
}: VoucherRedemptionWorkspaceProps) {
    const [manualCode, setManualCode] = useState("");
    const [showCodeForm, setShowCodeForm] = useState(false);
    const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
    const [historyFilter, setHistoryFilter] = useState<"ALL" | "SUCCESS" | "FAILED">("ALL");
    const [reprintingId, setReprintingId] = useState<string | null>(null);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus ô nhập khi load trang
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const activeResult = useMemo(() => {
        if (!results.length) return null;
        if (selectedResultId) {
            const found = results.find((r) => r.id === selectedResultId);
            if (found) return found;
        }
        return results[0];
    }, [results, selectedResultId]);

    const stats = useMemo(() => {
        const total = results.length;
        const success = results.filter(
            (r) => r.status === "COMPLETED" || r.status === "CHECKED",
        ).length;
        const failed = results.filter(
            (r) => r.status === "FAILED" || r.status === "PRINT_FAILED",
        ).length;
        return { total, success, failed };
    }, [results]);

    const filteredResults = useMemo(() => {
        if (historyFilter === "SUCCESS") {
            return results.filter((r) => r.status === "COMPLETED" || r.status === "CHECKED");
        }
        if (historyFilter === "FAILED") {
            return results.filter((r) => r.status === "FAILED" || r.status === "PRINT_FAILED");
        }
        return results;
    }, [results, historyFilter]);

    const handleManualSubmit = () => {
        const code = manualCode.trim();
        if (!code) return;
        setSelectedResultId(null);
        onSubmit(code);
        setManualCode("");
        inputRef.current?.focus();
    };

    const handleCopyCode = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopiedCode(code);
            setTimeout(() => setCopiedCode(null), 2000);
        } catch {
            // Bỏ qua lỗi clipboard
        }
    };

    const handleReprint = async (orderId: string) => {
        if (!onReprint || reprintingId) return;
        setReprintingId(orderId);
        try {
            await onReprint(orderId);
        } finally {
            setReprintingId(null);
        }
    };

    const handleRedeemNow = (code: string) => {
        onModeChange("REDEEM");
        onSubmit(code);
    };

    return (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-background)]">
            {/* ── Top Header ────────────────────────────────────────── */}
            <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-orange-500/20">
                            <Ticket className="h-6 w-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                                    Đổi Voucher & Quà Tặng
                                </h1>
                                {warehouseName ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        {warehouseName}
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                                Quét mã barcode hoặc QR để kiểm tra quyền lợi và tự động xuất vé đổi quà
                            </p>
                        </div>
                    </div>

                    {/* Mode Switcher */}
                    <div className="flex items-center gap-3">
                        <div className="flex rounded-xl bg-slate-100 p-1">
                            <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => onModeChange("REDEEM")}
                                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${mode === "REDEEM"
                                    ? "bg-white text-orange-600 shadow-sm"
                                    : "text-slate-600 hover:text-slate-900"
                                    }`}
                            >
                                <Sparkles size={14} className={mode === "REDEEM" ? "text-orange-500" : ""} />
                                Đổi quà & In vé
                            </button>
                            <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => onModeChange("CHECK")}
                                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${mode === "CHECK"
                                    ? "bg-white text-sky-600 shadow-sm"
                                    : "text-slate-600 hover:text-slate-900"
                                    }`}
                            >
                                <Search size={14} className={mode === "CHECK" ? "text-sky-500" : ""} />
                                Chỉ kiểm tra
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Scanner Input Bar ───────────────────────────────── */}
                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-40 flex-1">
                        <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                            <ScanLine size={18} />
                        </div>
                        <input
                            ref={inputRef}
                            aria-label="Quét hoặc nhập mã voucher đầy đủ"
                            value={manualCode}
                            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleManualSubmit();
                            }}
                            placeholder="Quét mã vạch hoặc nhập mã voucher (nhấn Enter để xử lý)..."
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 font-mono text-sm font-semibold uppercase tracking-wider text-slate-900 outline-none transition-all placeholder:font-sans placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                        {manualCode.trim() ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setManualCode("");
                                    inputRef.current?.focus();
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X size={16} />
                            </button>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        disabled={!manualCode.trim()}
                        onClick={handleManualSubmit}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 text-xs font-bold text-white shadow-sm transition-all hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    >
                        <TicketCheck size={16} />
                        Xử lý mã
                    </button>

                    <button
                        type="button"
                        aria-expanded={showCodeForm}
                        aria-controls="voucher-code-form"
                        onClick={() => setShowCodeForm((visible) => !visible)}
                        className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 aria-expanded:border-orange-300 aria-expanded:bg-orange-50 aria-expanded:text-orange-900"
                    >
                        Nhập theo mẫu
                    </button>

                    {batchCount > 0 && (
                        <button
                            type="button"
                            disabled={!canFlush}
                            onClick={onFlush}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                            {isFinalizing ? <LoaderCircle className="animate-spin" size={16} /> : <Printer size={16} />}
                            Xác nhận & in ({batchCount})
                        </button>
                    )}
                </div>
                <div id="voucher-code-form" hidden={!showCodeForm}>
                    {showCodeForm && (
                        <VoucherCodeForm
                            key={warehouseId}
                            warehouseId={warehouseId}
                            onSubmit={(code) => {
                                setSelectedResultId(null);
                                onSubmit(code);
                            }}
                        />
                    )}
                </div>
            </header>

            {/* ── Main Content Area: 2-Column POS Layout ───────────── */}
            <div className="flex min-h-0 flex-1 overflow-hidden p-5 gap-5">
                {/* Left Column: Spotlight Voucher Ticket Card (58%) */}
                <section className="flex flex-1 flex-col min-w-0 overflow-y-auto">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                            <Ticket className="text-orange-500" size={15} />
                            <span>Thẻ Voucher vừa quét</span>
                        </div>
                        {isProcessing && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-600">
                                <LoaderCircle className="animate-spin" size={14} />
                                {isFinalizing
                                    ? "Đang tạo một bill và in các vé"
                                    : batchCount > 0
                                        ? `Đã nhận ${batchCount} voucher · tự chốt sau 10 giây không có mã mới`
                                        : `Đang kiểm tra (${pendingCount} mã)`}
                            </span>
                        )}
                    </div>

                    {activeResult ? (
                        <VoucherTicketSpotlight
                            result={activeResult}
                            mode={mode}
                            isReprinting={reprintingId === activeResult.orderId}
                            copiedCode={copiedCode}
                            onCopyCode={handleCopyCode}
                            onReprint={handleReprint}
                            onRedeemNow={handleRedeemNow}
                        />
                    ) : (
                        <EmptyVoucherSpotlight />
                    )}
                </section>

                {/* Right Column: Session Redemption Log (42%) */}
                <aside className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:max-w-md">
                    {/* Header */}
                    <div className="border-b border-slate-100 p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <History className="text-slate-500" size={17} />
                                <h2 className="text-sm font-bold text-slate-900">
                                    Lịch sử quét trong ca
                                </h2>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                    {results.length}
                                </span>
                            </div>
                            {results.length > 0 && onClearResults && (
                                <button
                                    type="button"
                                    onClick={onClearResults}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-rose-600"
                                    title="Xóa danh sách phiên hiện tại"
                                >
                                    <Trash2 size={13} />
                                    <span>Xóa</span>
                                </button>
                            )}
                        </div>

                        {/* Filter Tabs */}
                        {results.length > 0 && (
                            <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-bold">
                                <button
                                    type="button"
                                    onClick={() => setHistoryFilter("ALL")}
                                    className={`flex-1 rounded-lg py-1 transition-all ${historyFilter === "ALL"
                                        ? "bg-white text-slate-900 shadow-xs"
                                        : "text-slate-500 hover:text-slate-800"
                                        }`}
                                >
                                    Tất cả ({results.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setHistoryFilter("SUCCESS")}
                                    className={`flex-1 rounded-lg py-1 transition-all ${historyFilter === "SUCCESS"
                                        ? "bg-white text-emerald-700 shadow-xs"
                                        : "text-slate-500 hover:text-slate-800"
                                        }`}
                                >
                                    Thành công ({stats.success})
                                </button>
                                {stats.failed > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setHistoryFilter("FAILED")}
                                        className={`flex-1 rounded-lg py-1 transition-all ${historyFilter === "FAILED"
                                            ? "bg-white text-rose-700 shadow-xs"
                                            : "text-slate-500 hover:text-slate-800"
                                            }`}
                                    >
                                        Lỗi ({stats.failed})
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {filteredResults.length > 0 ? (
                            filteredResults.map((item) => {
                                const isSelected = activeResult?.id === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setSelectedResultId(item.id)}
                                        className={`group relative flex w-full flex-col text-left rounded-xl border p-3 transition-all ${isSelected
                                            ? "border-orange-400 bg-orange-50/50 shadow-sm ring-1 ring-orange-200"
                                            : "border-slate-100 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                                            }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <StatusIcon status={item.status} size={16} />
                                                <span className="font-mono text-xs font-bold text-slate-800">
                                                    {item.code}
                                                </span>
                                            </div>
                                            <span className="text-[11px] font-medium text-slate-400">
                                                {formatTime(item.timestamp)}
                                            </span>
                                        </div>

                                        <div className="mt-1.5 flex items-baseline justify-between gap-2">
                                            <p className="line-clamp-1 text-xs font-semibold text-slate-700">
                                                {item.productName || item.title}
                                            </p>
                                            <StatusBadge status={item.status} />
                                        </div>

                                        {item.campaignName && (
                                            <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                                                {item.campaignName}
                                            </p>
                                        )}

                                        {item.orderId && (
                                            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
                                                <span className="font-mono text-slate-500">
                                                    #{item.orderId.slice(-8)}
                                                </span>
                                                {onReprint && (
                                                    <span
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleReprint(item.orderId!);
                                                        }}
                                                        className="inline-flex items-center gap-1 font-semibold text-orange-600 hover:text-orange-700"
                                                    >
                                                        <Printer size={12} />
                                                        In lại
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </button>
                                );
                            })
                        ) : (
                            <div className="flex h-48 flex-col items-center justify-center p-4 text-center">
                                <TicketCheck className="h-8 w-8 text-slate-300" />
                                <p className="mt-2 text-xs font-medium text-slate-500">
                                    {results.length === 0
                                        ? "Chưa có mã nào được quét trong phiên"
                                        : "Không có kết quả phù hợp bộ lọc"}
                                </p>
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </main>
    );
}

// ── Status Icon Helper ────────────────────────────────────────────────────────
function StatusIcon({ status, size = 18 }: { status: VoucherRedemptionResultStatus; size?: number }) {
    switch (status) {
        case "PENDING":
            return <LoaderCircle size={size} className="shrink-0 animate-spin text-orange-600" />;
        case "COMPLETED":
            return <CheckCircle2 size={size} className="shrink-0 text-emerald-600" />;
        case "CHECKED":
            return <Search size={size} className="shrink-0 text-sky-600" />;
        case "PRINT_FAILED":
            return <TriangleAlert size={size} className="shrink-0 text-amber-600" />;
        case "FAILED":
            return <XCircle size={size} className="shrink-0 text-rose-600" />;
    }
}

// ── Status Badge Helper ───────────────────────────────────────────────────────
function StatusBadge({ status }: { status: VoucherRedemptionResultStatus }) {
    switch (status) {
        case "PENDING":
            return (
                <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                    Đang gom bill
                </span>
            );
        case "COMPLETED":
            return (
                <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    Đã đổi & in
                </span>
            );
        case "CHECKED":
            return (
                <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 border border-sky-200">
                    Hợp lệ
                </span>
            );
        case "PRINT_FAILED":
            return (
                <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                    Lỗi in
                </span>
            );
        case "FAILED":
            return (
                <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                    Thất bại
                </span>
            );
    }
}

// ── Spotlight Ticket Component ────────────────────────────────────────────────
interface VoucherTicketSpotlightProps {
    result: VoucherRedemptionResult;
    mode: VoucherRedemptionMode;
    isReprinting: boolean;
    copiedCode: string | null;
    onCopyCode: (code: string) => void;
    onReprint: (orderId: string) => void;
    onRedeemNow: (code: string) => void;
}

function VoucherTicketSpotlight({
    result,
    mode,
    isReprinting,
    copiedCode,
    onCopyCode,
    onReprint,
    onRedeemNow,
}: VoucherTicketSpotlightProps) {
    const isSuccess = result.status === "COMPLETED";
    const isPending = result.status === "PENDING";
    const isChecked = result.status === "CHECKED";
    const isPrintFailed = result.status === "PRINT_FAILED";
    const isFailed = result.status === "FAILED";

    // Gradient & header style
    const headerTheme = useMemo(() => {
        if (isPending) {
            return {
                bg: "bg-gradient-to-r from-orange-500 to-amber-600 text-white",
                pill: "bg-orange-400/30 text-orange-50 border-orange-300/40",
                label: "ĐÃ NHẬN VOUCHER · ĐANG GOM BILL",
                desc: "Tiếp tục quét mã hoặc bấm Xác nhận & in; tự chốt sau 10 giây",
            };
        }
        if (isSuccess) {
            return {
                bg: "bg-gradient-to-r from-emerald-600 to-teal-700 text-white",
                pill: "bg-emerald-500/30 text-emerald-100 border-emerald-400/40",
                label: "ĐÃ ĐỔI VOUCHER THÀNH CÔNG",
                desc: "Đơn hàng đã được ghi nhận 0đ & gửi lệnh in vé",
            };
        }
        if (isChecked) {
            return {
                bg: "bg-gradient-to-r from-sky-600 to-blue-700 text-white",
                pill: "bg-sky-500/30 text-sky-100 border-sky-400/40",
                label: "VOUCHER HỢP LỆ (CHƯA ĐỔI)",
                desc: mode === "CHECK" ? "Mã hợp lệ để đổi quà tại quầy" : "Cần sử dụng trong giỏ hàng thanh toán",
            };
        }
        if (isPrintFailed) {
            return {
                bg: "bg-gradient-to-r from-amber-600 to-orange-600 text-white",
                pill: "bg-amber-500/30 text-amber-100 border-amber-400/40",
                label: "ĐÃ ĐỔI VOUCHER · CẦN IN LẠI",
                desc: "Đơn đã ghi nhận nhưng máy in chưa nhận lệnh in",
            };
        }
        return {
            bg: "bg-gradient-to-r from-rose-600 to-pink-700 text-white",
            pill: "bg-rose-500/30 text-rose-100 border-rose-400/40",
            label: "VOUCHER KHÔNG THỂ SỬ DỤNG",
            desc: "Mã không đủ điều kiện hoặc đã hết hiệu lực",
        };
    }, [isSuccess, isPending, isChecked, isPrintFailed, mode]);

    return (
        <div className="relative flex flex-col rounded-3xl border border-slate-200/90 bg-white shadow-lg overflow-hidden transition-all">
            {/* Top Banner Status Bar */}
            <div className={`px-6 py-4 ${headerTheme.bg}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-xs">
                            {isSuccess && <CheckCircle2 className="h-5 w-5 text-white" />}
                            {isPending && <LoaderCircle className="h-5 w-5 animate-spin text-white" />}
                            {isChecked && <Search className="h-5 w-5 text-white" />}
                            {isPrintFailed && <TriangleAlert className="h-5 w-5 text-white" />}
                            {isFailed && <XCircle className="h-5 w-5 text-white" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-black tracking-wide">
                                    {headerTheme.label}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${headerTheme.pill}`}>
                                    {result.status}
                                </span>
                            </div>
                            <p className="mt-0.5 text-xs text-white/80">{headerTheme.desc}</p>
                        </div>
                    </div>

                    <div className="text-right">
                        <span className="text-[11px] text-white/70">Thời gian</span>
                        <p className="font-mono text-xs font-bold text-white">
                            {formatTime(result.timestamp)}
                        </p>
                    </div>
                </div>
            </div>

            {/* Ticket Upper Section: Code & Campaign */}
            <div className="p-6 bg-gradient-to-b from-slate-50/50 to-white">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Mã voucher
                        </span>
                        <div className="mt-1 flex items-center gap-2">
                            <span className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 font-mono text-xl font-black tracking-widest text-slate-900 shadow-2xs">
                                {result.code}
                            </span>
                            <button
                                type="button"
                                onClick={() => onCopyCode(result.code)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-800"
                                title="Sao chép mã voucher"
                            >
                                {copiedCode === result.code ? (
                                    <Check size={16} className="text-emerald-600" />
                                ) : (
                                    <Copy size={16} />
                                )}
                            </button>
                        </div>
                    </div>

                    {result.campaignName && (
                        <div className="text-right">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Chiến dịch khuyến mãi
                            </span>
                            <p className="mt-1 text-sm font-bold text-slate-800">
                                {result.campaignName}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Ticket Perforated Tear Line with Notches */}
            <div className="relative flex items-center justify-between px-2 bg-white">
                {/* Left Cutout */}
                <div className="h-6 w-4 rounded-r-full bg-[var(--color-background)] border-r border-y border-slate-200" />
                {/* Dashed Line */}
                <div className="flex-1 border-t-2 border-dashed border-slate-200 mx-3" />
                {/* Right Cutout */}
                <div className="h-6 w-4 rounded-l-full bg-[var(--color-background)] border-l border-y border-slate-200" />
            </div>

            {/* Ticket Lower Section: Gift / Reward Details */}
            <div className="p-6 bg-white flex-1 flex flex-col justify-between">
                <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        {isFailed ? "Chi tiết lỗi & Lý do" : "Nội dung ưu đãi & Quà tặng"}
                    </span>

                    {isFailed ? (
                        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                            <div className="flex items-start gap-3">
                                <TriangleAlert className="mt-0.5 shrink-0 text-rose-600" size={18} />
                                <div>
                                    <h3 className="text-sm font-bold text-rose-900">
                                        {result.title}
                                    </h3>
                                    <p className="mt-1 text-xs leading-relaxed text-rose-700">
                                        {result.detail}
                                    </p>
                                    <p className="mt-2 text-[11px] text-rose-500 italic">
                                        Gợi ý: Kiểm tra xem mã đã được sử dụng trước đó, hết hạn hoặc sai cửa hàng áp dụng.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-3 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-orange-50/40 p-4">
                            <div className="flex items-start gap-3.5">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/20">
                                    {result.rewardType === "DISCOUNT_PERCENT" ? (
                                        <Percent size={20} />
                                    ) : result.rewardType === "FREE_TICKET" ? (
                                        <Ticket size={20} />
                                    ) : (
                                        <Gift size={20} />
                                    )}
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline gap-2">
                                        <h3 className="text-base font-black text-slate-900">
                                            {result.productName || result.title}
                                        </h3>
                                        {result.productQuantity && (
                                            <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800">
                                                x {result.productQuantity}
                                            </span>
                                        )}
                                    </div>

                                    <p className="mt-1 text-xs text-slate-600">
                                        {result.detail}
                                    </p>

                                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                                        {result.rewardType && (
                                            <span className="inline-flex items-center gap-1 font-semibold text-amber-900">
                                                <Sparkles size={13} className="text-amber-600" />
                                                {result.rewardType === "FREE_TICKET"
                                                    ? "Vé vào cổng miễn phí"
                                                    : result.rewardType === "FREE_ITEM"
                                                        ? "Quà tặng miễn phí"
                                                        : `Giảm giá ${result.rewardValue}%`}
                                            </span>
                                        )}

                                        {result.orderTotalAmount !== undefined && (
                                            <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                                                Thu thêm:
                                                <strong className="font-bold text-slate-900">
                                                    {result.orderTotalAmount === 0
                                                        ? "Miễn phí 100%"
                                                        : formatCurrency(result.orderTotalAmount)}
                                                </strong>
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Action Strip */}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <div className="text-xs text-slate-500">
                        {result.orderId ? (
                            <div className="flex items-center gap-1.5">
                                <span>Mã đơn:</span>
                                <span className="font-mono font-bold text-slate-800">
                                    #{result.orderId}
                                </span>
                            </div>
                        ) : (
                            <span>Trạng thái: {result.title}</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Nếu đang ở chế độ check và mã hợp lệ, cho phép đổi ngay */}
                        {isChecked && mode === "CHECK" && result.rewardType !== "DISCOUNT_PERCENT" && (
                            <button
                                type="button"
                                onClick={() => onRedeemNow(result.code)}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-orange-700 active:scale-[0.98]"
                            >
                                <Sparkles size={14} />
                                Đổi quà & In vé ngay
                            </button>
                        )}

                        {/* Nút in lại vé nếu đã có đơn */}
                        {result.orderId && (
                            <button
                                type="button"
                                disabled={isReprinting}
                                onClick={() => onReprint(result.orderId!)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 hover:text-orange-600 active:scale-[0.98] disabled:opacity-50"
                            >
                                {isReprinting ? (
                                    <LoaderCircle className="animate-spin" size={14} />
                                ) : (
                                    <Printer size={14} />
                                )}
                                In lại vé & hóa đơn
                            </button>
                        )}

                        {/* Nút xem đơn hàng trên POS */}
                        {result.orderId && (
                            <Link
                                href="/orders"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
                            >
                                <ExternalLink size={14} />
                                Xem đơn
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Empty State Spotlight Component ───────────────────────────────────────────
function EmptyVoucherSpotlight() {
    return (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white p-8 text-center shadow-2xs">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 text-amber-500 shadow-inner">
                <TicketCheck size={32} />
            </div>

            <h2 className="mt-4 text-base font-extrabold text-slate-800">
                Sẵn sàng quét voucher
            </h2>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
                Đưa mã vạch hoặc mã QR của khách hàng trước máy quét laser hoặc camera để xử lý tự động.
            </p>

            <div className="mt-6 grid max-w-lg grid-cols-1 gap-3 text-left sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-orange-600">
                        <Sparkles size={14} />
                        <span>Chế độ Đổi & In vé</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        Tự động tạo đơn hàng 0đ, trừ mã voucher và gửi lệnh in vé vào cổng ngay lập tức.
                    </p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-sky-600">
                        <Search size={14} />
                        <span>Chế độ Chỉ kiểm tra</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        Tra cứu thông tin quà tặng và thời hạn sử dụng mà không làm mất hiệu lực của voucher.
                    </p>
                </div>
            </div>

            <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
                <Info size={14} className="text-slate-400" />
                <span>Phím tắt: Đặt con trỏ vào ô nhập và nhấn <strong>Enter</strong> để gửi mã</span>
            </div>
        </div>
    );
}
