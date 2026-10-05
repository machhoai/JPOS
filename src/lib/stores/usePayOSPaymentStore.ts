import { create } from "zustand";
import { logCheckoutTelemetry } from "@/lib/services/checkoutTelemetryService";
import type { PaymentStatusSnapshot } from "@/lib/services/paymentStatusService";
import { fetchOrderSyncStatus } from "@/lib/services/orderService";
import {
  cancelPayOSPayment,
  confirmPayOSPaymentManually,
  createPayOSPayment,
  fetchPayOSPaymentStatus,
  handlePayOSPaymentTimeout,
  recreatePayOSPayment,
  resumePayOSPayment,
  waitForPayOSStatusCheck,
  type CreatePayOSPaymentInput,
} from "@/lib/services/payOSService";
import type {
  FixedTransferDetails,
  OrderStatus,
  PayOSManualConfirmation,
} from "@/lib/types/order";
import type {
  PayOSErrorKind,
  PayOSNextAction,
  PayOSPaymentResult,
  PayOSPaymentSession,
} from "@/lib/types/payment";

interface PayOSPaymentState {
  realtimeEnabled: boolean;
  pollingIntervalMs: number;
  manuallyConfirmed: boolean;
  realtimeHealthy: boolean;
  setRealtimeHealthy: (healthy: boolean) => void;
  receivePaymentStatus: (snapshot: PaymentStatusSnapshot) => void;
  localOrderId: string | null;
  orderStatus: OrderStatus | null;
  session: PayOSPaymentSession | null;
  fixedTransfer: FixedTransferDetails | null;
  nextAction: PayOSNextAction | null;
  remainingSeconds: number;
  serverClockOffsetMs: number;
  isCreating: boolean;
  isChecking: boolean;
  isFallbackChecking: boolean;
  isPolling: boolean;
  error: string | null;
  errorKind: PayOSErrorKind | null;
  manualConfirmation: PayOSManualConfirmation | null;
  startPayment: (input: CreatePayOSPaymentInput) => Promise<PayOSPaymentResult>;
  refreshPayment: () => Promise<PayOSPaymentResult | null>;
  fallbackCheck: () => Promise<void>;
  checkOrderCompletion: () => Promise<boolean>;
  handleDisplayTimeout: () => Promise<PayOSPaymentResult | null>;
  retryDisplay: () => Promise<PayOSPaymentResult | null>;
  recreatePayment: () => Promise<PayOSPaymentResult | null>;
  cancelPayment: () => Promise<PayOSPaymentResult | null>;
  confirmManually: () => Promise<PayOSPaymentResult | null>;
  updateRemainingSeconds: (nowMs?: number) => void;
  resetPayment: () => void;
}

const completedStatuses: ReadonlySet<OrderStatus> = new Set([
  "LOCAL_PAID",
  "SYNCING",
  "SYNC_SUCCESS",
  "SYNC_FAILED",
]);

let paymentGeneration = 0;

function requestUpdate(set: (value: Partial<PayOSPaymentState>) => void) {
  const generation = paymentGeneration;
  return (value: Partial<PayOSPaymentState>) => {
    if (generation === paymentGeneration) set(value);
  };
}

const initialState = {
  realtimeEnabled: false,
  pollingIntervalMs: 15000,
  manuallyConfirmed: false,
  realtimeHealthy: false,
  localOrderId: null,
  orderStatus: null,
  session: null,
  fixedTransfer: null,
  nextAction: null,
  remainingSeconds: 0,
  serverClockOffsetMs: 0,
  isCreating: false,
  isChecking: false,
  isFallbackChecking: false,
  isPolling: false,
  error: null,
  errorKind: null,
  manualConfirmation: null,
} satisfies Pick<
  PayOSPaymentState,
  | "realtimeEnabled"
  | "pollingIntervalMs"
  | "manuallyConfirmed"
  | "realtimeHealthy"
  | "localOrderId"
  | "orderStatus"
  | "session"
  | "fixedTransfer"
  | "nextAction"
  | "remainingSeconds"
  | "serverClockOffsetMs"
  | "isCreating"
  | "isChecking"
  | "isFallbackChecking"
  | "isPolling"
  | "error"
  | "errorKind"
  | "manualConfirmation"
