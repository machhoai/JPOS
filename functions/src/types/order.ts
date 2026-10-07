import type { PosOrderVoucherSnapshot } from "./voucher";

// =============================================================================
// POS Order Types — Shared interface (duplicated from frontend for isolation)
// =============================================================================
// Cloud Functions have their own node_modules and cannot import from the
// Next.js `src/` directory. This is a deliberate duplication to keep the
// two projects decoupled.
//
// If you add fields to the frontend PosOrder, update this file as well.
// =============================================================================

/** Order status lifecycle. */
export type OrderStatus =
  | "DRAFT"
  | "LOCAL_PAID"
  | "SYNCING"
  | "SYNC_SUCCESS"
  | "SYNC_FAILED";

export type OrderPaymentStatus =
  | "DRAFT"
  | "PAID"
  | "REFUNDING"
  | "REFUNDED"
  | "REFUND_FAILED"
  | "REFUND_UNKNOWN";

export type OrderSyncStatus =
  | "NOT_SYNCED"
  | "PENDING"
  | "SYNCING"
  | "SYNC_FAILED"
  | "SYNC_SUCCESS"
  | "CANCELLED";

/** Payment methods. */
export type PaymentMethod = "CASH" | "QR_CODE";
export type OrderKind = "STANDARD" | "MEMBER_PACKAGE";

/** Member details captured when the member is attached to an order. */
export interface OrderMemberSnapshot {
  uid: string;
  memberCode: string | null;
  fullName: string;
  phone: string;
  levelName: string;
}

/** A single line item. */
export interface OrderItem {
  goodsId: string;
  goodsName: string;
  /** Tax-inclusive unit price charged to the customer. */
  price: number;
  quantity: number;
  /** Authoritative pre-tax unit price at order creation time. */
  unitPriceBeforeTax?: number;
  /** Derived tax percentage at order creation time. */
  taxRate?: number;
  /** Total tax amount for this line. */
  taxAmount?: number;
  /** Authoritative ticket quantity captured from the local product catalog. */
  ticketsPerUnit?: number;
  /** Stable codes for every physical ticket belonging to this line item. */
  ticketCodes?: string[];
  /** Lucky-draw entries granted per sold member package, snapshotted at sale time. */
  luckyDrawTicketsPerUnit?: number;
}

/** Sync metadata. */
export interface SyncMetadata {
  retryCount: number;
  lastError: string | null;
  syncedAt: string | null;
}

export type PayOSPaymentStatus =
  | "CREATING"
  | "PENDING"
  | "PROCESSING"
  | "UNDERPAID"
  | "PAID"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export interface PayOSPaymentAttempt {
  orderCode: number;
  status: PayOSPaymentStatus;
  amount: number;
  description: string;
  createdAt: string;
  linkExpiresAt: string;
  displayExpiresAt: string;
  paymentLinkId?: string;
  checkoutUrl?: string;
  qrCode?: string;
  bin?: string;
  accountNumber?: string;
  accountName?: string;
  currency?: string;
  updatedAt?: string;
  paidAt?: string;
  paidAmount?: number;
  qrReadyAt?: string;
  createRequestStartedAt?: string;
  confirmationSource?: "WEBHOOK" | "API_CHECK";
  webhookReceivedAt?: string;
  reference?: string;
  transactionDateTime?: string;
  error?: string;
  /** ISO timestamp when the cashier abandoned this QR at the POS. */
  locallyCancelledAt?: string;
  /** Whether PayOS confirmed the cancellation or could not be reached. */
  remoteCancellationConfirmed?: boolean;
}

export interface PayOSPaymentDetails {
  provider: "payos";
  currentOrderCode: number;
  attempts: PayOSPaymentAttempt[];
  lastCheckedAt?: string;
  lastError?: string | null;
  lastConnectionErrorAt?: string;
  manualConfirmation?: PayOSManualConfirmation;
}

export interface PayOSManualConfirmation {
  confirmedAt: string;
  confirmedByUid: string;
  confirmedByName: string;
  reason: "PAYOS_UNAVAILABLE" | "PAYOS_NOT_CONFIRMED";
  note: string;
  previousPaymentStatus: PayOSPaymentStatus;
}

export type PaymentVerificationStatus = "VERIFIED" | "UNVERIFIED";

export type FixedTransferStatus =
  | "AWAITING_MANUAL_CONFIRMATION"
  | "MANUALLY_CONFIRMED"
  | "CANCELLED";

export type FixedTransferReason =
  | "PAYOS_CREATE_FAILED"
  | "PAYOS_QR_MISSING"
  | "FIXED_TRANSFER_ONLY";

export interface FixedTransferDetails {
  provider: "vietqr_quicklink";
  status: FixedTransferStatus;
  reason: FixedTransferReason;
  bankBin: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  description: string;
  qrImageUrl: string;
  settingsVersion: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedByUid?: string;
  confirmedByName?: string;
}

/** The POS order document in Firestore. */
export interface PosOrder {
  /** Opaque ID for the device-scoped payment status projection. */
  paymentWatchId?: string;
  localOrderId: string;
  hkOrderNumber: string | null;
  /** Amount returned by order_create, retained for member-sale reconciliation. */
  remoteActualPayment?: number | null;
  /** Opaque bearer token encoded in the public invoice-request QR. */
  invoiceRequestToken?: string;
  /** ISO timestamp when the public invoice-request capability was created. */
  invoiceRequestCreatedAt?: string;
  shopId: number;
  warehouseId: string;
  deviceId?: string;
  createdBy: string;
  operatorId: string;
  operatorFirebaseUid: string;
  operatorName: string;
  /** Business flow; omitted on legacy orders and treated as STANDARD. */
  orderKind?: OrderKind;
  /** HK system member UID — required by the 鲸舰 API for order_create */
  uid?: string;
  /** Member snapshot retained with the local order for history and loyalty. */
  member?: OrderMemberSnapshot;
  status: OrderStatus;
  /** Independent lifecycle projections; optional until historical backfill completes. */
  paymentStatus?: OrderPaymentStatus;
  syncStatus?: OrderSyncStatus;
  /** Optimistic-concurrency version managed by backend/Functions transactions. */
  version?: number;
  /** Runtime source marker. Imported JoyWorld history is read-only in JPULSE. */
  source?: "JPOS" | "JOYWORLD_IMPORT";
  remoteOrderId?: string | null;
  cancellationOperationId?: string | null;
  syncOperationId?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  refundOrderNumber?: string | null;
  paymentMethod: PaymentMethod;
  paymentMethodId: string;
  paymentMethodName: string;
  /** Authoritative total before voucher benefits. */
  subtotalAmount?: number;
  /** Total voucher benefit applied to the order. */
  discountAmount?: number;
  totalAmount: number;
  voucherCodes?: string[];
  vouchers?: PosOrderVoucherSnapshot[];
  items: OrderItem[];
  /** Every PayOS order code ever created for this order, used by the webhook. */
  payosOrderCodes?: number[];
  paymentDetails?: PayOSPaymentDetails;
  fixedTransferDetails?: FixedTransferDetails;
  paymentVerificationStatus?: PaymentVerificationStatus;
  payosReconciliation?: PayOSReconciliation;
  sync: SyncMetadata;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
}

export interface PayOSReconciliation {
  dueAt: string;
  nextCheckAt: string | null;
  lastCheckedAt?: string;
  lastError?: string | null;
  alertedAt?: string;
  verifiedAt?: string;
  confirmationSource?: "WEBHOOK" | "API_CHECK";
  orderCode?: number;
  acknowledgedBy?: string[];
}
