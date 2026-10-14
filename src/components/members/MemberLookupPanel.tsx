import { CircleAlert, CreditCard, LoaderCircle, Phone, Radio, RotateCcw, Search, X } from "lucide-react";
import type { CardReaderStatus, MemberLookupMode } from "@/lib/types/member";
import MemberPhoneSuggestions from "./MemberPhoneSuggestions";
import type { MemberPhoneSuggestion } from "@/lib/types/memberPhoneSearch";

interface MemberLookupPanelProps {
    mode: MemberLookupMode;
    query: string;
    isLookingUp: boolean;
    cardReaderStatus: CardReaderStatus;
    cardReaderError: string | null;
    onModeChange: (mode: MemberLookupMode) => void;
    onQueryChange: (query: string) => void;
    onReadCard: () => void;
    onCancelCardRead: () => void;
    onSubmit: () => void;
    phoneSearch?: { items: MemberPhoneSuggestion[]; loading: boolean; error: string | null; valid: boolean };
    onSuggestionSelect?: (item: MemberPhoneSuggestion) => void;
    onSearchRetry?: () => void;
    phoneSelected?: boolean;
}

const MODES: Array<{
    value: MemberLookupMode;
    label: string;
    icon: typeof Phone;
}> = [
        { value: "PHONE", label: "Số điện thoại", icon: Phone },
        { value: "CARD", label: "Mã thẻ", icon: CreditCard },
    ];

export default function MemberLookupPanel({
    mode,
    query,
    isLookingUp,
    cardReaderStatus,
    cardReaderError,
    onModeChange,
    onQueryChange,
    onReadCard,
    onCancelCardRead,
    onSubmit,
    phoneSearch,
    onSuggestionSelect,
    onSearchRetry,
    phoneSelected = false,
}: MemberLookupPanelProps) {
    const isReadingCard = cardReaderStatus === "READING";
    const placeholder = mode === "PHONE"
        ? "Nhập số điện thoại khách hàng"
        : "Đưa thẻ lên đầu đọc hoặc nhập mã thẻ";

    return (
        <section className="rounded-3xl border border-[var(--color-border)] bg-white p-3 shadow-sm">
            <div className="flex mb-4" role="tablist">
                {MODES.map(({ value, label, icon: Icon }) => {
                    const isActive = mode === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => onModeChange(value)}
                            disabled={isLookingUp}
                            className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-colors disabled:opacity-50 ${isActive
                                ? "bg-[var(--color-accent)] text-white shadow-sm"
                                : "text-[var(--color-text-secondary)]"
                                }`}
                        >
                            <Icon className="size-5" />
                            {label}
                        </button>
                    );
                })}
            </div>

            <form
                id="member-lookup-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit();
                }}
                className="space-y-3"
            >
                <label htmlFor="member-lookup" className="text-sm font-bold text-[var(--color-text-primary)]">
                    {mode === "PHONE" ? "Số điện thoại" : "Mã số thẻ thành viên"}
                </label>
                <div className="relative">
                    {mode === "PHONE" ? (
                        <Phone className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    ) : (
                        <CreditCard className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    )}
                    <input
                        id="member-lookup"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        disabled={isLookingUp}
                        inputMode={mode === "PHONE" ? "tel" : "text"}
                        autoComplete="off"
                        aria-describedby={mode === "PHONE" ? "member-phone-suggestions" : undefined}
                        placeholder={placeholder}
                        className="h-15 w-full rounded-2xl border border-[var(--color-border-subtle)] bg-white pl-12 pr-4 text-lg font-semibold transition-colors placeholder:text-sm placeholder:font-normal focus:border-[var(--color-accent)] disabled:bg-neutral-50"
                    />
                </div>

                {mode === "PHONE" && phoneSearch && !phoneSelected && <MemberPhoneSuggestions {...phoneSearch} disabled={isLookingUp} onSelect={item=>onSuggestionSelect?.(item)} onRetry={()=>onSearchRetry?.()} />}
                {mode === "PHONE" && phoneSelected && <p className="text-sm font-semibold text-emerald-700">Đã chọn số điện thoại {query}.</p>}

                {mode === "CARD" ? (
                    <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-3" aria-live="polite">
                        {isReadingCard ? (
                            <div className="flex items-center justify-between gap-3 text-sm text-orange-800">
                                <span className="flex min-w-0 items-center gap-2 font-semibold">
                                    <Radio className="size-4 shrink-0 animate-pulse" />
                                    Đang chờ thẻ trên đầu đọc Decard D3-U...
                                </span>
                                <button
                                    type="button"
                                    onClick={onCancelCardRead}
                                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-bold hover:bg-orange-100"
                                >
                                    <X className="size-4" /> Hủy
                                </button>
                            </div>
                        ) : cardReaderStatus === "FAILED" ? (
                            <div className="space-y-2 text-sm text-red-700">
                                <p className="flex items-start gap-2">
                                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                    <span>{cardReaderError || "Không thể đọc thẻ."}</span>
                                </p>
                                <button
                                    type="button"
                                    onClick={onReadCard}
                                    className="flex items-center gap-1.5 font-bold text-[var(--color-accent)]"
                                >
                                    <RotateCcw className="size-4" /> Đọc lại
                                </button>
                            </div>
                        ) : cardReaderStatus === "SUCCEEDED" ? (
                            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                                <CreditCard className="size-4" /> Đã nhận serial thẻ {query}.
                            </p>
                        ) : (
                            <button
                                type="button"
                                onClick={onReadCard}
                                className="flex items-center gap-2 text-sm font-bold text-[var(--color-accent)]"
                            >
                                <Radio className="size-4" /> Kích hoạt đầu đọc thẻ
                            </button>
                        )}
                    </div>
                ) : null}

                <div>
                    <button
                        type="submit"
                        disabled={isLookingUp || isReadingCard || !query.trim() || (mode === "PHONE" && !phoneSelected)}
                        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] px-5 font-bold text-white shadow-[var(--shadow-glow)] transition hover:bg-[var(--color-accent-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isLookingUp ? <LoaderCircle className="size-5 animate-spin" /> : <Search className="size-5" />}
                        {isLookingUp ? "Đang tra cứu" : "Tra cứu thành viên"}
                    </button>
                </div>
            </form>
        </section>
    );
}
