"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, LoaderCircle, Search, UserRound, X } from "lucide-react";
import CartItem, { EmptyCart } from "@/components/pos/CartItem";
import CheckoutModal from "@/components/pos/CheckoutModal";
import OrderNumberStatus from "@/components/pos/OrderNumberStatus";
import type { ReceiptLanguage } from "@/features/receipt/types/receipt";
import type {
    OrderItem,
    OrderMemberSnapshot,
    OrderStatus,
    OrderSyncStatus,
    PaymentMethod,
} from "@/lib/types/order";
import type { PaymentMethodOption } from "@/lib/types/payment";
import type { PayOSCheckoutController } from "@/lib/types/payment";
import type { PosVoucherResolution } from "@/lib/types/voucher";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { showWarning } from "@/lib/utils/toast";

interface CartPanelProps {
    items: OrderItem[];
    member: OrderMemberSnapshot | null;
    memberReadStatus: "IDLE" | "READING" | "LOOKING_UP" | "FAILED";
    memberReadError: string | null;
    paymentMethod: PaymentMethod;
    paymentMethods: PaymentMethodOption[];
    receiptLanguage: ReceiptLanguage;
    payOSPayment: PayOSCheckoutController;
    isCheckingOut: boolean;
    isPaymentLocked: boolean;
    currentOrderId: string | null;
    currentHkOrderNumber: string | null;
    currentOrderStatus: OrderStatus | null;
    currentOrderSyncStatus: OrderSyncStatus | null;
    totalAmount: number;
    itemCount: number;
    vouchers: PosVoucherResolution[];
    discountAmount: number;
    isValidatingVoucher: boolean;
    onUpdateQuantity: (goodsId: string, quantity: number) => void;
    onRemoveItem: (goodsId: string) => void;
    onReadMemberCard: () => void;
    onCancelMemberCardRead: () => void;
    onLookupMemberByPhone: (phone: string) => void | Promise<void>;
    onRemoveMember: () => void;
    onSetPaymentMethod: (method: PaymentMethod) => void;
    onSetReceiptLanguage: (language: ReceiptLanguage) => void;
    onCheckout: () => void | Promise<void>;
    onClearCart: () => void;
    onApplyVoucher: (code: string) => void;
    onRemoveVoucher: (code: string) => void;
    openCheckoutRequested: boolean;
    onCheckoutOpened: () => void;
}