>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Không thể xử lý thanh toán PayOS. Vui lòng thử lại.";
}

function getErrorKind(error: unknown): PayOSErrorKind {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  return [
    "functions/unavailable",
    "functions/deadline-exceeded",
    "auth/network-request-failed",
  ].includes(code)
    ? "CONNECTION"
    : "GENERAL";
}

function resultState(result: PayOSPaymentResult, receivedAtMs = Date.now()) {
  const current = usePayOSPaymentStore.getState();
  if (current.localOrderId !== result.localOrderId ||
      (current.nextAction === "COMPLETED" && result.nextAction !== "COMPLETED") ||
      (current.session && result.payment && result.payment.orderCode < current.session.orderCode)) return {};
  const serverTimeMs = Date.parse(result.serverTime);
  const serverClockOffsetMs = Number.isFinite(serverTimeMs)
    ? serverTimeMs - receivedAtMs
    : 0;
  const displayExpiresAtMs = result.payment
    ? Date.parse(result.payment.displayExpiresAt)
    : 0;
  const remainingSeconds = result.nextAction === "WAIT"
    ? Math.max(
      0,
      Math.ceil(
        (displayExpiresAtMs - (receivedAtMs + serverClockOffsetMs)) / 1000,
      ),
    )
    : 0;

  return {
    realtimeEnabled: result.paymentRuntime?.realtimeEnabled ?? false,
    pollingIntervalMs: Math.max(5000, result.paymentRuntime?.pollingIntervalMs ?? 5000),
    manuallyConfirmed: result.paymentVerificationStatus === "UNVERIFIED" && result.nextAction === "COMPLETED",
    localOrderId: result.localOrderId,
    orderStatus: result.orderStatus,
    session: result.payment,
    fixedTransfer: result.fixedTransfer,
    nextAction: result.nextAction,
    remainingSeconds,
    serverClockOffsetMs,
    error: null,
    errorKind: null,
    manualConfirmation: result.manualConfirmation,
  };
}

