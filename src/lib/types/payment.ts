import type {
  FixedTransferDetails,
  OrderStatus,
  PaymentMethod,
  PaymentVerificationStatus,
  PayOSManualConfirmation,
  PayOSPaymentStatus,
} from "@/lib/types/order";

export interface PaymentMethodOption {
  id: PaymentMethod;
  methodName: string;
  description: string;
  kind: "cash" | "transfer";
}

export type PayOSNextAction =
  | "WAIT"
  | "RETRY_DISPLAY"
  | "RECREATE"
  | "FALLBACK"
  | "COMPLETED";

export type PayOSErrorKind = "CONNECTION" | "GENERAL";

export interface PayOSPaymentSession {
  orderCode: number;
  status: PayOSPaymentStatus;
  amount: number;
  description: string;
  paymentLinkId: string | null;
  checkoutUrl: string | null;
  qrCode: string | null;
  bin: string | null;
  accountNumber: string | null;
  accountName: string | null;
  currency: string;
  createdAt: string;
  linkExpiresAt: string;
  displayExpiresAt: string;
  paidAt: string | null;
  paidAmount: number | null;
  reference: string | null;
  error: string | null;
}

export interface PayOSPaymentResult {
  paymentRuntime?: { realtimeEnabled: boolean; pollingIntervalMs: number };
  localOrderId: string;
  orderStatus: OrderStatus;
  totalAmount: number;
  payment: PayOSPaymentSession | null;
  fixedTransfer: FixedTransferDetails | null;
  paymentVerificationStatus: PaymentVerificationStatus;
  nextAction: PayOSNextAction;
  serverTime: string;
  manualConfirmation: PayOSManualConfirmation | null;
  cancellationMode?: "REMOTE_CONFIRMED" | "LOCAL_ONLY";
}

export interface PayOSCheckoutController {
  session: PayOSPaymentSession | null;
  fixedTransfer: FixedTransferDetails | null;
  nextAction: PayOSNextAction | null;
  remainingSeconds: number;
  errorMessage: string | null;
  canConfirmManually: boolean;
  hasActiveTransfer: boolean;
  isCartLocked: boolean;
  isBusy: boolean;
  createPayment: () => Promise<void>;
  checkPayment: () => Promise<void>;
  retryDisplay: () => Promise<void>;
  recreatePayment: () => Promise<void>;
  cancelPayment: () => Promise<void>;
  confirmManually: () => Promise<void>;
}
