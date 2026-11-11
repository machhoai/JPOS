"use client";

import { useEffect, useRef, useState } from "react";
import { TicketCheck } from "lucide-react";

import { listVoucherCodeFormats } from "@/lib/services/orderService";
import type { PosVoucherCodeFormat } from "@/lib/types/voucher";

const UNSELECTED = "_";
const fieldClass = "h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600";

export default function VoucherCodeForm({
    warehouseId,
    onSubmit,
}: {
    warehouseId: string;
    onSubmit: (code: string) => void;
}) {
    const [formats, setFormats] = useState<PosVoucherCodeFormat[] | null>(null);
    const [hasError, setHasError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [prefix, setPrefix] = useState(UNSELECTED);
    const [selectedSuffix, setSelectedSuffix] = useState(UNSELECTED);
    const [segment, setSegment] = useState("");
    const segmentRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let ignore = false;
        listVoucherCodeFormats(warehouseId).then(
            (options) => { if (!ignore) setFormats(options); },
            () => { if (!ignore) setHasError(true); },
        );
        return () => { ignore = true; };
    }, [attempt, warehouseId]);

    const suffixes = formats?.find((format) => format.prefix === prefix)?.suffixes;
    const suffix = suffixes?.length === 1 ? suffixes[0] : selectedSuffix;
    const code = suffixes && suffix !== UNSELECTED && segment.trim()
        ? [prefix, segment.trim(), suffix].filter(Boolean).join("-")
        : "";

    return (
        <section aria-label="Nhập voucher theo mẫu" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {hasError ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <p role="alert" className="text-rose-700">Không tải được mẫu mã voucher.</p>
                    <button
                        type="button"
                        className="min-h-11 rounded-lg px-3 font-semibold text-orange-800 underline focus-visible:outline-2"
                        onClick={() => {
                            setHasError(false);
                            setAttempt((value) => value + 1);
                        }}
                    >
                        Thử lại
                    </button>
                </div>
            ) : !formats?.length ? (
                <p role="status" className="text-sm text-slate-600">
                    {formats ? "Cửa hàng chưa có mẫu mã voucher đang áp dụng." : "Đang tải mẫu mã voucher…"}
                </p>
            ) : (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!code) return;
                        onSubmit(code);
                        setSegment("");
                        segmentRef.current?.focus();
                    }}
                    className="flex flex-wrap items-end gap-2"
                >
                    <label className="min-w-28 flex-1 text-sm font-medium text-slate-700">
                        Tiền tố
                        <select
                            className={`mt-1 ${fieldClass}`}
                            value={prefix}
                            onChange={(event) => {
                                setPrefix(event.target.value);
                                setSelectedSuffix(UNSELECTED);
                            }}
                        >
                            <option value={UNSELECTED} disabled>Chọn tiền tố</option>
                            {formats.map((format) => (
                                <option key={format.prefix} value={format.prefix}>
                                    {format.prefix || "Không có tiền tố"}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="min-w-32 flex-[2] text-sm font-medium text-slate-700">
                        Phần giữa của mã
                        <input
                            ref={segmentRef}
                            value={segment}
                            onChange={(event) => setSegment(event.target.value.toUpperCase())}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={80}
                            className={`mt-1 font-mono ${fieldClass}`}
                        />
                    </label>
                    <label className="min-w-32 flex-1 text-sm font-medium text-slate-700">
                        Hậu tố
                        <select
                            className={`mt-1 disabled:bg-slate-100 ${fieldClass}`}
                            value={suffix}
                            disabled={!suffixes}
                            onChange={(event) => setSelectedSuffix(event.target.value)}
                        >
                            <option value={UNSELECTED} disabled>{suffixes ? "Chọn hậu tố" : "Chọn tiền tố trước"}</option>
                            {suffixes?.map((value) => (
                                <option key={value} value={value}>{value || "Không có hậu tố"}</option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="submit"
                        disabled={!code}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-orange-700 px-4 text-sm font-bold text-white transition-colors hover:bg-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600"
                    >
                        <TicketCheck size={16} aria-hidden="true" />
                        Xử lý mã
                    </button>
                </form>
            )}
        </section>
    );
}
