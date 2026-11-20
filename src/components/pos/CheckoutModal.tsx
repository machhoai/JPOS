"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CashPaymentPanel, {
  calculateCashReceived,
  createEmptyBanknoteCounts,
  type BanknoteCounts,
  type VndDenomination,
} from "@/components/pos/CashPaymentPanel";
import CheckoutModalFooter from "@/components/pos/CheckoutModalFooter";
import CheckoutPaymentMethods from "@/components/pos/CheckoutPaymentMethods";
import CheckoutSummary from "@/components/pos/CheckoutSummary";
import PayOSQrPanel from "@/components/pos/PayOSQrPanel";
import ReceiptLanguageSelector from "@/components/pos/ReceiptLanguageSelector";
import VoucherInput from "@/components/pos/VoucherInput";
import type { ReceiptLanguage } from "@/features/receipt/types/receipt";
import type { PaymentMethod } from "@/lib/types/order";
import type { PosVoucherResolution } from "@/lib/types/voucher";
import type { PayOSCheckoutController, PaymentMethodOption } from "@/lib/types/payment";

interface CheckoutModalProps {
  title?: string;
  subtitle?: string;
  confirmButtonId?: string;
  paymentMethod: PaymentMethod;
  paymentMethods: PaymentMethodOption[];
  receiptLanguage?: ReceiptLanguage;
  payOSPayment: PayOSCheckoutController;
  totalAmount: number;
  finalAmount: number;
  itemCount: number;
  appliedVouchers?: PosVoucherResolution[];
  discountAmount?: number;
  isValidatingVoucher?: boolean;
  isCheckingOut: boolean;
  onSetPaymentMethod: (method: PaymentMethod) => void;
  onSetReceiptLanguage?: (language: ReceiptLanguage) => void;
  onApplyVoucher?: (code: string) => void;
  onRemoveVoucher?: (code: string) => void;
  onStartTransfer?: () => void | Promise<void>;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function CheckoutModal(props: CheckoutModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [banknotes, setBanknotes] = useState<BanknoteCounts>(createEmptyBanknoteCounts);
  const selectedMethod = props.paymentMethods.find((item) => item.id === props.paymentMethod);
  const isCashPayment = selectedMethod?.kind === "cash" || props.paymentMethod === "CASH";
  const hasPaymentSession = !isCashPayment && props.payOSPayment.hasActiveTransfer;
  const cashReceived = useMemo(() => calculateCashReceived(banknotes), [banknotes]);
  const missingCash = Math.max(0, props.finalAmount - cashReceived);
  const cashChange = Math.max(0, cashReceived - props.finalAmount);
  const hasSufficientCash = !isCashPayment || missingCash === 0;
  const isBusy = props.isCheckingOut || Boolean(props.isValidatingVoucher) || props.payOSPayment.isBusy;

  const changeBanknote = useCallback((value: VndDenomination, delta: number) => {
    setBanknotes((current) => ({
      ...current,
      [value]: Math.max(0, current[value] + delta),
    }));
  }, []);

  const confirmPayment = useCallback(() => {
    if (!hasSufficientCash || isBusy) return;
    if (isCashPayment) void props.onConfirm();
    else void (props.onStartTransfer ?? props.payOSPayment.createPayment)();
  }, [hasSufficientCash, isBusy, isCashPayment, props]);

  const cancelTransfer = () => props.payOSPayment.cancelPayment(props.onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isBusy, props]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !isBusy && props.onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="checkout-modal-title" tabIndex={-1} className="flex h-[95dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] outline-none sm:max-w-[80%] sm:rounded-3xl">
        <header className="shrink-0 py-2 text-center">
          <h2 id="checkout-modal-title" className="text-xl font-extrabold tracking-[-0.02em] text-[var(--color-text-primary)]">
            {props.title ?? (hasPaymentSession ? "Thanh toán chuyển khoản" : "Thanh toán đơn hàng")}
          </h2>
          {props.subtitle ? (
            <p className="mt-1 text-sm font-medium text-[var(--color-text-muted)]">
              {props.subtitle}
            </p>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-2 sm:px-6">
          {hasPaymentSession ? (
            <PayOSQrPanel payment={{ ...props.payOSPayment, cancelPayment: cancelTransfer }} />
          ) : (
            <>
              {props.receiptLanguage && props.onSetReceiptLanguage ? (
                <ReceiptLanguageSelector
                  value={props.receiptLanguage}
                  disabled={isBusy}
                  onChange={props.onSetReceiptLanguage}
                />
              ) : null}
              <CheckoutPaymentMethods paymentMethod={props.paymentMethod} methods={props.paymentMethods} onChange={props.onSetPaymentMethod} />
              {isCashPayment && (
                <CashPaymentPanel counts={banknotes} missingAmount={missingCash} changeAmount={cashChange} onIncrement={(value) => changeBanknote(value, 1)} onDecrement={(value) => changeBanknote(value, -1)} />
              )}
              <div className="mt-auto flex flex-col gap-3">
                {props.onApplyVoucher && props.onRemoveVoucher ? (
                  <VoucherInput
                    appliedVouchers={props.appliedVouchers ?? []}
                    onApplyVoucher={props.onApplyVoucher}
                    onRemoveVoucher={props.onRemoveVoucher}
                    isValidating={props.isValidatingVoucher}
                  />
                ) : null}
                <CheckoutSummary itemCount={props.itemCount} totalAmount={props.totalAmount} finalAmount={props.finalAmount} voucherCodes={(props.appliedVouchers ?? []).map((voucher) => voucher.code)} discountAmount={props.discountAmount ?? 0} cashPayment={isCashPayment ? { receivedAmount: cashReceived, missingAmount: missingCash, changeAmount: cashChange } : undefined} />
              </div>
            </>
          )}
        </div>

        <CheckoutModalFooter confirmButtonId={props.confirmButtonId} isCashPayment={isCashPayment} hasPaymentSession={hasPaymentSession} hasSufficientCash={hasSufficientCash} missingCash={missingCash} isBusy={isBusy} onClose={props.onClose} onConfirm={confirmPayment} />
      </div>
    </div>
  );
}
