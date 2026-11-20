"use client";

import { useEffect, useRef } from "react";

import { listenProductVisibility } from "@/lib/services/productVisibilityService";
import { useCartStore } from "@/lib/stores/useCartStore";
import { usePayOSPaymentStore } from "@/lib/stores/usePayOSPaymentStore";
import { getProductGroupKey, useProductStore } from "@/lib/stores/useProductStore";
import { showError, showWarning } from "@/lib/utils/toast";

export function useProductVisibilitySync(warehouseId: string | null) {
  const reconciling = useRef(false);

  useEffect(() => {
    if (!warehouseId) return;
    return listenProductVisibility(
      warehouseId,
      (settings) => useProductStore.getState().applyVisibilitySettings({
        version: settings?.version ?? 0,
        disabledGroupKeys: settings?.disabled_group_keys ?? [],
        disabledProductIds: settings?.disabled_product_ids ?? [],
      }),
      (error) => {
        console.error("[ProductVisibility] snapshot failed:", error);
        showError("Mất đồng bộ sản phẩm", "Không thể nhận cấu hình hiển thị mới từ JPULSE.");
      },
    );
  }, [warehouseId]);

  useEffect(() => useProductStore.subscribe(async (state, previous) => {
    if (
      reconciling.current ||
      state.products.length === 0 ||
      (state.products === previous.products && state.visibilitySettings === previous.visibilitySettings)
    ) return;
    const hiddenGroups = new Set(state.visibilitySettings.disabledGroupKeys);
    const hiddenProducts = new Set(state.visibilitySettings.disabledProductIds);
    const hiddenIds = useCartStore.getState().items
      .filter((item) => {
        const product = state.products.find(({ goodsId }) => goodsId === item.goodsId);
        return !product || hiddenProducts.has(item.goodsId) || hiddenGroups.has(getProductGroupKey(product));
      })
      .map((item) => item.goodsId);
    if (hiddenIds.length === 0) return;

    reconciling.current = true;
    try {
      const cart = useCartStore.getState();
      if (cart.isPaymentLocked) {
        const orderId = cart.paymentLockOrderId;
        const result = orderId
          ? await usePayOSPaymentStore.getState().cancelPayment(orderId)
          : null;
        const payment = usePayOSPaymentStore.getState();
        if (!orderId || result?.nextAction !== "RECREATE" ||
            payment.localOrderId !== orderId || payment.nextAction === "COMPLETED") {
          showWarning("Giỏ hàng vẫn được khóa", "Sản phẩm vừa ngừng bán nhưng chưa thể hủy thanh toán an toàn.");
          return;
        }
        useCartStore.getState().unlockCartAfterPayOSCancellation(
          orderId,
          result.cancellationMode !== "LOCAL_ONLY",
        );
        payment.resetPayment();
      }
      useCartStore.getState().removeUnavailableItems(hiddenIds);
      showWarning("Giỏ hàng đã được cập nhật", `${hiddenIds.length} sản phẩm vừa ngừng bán đã được xóa khỏi giỏ.`);
    } catch (error) {
      console.error("[ProductVisibility] cart reconciliation failed:", error);
      showError("Chưa thể cập nhật giỏ", "Không hủy được giao dịch đang chờ; giỏ vẫn được khóa để bảo vệ thanh toán.");
    } finally {
      reconciling.current = false;
    }
  }), []);
}
