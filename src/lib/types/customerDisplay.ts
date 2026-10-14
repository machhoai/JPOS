// =============================================================================
// Customer Display Types — Hợp đồng dữ liệu an toàn giữa hai cửa sổ POS
// =============================================================================

/** Chế độ hiển thị chính của màn hình khách. */
export type CustomerDisplayMode =
  | "IDLE"
  | "CART"
  | "TRANSFER"
  | "SUCCESS"
  | "MEMBER_REVIEW"
  | "MEMBER_SUCCESS";

/** Trạng thái kết nối giữa cửa sổ thu ngân và cửa sổ khách. */
export type CustomerDisplayConnectionStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED";

/** Phương thức thanh toán đã được chuẩn hóa cho màn hình khách. */
export type CustomerDisplayPaymentMethod = "CASH" | "TRANSFER";

/** Dữ liệu quảng cáo mock cục bộ, không được đồng bộ lên Firestore. */
export interface CustomerDisplayAdvertisement {
  id: string;
  badge: string;
  title: string;
  description: string;
  highlight: string;
  icon: "COFFEE" | "GIFT" | "SPARKLES";
  tone: "ORANGE" | "EMERALD" | "SKY";
}

/** Trạng thái thanh toán công khai, không lộ trạng thái vận hành nội bộ. */
export type CustomerDisplayPaymentStatus =
  | "NOT_STARTED"
  | "CREATING"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "EXPIRED"
  | "CANCELLED"
  | "ERROR";

/** Một dòng hàng chỉ chứa thông tin khách hàng cần nhìn thấy, không kèm trạng thái hệ thống. */
export interface CustomerDisplayItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

/** Thông tin thành viên an toàn để hiển thị công khai cho chính khách hàng. */
export interface CustomerDisplayOrderMemberSnapshot {
  fullName: string;
  phone: string;
  memberCode: string | null;
  levelName: string;
}

/** Ảnh chụp đơn hàng đã loại bỏ mã nội bộ và thông tin vận hành. */
export interface CustomerDisplayOrderSnapshot {
  items: readonly CustomerDisplayItem[];
  totalAmount: number;
  paymentMethod: CustomerDisplayPaymentMethod;
  member?: CustomerDisplayOrderMemberSnapshot | null;
}

export interface CustomerDisplayMemberSnapshot {
  fullName: string;
  phone: string;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  birthDate: string | null;
  email: string | null;
  memberCode: string | null;
  /** Chỉ có khi hiển thị kết quả tra cứu thành viên. */
  balances: {
    integral: number;
    bonus: number;
    principalVnd: number;
    turns: number;
  } | null;
}

/** Dữ liệu QR hiện tại; value là chuỗi QR có thể hiển thị cho khách. */
export interface CustomerDisplayQr {
  value: string | null;
  imageUrl: string | null;
  /** Số tiền chính xác của attempt PayOS đang hoạt động. */
  amount: number;
  /** Nội dung chuyển khoản do PayOS cấp cho attempt hiện tại. */
  description: string;
  /** Số giây còn lại đã được cửa sổ thu ngân hiệu chỉnh theo giờ máy chủ. */
  remainingSeconds: number;
  /** Thời điểm tạo snapshot để cửa sổ khách tiếp tục đếm cục bộ. */
  snapshotAt: number;
  /** Thời điểm QR ngừng hiển thị, định dạng ISO 8601. */
  expiresAt: string;
  accountName: string;
  accountNumber: string;
  manualConfirmationRequired: boolean;
}

export type CustomerDisplayTransferPayment =
  | { status: "CREATING"; qr: null }
  | { status: "AWAITING_PAYMENT"; qr: CustomerDisplayQr }
  | { status: "EXPIRED" | "CANCELLED" | "ERROR"; qr: null };

interface CustomerDisplayBaseState {
  mode: CustomerDisplayMode;
  connectionStatus: CustomerDisplayConnectionStatus;
}

/** Chỉ hiển thị quảng cáo, chưa có đơn hàng. */
export interface CustomerDisplayIdleState extends CustomerDisplayBaseState {
  mode: "IDLE";
  order: null;
  payment: { status: "NOT_STARTED"; qr: null };
}

/** Hiển thị quảng cáo song song với đơn hàng, chưa có phiên QR. */
export interface CustomerDisplayCartState extends CustomerDisplayBaseState {
  mode: "CART";
  order: CustomerDisplayOrderSnapshot;
  payment: { status: "NOT_STARTED"; qr: null };
}

/** Hiển thị đơn chuyển khoản và trạng thái QR hiện tại. */
export interface CustomerDisplayTransferState extends CustomerDisplayBaseState {
  mode: "TRANSFER";
  order: CustomerDisplayOrderSnapshot & { paymentMethod: "TRANSFER" };
  payment: CustomerDisplayTransferPayment;
}

/** Hiển thị xác nhận thanh toán thành công; QR cũ không còn được phát đi. */
export interface CustomerDisplaySuccessState extends CustomerDisplayBaseState {
  mode: "SUCCESS";
  order: CustomerDisplayOrderSnapshot;
  payment: { status: "PAID"; qr: null };
}

export interface CustomerDisplayMemberState extends CustomerDisplayBaseState {
  memberAction?: "REGISTER" | "EDIT";
  mode: "MEMBER_REVIEW" | "MEMBER_SUCCESS";
  member: CustomerDisplayMemberSnapshot;
  order: CustomerDisplayOrderSnapshot | null;
  payment: { status: "NOT_STARTED"; qr: null };
}

/**
 * Payload duy nhất được phép truyền sang cửa sổ khách.
 *
 * Không thêm UID, token, mã đơn nội bộ, mã PayOS nội bộ, thông tin nhân viên,
 * dữ liệu đồng bộ, thông báo vận hành hoặc secret vào hợp đồng này.
 */
export type CustomerDisplayState =
  | CustomerDisplayIdleState
  | CustomerDisplayCartState
  | CustomerDisplayTransferState
  | CustomerDisplaySuccessState
  | CustomerDisplayMemberState;
