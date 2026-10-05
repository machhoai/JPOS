"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePayOSPaymentTimer } from "@/lib/hooks/usePayOSPaymentTimer";
import { logCheckoutTelemetry } from "@/lib/services/checkoutTelemetryService";
import { generateLocalOrderId } from "@/lib/services/orderService";
import { useCartStore } from "@/lib/stores/useCartStore";
import { usePayOSPaymentStore } from "@/lib/stores/usePayOSPaymentStore";
import type {
  OrderKind,
  OrderItem,
  OrderMemberSnapshot,
  OrderStatus,
} from "@/lib/types/order";
import type { PayOSCheckoutController } from "@/lib/types/payment";
import {
  showError,
  showInfo,
  showSuccess,
  showWarning,
} from "@/lib/utils/toast";
import { hasActiveTransfer } from "@/lib/utils/paymentState";

interface PayOSCheckoutInput {
  shopId: number;
  warehouseId: string | null;
  memberUid?: string | null;
  member?: OrderMemberSnapshot | null;
  draftOrderId: string | null;
  items: OrderItem[];
  voucherCodes?: string[];
  onCompleted: (
    localOrderId: string,
    status: OrderStatus,
  ) => void | Promise<void>;
  onCancelled?: () => void;
  manageCartLock?: boolean;
  requireRemoteCompletion?: boolean;
  orderKind?: OrderKind;
}

