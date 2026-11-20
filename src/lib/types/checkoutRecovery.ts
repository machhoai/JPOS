import type {
  OrderItem,
  OrderMemberSnapshot,
  OrderStatus,
  OrderSyncStatus,
  PaymentMethod,
} from "@/lib/types/order";
import type { PosVoucherResolution } from "@/lib/types/voucher";

export type CheckoutCheckpoint =
  | "CART_READY"
  | "PAYMENT_INITIATED"
  | "PAYMENT_CONFIRMED"
  | "RECEIPT_PENDING"
  | "SYNC_PENDING"
  | "COMPLETED";

export interface CheckoutJournalRecord {
  id: "active-checkout";
  schemaVersion: 1;
  checkpoint: CheckoutCheckpoint;
  localOrderId: string | null;
  shopId: number;
  warehouseId: string;
  memberUid?: string | null;
  member?: OrderMemberSnapshot | null;
  items: OrderItem[];
  vouchers?: PosVoucherResolution[];
  paymentMethod: PaymentMethod;
  totalAmount: number;
  orderStatus: OrderStatus | null;
  syncStatus?: OrderSyncStatus | null;
  startedAt: string;
  updatedAt: string;
  lastError: string | null;
  recoveryCount: number;
}

export type PosFailureKind =
  | "RENDER_ERROR"
  | "UNHANDLED_ERROR"
  | "UNHANDLED_REJECTION"
  | "PAYMENT_ERROR"
  | "PRINT_ERROR";

export interface PendingPosFailure {
  id: string;
  kind: PosFailureKind;
  message: string;
  stack: string | null;
  route: string | null;
  actionTime: string;
  metadata: Record<string, string | number | boolean | null>;
}
