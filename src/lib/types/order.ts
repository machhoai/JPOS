import type { PosOrderVoucherSnapshot } from "@/lib/types/voucher";

// =============================================================================
// POS Order Types — Shared between frontend (Next.js) and backend (Cloud Functions)
// =============================================================================

/** Possible states an order can be in throughout its lifecycle. */
export type OrderStatus =
  | "DRAFT"        // Order is being built in the cashier's cart
  | "LOCAL_PAID"   // Payment completed locally, awaiting sync to HK API
  | "SYNCING"      // Currently being sent to the remote HK API
  | "SYNC_SUCCESS" // Successfully synced with HK API
  | "SYNC_FAILED"; // Sync attempt failed (will be retried)

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

/** Accepted payment methods at the POS terminal. */
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

/** A single line item in an order. */
export interface OrderItem {
  goodsId: string;
  goodsName: string;
  /** Giá bán một đơn vị đã bao gồm thuế. */
  price: number;
  quantity: number;
  /** Giá một đơn vị trước thuế, được chốt tại thời điểm tạo đơn. */
  unitPriceBeforeTax?: number;
  /** Thuế suất phần trăm được chốt tại thời điểm tạo đơn. */
  taxRate?: number;
  /** Tổng tiền thuế của dòng hàng. */
  taxAmount?: number;
  /** Số vé cần in cho mỗi đơn vị sản phẩm, được snapshot khi tạo đơn. */
  ticketsPerUnit?: number;
  /** Mã duy nhất của từng vé vật lý, được backend tạo và lưu cùng đơn. */
  ticketCodes?: string[];
  /** Số phiếu bốc thăm trên mỗi gói, được snapshot tại thời điểm tạo đơn. */
  luckyDrawTicketsPerUnit?: number;
}

/** Metadata tracking the sync process with the remote HK API. */
export interface SyncMetadata {
  retryCount: number;
  lastError: string | null;
  syncedAt: string | null; // ISO 8601 string
}

/** PayOS status stored locally for each generated payment link. */
export type PayOSPaymentStatus =
  | "CREATING"
  | "PENDING"
  | "PROCESSING"
  | "UNDERPAID"
  | "PAID"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

/** One PayOS QR attempt. Old attempts remain available for delayed webhooks. */
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

/**
 * The primary order document stored in Firestore `pos_orders` collection.
 *
 * Lifecycle:
 *   DRAFT → LOCAL_PAID → SYNCING → SYNC_SUCCESS
 *                                 → SYNC_FAILED (retryable)
 */
export interface PosOrder {
  /** Opaque ID for the device-scoped payment status projection. */
  paymentWatchId?: string;
  /** Unique local order ID, e.g., 'ORD-1715420000-001' */
  localOrderId: string;

  /** Order number returned by the HK API after successful sync */
  hkOrderNumber: string | null;

  /** Số tiền order_create trả về, dùng đối soát đơn gói thành viên. */
  remoteActualPayment?: number | null;
  /** Opaque bearer token encoded in the public invoice-request QR. */
  invoiceRequestToken?: string;

  /** ISO timestamp when the public invoice-request capability was created. */
  invoiceRequestCreatedAt?: string;

  /** The shop this order belongs to */
  shopId: number;

  /** Warehouse selected in the shared bduck-system session */
  warehouseId?: string;

  /** Firebase UID of the cashier who created the order */
  createdBy?: string;

  /** Operator identity recorded from the authenticated bduck-system user */
  operatorId?: string;
  operatorFirebaseUid?: string;
  operatorName?: string;

  /** Luồng nghiệp vụ; đơn cũ không có field này được hiểu là STANDARD. */
  orderKind?: OrderKind;

  /** UID thành viên trên OpenAPI, chỉ dùng ở backend khi tạo đơn từ xa. */
  uid?: string;

  /** Snapshot thành viên tại thời điểm bán, phục vụ lịch sử đơn và tích điểm. */
  member?: OrderMemberSnapshot;

  /** Current status in the order lifecycle */
  status: OrderStatus;
  /** Payment and synchronization are independent after cancellation/refund. */
  paymentStatus?: OrderPaymentStatus;
  syncStatus?: OrderSyncStatus;
  cancellationOperationId?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  refundOrderNumber?: string | null;

  /** How the customer paid */
  paymentMethod: PaymentMethod;
  paymentMethodId?: string;
  paymentMethodName?: string;

  /** Total amount in the local currency */
  totalAmount: number;

  /** Tổng giá trị trước ưu đãi voucher. */
  subtotalAmount?: number;

  /** Tổng số tiền được giảm bởi voucher. */
  discountAmount?: number;

  /** Các mã voucher được backend xác nhận cho đơn. */
  voucherCodes?: string[];

  /** Snapshot quyền lợi voucher tại thời điểm thanh toán. */
  vouchers?: PosOrderVoucherSnapshot[];

  /** Line items in the order */
  items: OrderItem[];

  /** All PayOS order codes generated for webhook lookup. */
  payosOrderCodes?: number[];

  /** PayOS QR session data. Present only for transfer payments. */
  paymentDetails?: PayOSPaymentDetails;

  /** QR tài khoản cố định được dùng khi PayOS không thể cung cấp mã. */
  fixedTransferDetails?: FixedTransferDetails;

  /** UNVERIFIED means manual checkout without provider confirmation. */
  paymentVerificationStatus?: PaymentVerificationStatus;
  payosReconciliation?: PayOSReconciliation;

  /** Tên khách hàng (nếu là thành viên) */
  customerName?: string;

  /** SĐT khách hàng (nếu là thành viên) */
  customerPhone?: string;

  /** Mã voucher đã áp dụng */
  voucherCode?: string;

  /** Số tiền giảm từ voucher */
  voucherDiscount?: number;

  /** Sync metadata for the background worker */
  sync: SyncMetadata;

  /** ISO 8601 timestamp when the order was created */
  createdAt: string;

  /** ISO 8601 timestamp when the order was last updated */
  updatedAt?: string;

  /** ISO 8601 timestamp when local payment completed */
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

/**
 * Fields required to create a new order.
 * `localOrderId`, `createdAt`, `sync`, `status`, and `hkOrderNumber` are auto-generated.
 */
export type CreateOrderInput = Pick<
  PosOrder,
  "shopId" | "paymentMethod" | "totalAmount" | "items"
>;