export const usePayOSPaymentStore = create<PayOSPaymentState>((set, get) => ({
  ...initialState,
  setRealtimeHealthy: (realtimeHealthy) => set({ realtimeHealthy }),
  receivePaymentStatus: (snapshot) => {
    const state = get();
    if (snapshot.localOrderId !== state.localOrderId || state.nextAction === "COMPLETED") return;
    // An older QR may legitimately pay this same order. The backend has already
    // verified its amount/link before atomically publishing LOCAL_PAID.
    if (!completedStatuses.has(snapshot.orderStatus)) return;
    logCheckoutTelemetry("payment_status_received", {
      localOrderId: snapshot.localOrderId,
      details: { paidAt: snapshot.paidAt, receivedAt: new Date().toISOString(), source: snapshot.confirmationSource ?? null },
    });
    set({ orderStatus: snapshot.orderStatus, nextAction: "COMPLETED", remainingSeconds: 0,
      manuallyConfirmed: snapshot.confirmationSource === "MANUAL" });
  },

  startPayment: async (input) => {
    paymentGeneration++;
    const update = requestUpdate(set);
    set({
      ...initialState,
      localOrderId: input.localOrderId,
      isCreating: true,
      error: null,
      errorKind: null,
    });
    try {
      const result = await createPayOSPayment(input);
      update({ ...resultState(result), isCreating: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể tạo mã thanh toán:", error);
      update({
        isCreating: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  refreshPayment: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isChecking || get().isFallbackChecking) {
      return null;
    }
    set({ isChecking: true, error: null, errorKind: null });
    try {
      const result = await fetchPayOSPaymentStatus(localOrderId);
      update({ ...resultState(result), isChecking: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể cập nhật trạng thái thanh toán:", error);
      update({
        isChecking: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  fallbackCheck: async () => {
    const update = requestUpdate(set);
    const { localOrderId, isChecking, isFallbackChecking, nextAction } = get();
    if (
      !localOrderId ||
      isChecking ||
      isFallbackChecking ||
      nextAction !== "WAIT"
    ) return;
    set({ isFallbackChecking: true });
    try {
      const result = await fetchPayOSPaymentStatus(localOrderId);
      if (get().localOrderId === localOrderId) {
        update({ ...resultState(result), isFallbackChecking: false });
      }
    } catch (error: unknown) {
      console.error("[PayOS] Kiểm tra dự phòng định kỳ thất bại:", error);
      if (get().localOrderId === localOrderId) {
        update({ isFallbackChecking: false });
      }
    }
  },

  checkOrderCompletion: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isPolling) return false;
    set({ isPolling: true });
    try {
      const order = await fetchOrderSyncStatus(localOrderId);
      if (get().localOrderId !== localOrderId) {
        update({ isPolling: false });
        return false;
      }
      const completed = completedStatuses.has(order.status);
      update({
        isPolling: false,
        ...(get().nextAction !== "COMPLETED" || completed ? { orderStatus: order.status } : {}),
        ...(completed
          ? { nextAction: "COMPLETED" as const, remainingSeconds: 0 }
          : {}),
      });
      return completed;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể theo dõi trạng thái đơn hàng:", error);
      update({ isPolling: false });
      return false;
    }
  },

  handleDisplayTimeout: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isChecking) return null;
    set({
      isChecking: true,
      remainingSeconds: 0,
      error: null,
      errorKind: null,
    });
    try {
      await waitForPayOSStatusCheck(localOrderId);
      if (get().localOrderId !== localOrderId || get().nextAction === "COMPLETED") {
        update({ isChecking: false });
        return null;
      }
      const result = await handlePayOSPaymentTimeout(localOrderId);
      update({ ...resultState(result), isChecking: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể kiểm tra khi hết lượt hiển thị:", error);
      update({
        isChecking: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  retryDisplay: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isChecking) return null;
    set({ isChecking: true, error: null, errorKind: null });
    try {
      const result = await resumePayOSPayment(localOrderId);
      update({ ...resultState(result), isChecking: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể gia hạn lượt hiển thị:", error);
      update({
        isChecking: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  recreatePayment: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isCreating) return null;
    set({ isCreating: true, error: null, errorKind: null });
    try {
      const result = await recreatePayOSPayment(localOrderId);
      update({ ...resultState(result), isCreating: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể tạo lại mã thanh toán:", error);
      update({
        isCreating: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  cancelPayment: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isChecking) return null;
    set({ isChecking: true, error: null, errorKind: null });
    try {
      const result = await cancelPayOSPayment(localOrderId);
      update({ ...resultState(result), isChecking: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể hủy thanh toán:", error);
      update({
        isChecking: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  confirmManually: async () => {
    const update = requestUpdate(set);
    const localOrderId = get().localOrderId;
    if (!localOrderId || get().isChecking) return null;
    set({ isChecking: true, error: null, errorKind: null });
    try {
      const result = await confirmPayOSPaymentManually(localOrderId);
      update({ ...resultState(result), isChecking: false });
      return result;
    } catch (error: unknown) {
      console.error("[PayOS] Không thể xác nhận chuyển khoản thủ công:", error);
      update({
        isChecking: false,
        error: getErrorMessage(error),
        errorKind: getErrorKind(error),
      });
      throw error;
    }
  },

  updateRemainingSeconds: (nowMs = Date.now()) => {
    const { session, nextAction, serverClockOffsetMs } = get();
    if (!session || nextAction !== "WAIT") {
      set({ remainingSeconds: 0 });
      return;
    }
    const remainingSeconds = Math.max(
      0,
      Math.ceil(
        (Date.parse(session.displayExpiresAt) -
          (nowMs + serverClockOffsetMs)) / 1000,
      ),
    );
    set({ remainingSeconds });
  },

  resetPayment: () => {
    paymentGeneration++;
    set(initialState);
  },
}));