export default function CartPanel({
    items,
    member,
    memberReadStatus,
    memberReadError,
    paymentMethod,
    paymentMethods,
    receiptLanguage,
    payOSPayment,
    isCheckingOut,
    isPaymentLocked,
    currentOrderId,
    currentHkOrderNumber,
    currentOrderStatus,
    currentOrderSyncStatus,
    totalAmount,
    itemCount,
    vouchers,
    discountAmount,
    isValidatingVoucher,
    onUpdateQuantity,
    onRemoveItem,
    onReadMemberCard,
    onCancelMemberCardRead,
    onLookupMemberByPhone,
    onRemoveMember,
    onSetPaymentMethod,
    onSetReceiptLanguage,
    onCheckout,
    onClearCart,
    onApplyVoucher,
    onRemoveVoucher,
    openCheckoutRequested,
    onCheckoutOpened,
}: CartPanelProps) {
    const currentCartKey = items
        .map((item) => `${item.goodsId}:${item.quantity}`)
        .join("|");
    const [modalCartKey, setModalCartKey] = useState<string | null>(() =>
        openCheckoutRequested && items.length > 0 ? currentCartKey : null,
    );
    const [memberPhone, setMemberPhone] = useState("");

    const closeModal = useCallback(() => {
        if (!isCheckingOut) setModalCartKey(null);
    }, [isCheckingOut]);

    const confirmCheckout = useCallback(async () => {
        await onCheckout();
        setModalCartKey(null);
    }, [onCheckout]);

    const clearCart = useCallback(() => {
        setModalCartKey(null);
        setMemberPhone("");
        onClearCart();
    }, [onClearCart]);

    const handleMemberAction = useCallback(async () => {
        if (memberReadStatus === "READING") {
            onCancelMemberCardRead();
            return;
        }
        if (items.length === 0) {
            showWarning(
                "Đơn hàng chưa có sản phẩm",
                "Vui lòng thêm ít nhất một sản phẩm trước khi tìm hoặc đọc thẻ thành viên.",
            );
            return;
        }
        const phone = memberPhone.trim();
        if (phone) {
            await onLookupMemberByPhone(phone);
            return;
        }
        onReadMemberCard();
    }, [items.length, memberPhone, memberReadStatus, onCancelMemberCardRead, onLookupMemberByPhone, onReadMemberCard]);

    const removeMember = useCallback(() => {
        setMemberPhone("");
        onRemoveMember();
    }, [onRemoveMember]);

    const finalAmount = Math.max(0, totalAmount - discountAmount);
    const isModalOpen = items.length > 0 && modalCartKey !== null;

    useEffect(() => {
        if (!openCheckoutRequested || items.length === 0) return;
        onCheckoutOpened();
    }, [items.length, onCheckoutOpened, openCheckoutRequested]);

    useEffect(() => {
        if (items.length === 0 && receiptLanguage !== "vi") {
            onSetReceiptLanguage("vi");
        }
    }, [items.length, onSetReceiptLanguage, receiptLanguage]);

    return (
        <aside className="flex h-full min-h-0 flex-col py-2 gap-2">
            <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-2 pl-3 py-2 border border-[var(--color-border)] bg-white rounded-lg">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
                            Đơn hàng hiện tại
                        </h2>
                        {itemCount > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-50 px-1.5 text-sm font-bold text-[var(--color-accent)]">
                                {itemCount}
                            </span>
                        )}
                    </div>
                    <OrderNumberStatus
                        localOrderId={currentOrderId}
                        hkOrderNumber={currentHkOrderNumber}
                        status={currentOrderStatus}
                        syncStatus={currentOrderSyncStatus}
                    />
                </div>
                {items.length > 0 && (
                    <button
                        type="button"
                        onClick={clearCart}
                        disabled={isPaymentLocked}
                        className="flex size-12 items-center justify-center rounded-lg bg-red-500 text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                        aria-label="Xóa toàn bộ giỏ hàng"
                        title="Xóa toàn bộ"
                    >
                        <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.35 9m-4.78 0-.35-9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17-1.07 13.88a2.25 2.25 0 0 1-2.24 2.08H8.08a2.25 2.25 0 0 1-2.24-2.08L4.77 5.79m14.46 0a48.7 48.7 0 0 0-3.48-.4m-12 .57c.34-.06.68-.12 1.02-.17m0 0a48 48 0 0 1 3.48-.4m7.5 0v-.91a2.25 2.25 0 0 0-2.09-2.2 52 52 0 0 0-3.32 0 2.25 2.25 0 0 0-2.09 2.2v.91m7.5 0a48.7 48.7 0 0 0-7.5 0" />
                        </svg>
                    </button>
                )}
            </header>
            {member ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm">
                        <UserRound className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-emerald-950">
                            {member.fullName || "Khách thành viên"}
                        </p>
                        <p className="truncate text-xs font-medium text-emerald-800">
                            {member.memberCode || member.phone || member.levelName}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={removeMember}
                        disabled={isPaymentLocked}
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Gỡ thành viên khỏi đơn hàng"
                        title="Gỡ thành viên"
                    >
                        <X className="size-4" />
                    </button>
                </div>
            ) : (
                <div className="space-y-1.5">
                    <form
                        className="flex items-stretch gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleMemberAction();
                        }}
                    >
                        <div className="relative min-w-0 flex-1">
                            <input
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                maxLength={20}
                                value={memberPhone}
                                onChange={(event) => setMemberPhone(event.target.value)}
                                disabled={isPaymentLocked || memberReadStatus === "READING" || memberReadStatus === "LOOKING_UP"}
                                placeholder="Số điện thoại thành viên"
                                aria-label="Số điện thoại thành viên"
                                className="h-12 w-full rounded-xl border border-[var(--color-border)] bg-white pl-3 pr-11 text-sm font-semibold text-[var(--color-text-primary)] outline-none transition-colors placeholder:font-normal placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:bg-slate-100"
                            />
                            {memberPhone ? (
                                <button
                                    type="button"
                                    onClick={() => setMemberPhone("")}
                                    disabled={isPaymentLocked || memberReadStatus === "READING" || memberReadStatus === "LOOKING_UP"}
                                    className="absolute right-0 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="Xóa số điện thoại"
                                    title="Xóa số điện thoại"
                                >
                                    <X className="size-4" />
                                </button>
                            ) : null}
                        </div>
                        <button
                            type="submit"
                            disabled={isPaymentLocked || memberReadStatus === "LOOKING_UP"}
                            className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 text-sm font-bold text-[var(--color-accent)] transition-colors hover:bg-orange-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                            aria-label={memberPhone.trim() ? "Tìm thành viên bằng số điện thoại" : "Đọc thẻ thành viên"}
                            title={memberPhone.trim() ? "Tìm bằng số điện thoại" : "Đọc thẻ thành viên"}
                        >
                            {memberReadStatus === "READING" || memberReadStatus === "LOOKING_UP" ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : memberPhone.trim() ? (
                                <Search className="size-4" />
                            ) : (
                                <CreditCard className="size-4" />
                            )}
                            {memberReadStatus === "READING"
                                ? "Hủy"
                                : memberReadStatus === "LOOKING_UP"
                                    ? "Đang tìm"
                                    : memberPhone.trim()
                                        ? "Tìm"
                                        : "Đọc thẻ"}
                        </button>
                    </form>
                    {memberReadStatus === "FAILED" && memberReadError ? (
                        <p className="text-xs font-medium text-red-600" role="alert">
                            {memberReadError}
                        </p>
                    ) : null}
                </div>
            )}

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2 border border-[var(--color-border)] bg-white rounded-xl">
                {items.length === 0 ? (
                    <EmptyCart />
                ) : (
                    <ul className="flex flex-col gap-2">
                        {items.map((item) => (
                            <CartItem
                                key={item.goodsId}
                                item={item}
                                disabled={isPaymentLocked}
                                onUpdateQuantity={(quantity) =>
                                    onUpdateQuantity(item.goodsId, quantity)
                                }
                                onRemove={() => onRemoveItem(item.goodsId)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <div className="shrink-0 space-y-3 border border-[var(--color-border)] rounded-xl bg-[#fdfdfc] px-5 p-3">
                <div className="flex items-end justify-between gap-3">
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">
                        Tổng cộng
                    </span>
                    <span className="text-xl font-extrabold text-[var(--color-text-primary)]">
                        {formatCurrency(finalAmount)}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setModalCartKey(currentCartKey)}
                    disabled={items.length === 0 || isCheckingOut}
                    className="flex min-h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] text-sm font-bold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[var(--color-accent-hover)] active:scale-[0.99] disabled:bg-[#dededb] disabled:text-[#a4a49f] disabled:shadow-none"
                >
                    {isPaymentLocked ? "Tiếp tục thanh toán" : "Thanh toán"}
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                    </svg>
                </button>
            </div>

            {isModalOpen && items.length > 0 && (
                <CheckoutModal
                    paymentMethod={paymentMethod}
                    paymentMethods={paymentMethods}
                    receiptLanguage={receiptLanguage}
                    payOSPayment={payOSPayment}
                    totalAmount={totalAmount}
                    finalAmount={finalAmount}
                    itemCount={itemCount}
                    appliedVouchers={vouchers}
                    discountAmount={discountAmount}
                    isValidatingVoucher={isValidatingVoucher}
                    isCheckingOut={isCheckingOut}
                    onSetPaymentMethod={onSetPaymentMethod}
                    onSetReceiptLanguage={onSetReceiptLanguage}
                    onApplyVoucher={onApplyVoucher}
                    onRemoveVoucher={onRemoveVoucher}
                    onClose={closeModal}
                    onConfirm={confirmCheckout}
                />
            )}
        </aside>
    );
}