export function usePayOSCheckoutController({
  shopId,
  warehouseId,
  memberUid = null,
  member = null,
  draftOrderId,
  items,
  voucherCodes = [],
  onCompleted,
  onCancelled,
  manageCartLock = true,
  requireRemoteCompletion = false,
  orderKind = "STANDARD",
}: PayOSCheckoutInput): PayOSCheckoutController {
  const session = usePayOSPaymentStore((state) => state.session);
  const fixedTransfer = usePayOSPaymentStore((state) => state.fixedTransfer);
  const nextAction = usePayOSPaymentStore((state) => state.nextAction);
  const remainingSeconds = usePayOSPaymentStore(
    (state) => state.remainingSeconds,
  );
  const orderStatus = usePayOSPaymentStore((state) => state.orderStatus);
  const localOrderId = usePayOSPaymentStore((state) => state.localOrderId);
  const isCreating = usePayOSPaymentStore((state) => state.isCreating);
  const isChecking = usePayOSPaymentStore((state) => state.isChecking);
  const error = usePayOSPaymentStore((state) => state.error);
  const errorKind = usePayOSPaymentStore((state) => state.errorKind);
  const manualConfirmation = usePayOSPaymentStore(
    (state) => state.manualConfirmation,
  );
  const manuallyConfirmed = usePayOSPaymentStore((state) => state.manuallyConfirmed);
  const startPayment = usePayOSPaymentStore((state) => state.startPayment);
  const refreshPayment = usePayOSPaymentStore((state) => state.refreshPayment);
  const retryPaymentDisplay = usePayOSPaymentStore(
    (state) => state.retryDisplay,
  );
  const recreatePayOSPayment = usePayOSPaymentStore(
    (state) => state.recreatePayment,
  );
  const confirmPayOSManually = usePayOSPaymentStore(
    (state) => state.confirmManually,
  );
  const cancelPayOS = usePayOSPaymentStore((state) => state.cancelPayment);
  const resetPayment = usePayOSPaymentStore((state) => state.resetPayment);
  const isCartLocked = useCartStore((state) => state.isPaymentLocked);
  const lockCartForPayOS = useCartStore((state) => state.lockCartForPayOS);
  const unlockCartAfterCancellation = useCartStore(
    (state) => state.unlockCartAfterPayOSCancellation,
  );
  const lastErrorToast = useRef<string | null>(null);
  const completedOrderRef = useRef<string | null>(null);

  usePayOSPaymentTimer(Boolean(session) || isCartLocked);

  useEffect(() => {
    if (!error) {
      lastErrorToast.current = null;
      return;
    }
    if (lastErrorToast.current === error) return;
    lastErrorToast.current = error;
    if (errorKind === "CONNECTION") {
      showError(
        "Không kết nối được hệ thống chuyển khoản",
        "PayOS hiện không phản hồi. Hãy kiểm tra lại; chỉ xác nhận thủ công khi đã đối chiếu giao dịch thực tế.",
      );
      return;
    }
    showError(
      "Không thể xử lý thanh toán",
      "Hệ thống chưa hoàn tất thao tác. Vui lòng kiểm tra thông tin và thử lại.",
    );
  }, [error, errorKind]);

  useEffect(() => {
    if (
      nextAction !== "COMPLETED" ||
      !localOrderId ||
      completedOrderRef.current === localOrderId
    ) return;
    completedOrderRef.current = localOrderId;
    logCheckoutTelemetry("payment_detected", {
      localOrderId,
      orderKind,
      warehouseId,
      details: {
        paymentMethod: manuallyConfirmed || manualConfirmation || fixedTransfer?.status === "MANUALLY_CONFIRMED"
          ? "MANUAL_TRANSFER"
          : "PAYOS",
        orderStatus: orderStatus ?? "LOCAL_PAID",
      },
    });
    onCompleted(localOrderId, orderStatus ?? "LOCAL_PAID");
    if (
      manuallyConfirmed || manualConfirmation ||
      fixedTransfer?.status === "MANUALLY_CONFIRMED"
    ) {
      showWarning(
        "Đã xác nhận chuyển khoản thủ công",
        "Đơn đã hoàn thành và được đánh dấu Chưa được xác nhận thanh toán.",
      );
    } else if (requireRemoteCompletion) {
      showInfo(
        "Đã nhận thanh toán chuyển khoản",
        "Đang chờ OpenAPI xác nhận nạp gói vào tài khoản thành viên.",
      );
    } else {
      showSuccess(
        "Thanh toán chuyển khoản thành công",
        "Đơn hàng đã hoàn thành và đang được đồng bộ nền.",
      );
    }
    resetPayment();
  }, [
    localOrderId,
    manualConfirmation,
    manuallyConfirmed,
    fixedTransfer,
    nextAction,
    onCompleted,
    orderStatus,
    resetPayment,
    requireRemoteCompletion,
    orderKind,
    warehouseId,
  ]);

  const createPayment = useCallback(async () => {
    if (!warehouseId || items.length === 0) {
      showError(
        "Không thể tạo mã thanh toán",
        "Đơn hàng hoặc điểm bán chưa sẵn sàng.",
      );
      return;
    }
    const paymentOrderId = draftOrderId || localOrderId || generateLocalOrderId();
    if (manageCartLock && !lockCartForPayOS(paymentOrderId)) {
      showError(
        "Không thể khóa giỏ hàng",
        "Giỏ hàng đã thay đổi hoặc đang thuộc một phiên thanh toán khác.",
      );
      return;
    }
    showInfo("Đang tạo mã thanh toán", "Vui lòng chờ PayOS phản hồi.");
    try {
      const result = await startPayment({
        localOrderId: paymentOrderId,
        shopId,
        warehouseId,
        ...(memberUid ? { uid: memberUid } : {}),
        ...(member ? { member } : {}),
        items: items.map(({ goodsId, quantity }) => ({ goodsId, quantity })),
        voucherCodes,
      });
      if (result.nextAction === "WAIT") {
        showSuccess("Đã tạo mã thanh toán", "Mời khách quét mã QR để chuyển khoản.");
      } else if (result.nextAction === "FALLBACK") {
        const isFixedOnly = result.fixedTransfer?.reason === "FIXED_TRANSFER_ONLY";
        showWarning(
          "Đang dùng QR tài khoản cố định",
          isFixedOnly
            ? "Điểm bán đang bật chế độ chỉ dùng QR cố định. Nhân viên cần xác nhận thủ công."
            : "PayOS không tạo được mã. Giao dịch này cần nhân viên xác nhận thủ công.",
        );
      }
    } catch {
      // Store logs the technical error; the error effect shows friendly UI text.
    }
  }, [
    draftOrderId,
    items,
    localOrderId,
    lockCartForPayOS,
    manageCartLock,
    member,
    memberUid,
    shopId,
    startPayment,
    warehouseId,
    voucherCodes,
  ]);

  const checkPayment = useCallback(async () => {
    showInfo("Đang kiểm tra thanh toán", "Hệ thống đang đối chiếu trực tiếp với PayOS.");
    try {
      const result = await refreshPayment();
      if (result?.nextAction === "WAIT") {
        showWarning(
          "Hệ thống chưa nhận được thanh toán",
          "Vui lòng kiểm tra đúng số tiền và nội dung chuyển khoản, sau đó thử lại.",
        );
      }
    } catch {
      // Error feedback is centralized in the store error effect.
    }
  }, [refreshPayment]);

  const retryDisplay = useCallback(async () => {
    try {
      await retryPaymentDisplay();
      showSuccess("Đã tiếp tục hiển thị mã", "Lượt chờ mới kéo dài thêm 5 phút.");
    } catch {
      // Error feedback is centralized in the store error effect.
    }
  }, [retryPaymentDisplay]);

  const recreatePayment = useCallback(async () => {
    showInfo("Đang tạo lại mã thanh toán", "Mã cũ sẽ không còn được sử dụng.");
    try {
      await recreatePayOSPayment();
      showSuccess("Đã tạo mã thanh toán mới", "Mời khách quét mã QR mới.");
    } catch {
      // Error feedback is centralized in the store error effect.
    }
  }, [recreatePayOSPayment]);

  const confirmManually = useCallback(async () => {
    const accepted = window.confirm(
      "Chỉ xác nhận khi đã kiểm tra tài khoản ngân hàng và chắc chắn khách đã chuyển đủ tiền. Đơn sẽ được đánh dấu Chưa được xác nhận thanh toán. Bạn có tiếp tục không?",
    );
    if (!accepted) return;
    showInfo("Đang xác nhận thủ công", "Hệ thống đang hoàn tất và đánh dấu đơn hàng.");
    try {
      await confirmPayOSManually();
    } catch {
      // Error feedback is centralized in the store error effect.
    }
  }, [confirmPayOSManually]);

  const cancelPayment = useCallback(async () => {
    const orderId = localOrderId;
    const isFixedTransfer = fixedTransfer?.status === "AWAITING_MANUAL_CONFIRMATION";
    if (!orderId) {
      showError(
        "Không thể hủy mã thanh toán",
        "Không tìm thấy mã đơn PayOS để xác nhận hủy an toàn.",
      );
      return;
    }
    const accepted = window.confirm(
      isFixedTransfer
        ? "Bạn có chắc muốn hủy mã chuyển khoản dự phòng và quay lại giỏ hàng không?"
        : "Hệ thống sẽ yêu cầu PayOS hủy mã. Nếu PayOS không phản hồi, giỏ vẫn được mở khóa để bạn chọn hình thức thanh toán khác; hãy đảm bảo khách không tiếp tục dùng mã QR cũ. Bạn có chắc muốn hủy không?",
    );
    if (!accepted) return;
    showInfo(
      "Đang hủy mã thanh toán",
      isFixedTransfer ? "Vui lòng chờ hệ thống xử lý." : "Vui lòng chờ PayOS xác nhận.",
    );
    try {
      const result = await cancelPayOS();
      if (!result) return;
      if (result.nextAction === "COMPLETED") return;
      if (result.nextAction !== "RECREATE") {
        showWarning(
          "Chưa thể mở khóa giỏ hàng",
          "PayOS chưa xác nhận mã đã hủy. Giỏ hàng vẫn được khóa để tránh sai lệch thanh toán.",
        );
        return;
      }
      if (manageCartLock) unlockCartAfterCancellation(orderId);
      onCancelled?.();
      resetPayment();
      if (result.cancellationMode === "LOCAL_ONLY") {
        showWarning(
          "Đã hủy thanh toán tại POS",
          "Giỏ hàng đã được mở khóa. PayOS chưa xác nhận hủy mã cũ; không để khách tiếp tục quét hoặc chuyển khoản bằng mã đó.",
        );
        return;
      }
      showSuccess(
        "Đã hủy mã thanh toán",
        "Giỏ hàng đã được mở khóa; bạn có thể chọn hình thức thanh toán khác.",
      );
    } catch {
      showError(
        "Chưa thể hủy mã thanh toán",
        isFixedTransfer
          ? "Hệ thống chưa hủy được mã dự phòng. Vui lòng thử lại, đơn hàng không bị mất."
          : "Không kết nối được PayOS nên giỏ hàng vẫn được khóa. Vui lòng thử lại, đơn hàng không bị mất.",
      );
    }
  }, [
    cancelPayOS,
    fixedTransfer?.status,
    localOrderId,
    manageCartLock,
    onCancelled,
    resetPayment,
    unlockCartAfterCancellation,
  ]);

  return {
    session,
    fixedTransfer,
    nextAction,
    remainingSeconds,
    errorMessage: errorKind === "CONNECTION"
      ? "Hệ thống không kết nối được với hệ thống chuyển khoản."
      : error
        ? "Không thể xử lý thanh toán. Vui lòng thử lại."
        : null,
    canConfirmManually:
      fixedTransfer?.status === "AWAITING_MANUAL_CONFIRMATION" ||
      (Boolean(session) && nextAction !== "COMPLETED"),
    hasActiveTransfer: hasActiveTransfer({
      hasSession: Boolean(session),
      fixedTransferStatus: fixedTransfer?.status ?? null,
      isCartLocked,
    }),
    isCartLocked,
    isBusy: isCreating || isChecking,
    createPayment,
    checkPayment,
    retryDisplay,
    recreatePayment,
    cancelPayment,
    confirmManually,
  };
}
