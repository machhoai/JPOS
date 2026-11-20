"use client";

import { useEffect } from "react";

import { listenProductVisibility } from "@/lib/services/productVisibilityService";
import { useCartStore } from "@/lib/stores/useCartStore";
import { getProductGroupKey, useProductStore } from "@/lib/stores/useProductStore";
import { showError, showWarning } from "@/lib/utils/toast";

export function useProductVisibilitySync(warehouseId: string | null) {
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

  useEffect(() => useProductStore.subscribe((state, previous) => {
    const cart = useCartStore.getState();
    if (
      cart.isPaymentLocked || cart.isCheckingOut || !state.lastSyncAt ||
      (state.products === previous.products && state.visibilitySettings === previous.visibilitySettings)
    ) return;
    const hiddenGroups = new Set(state.visibilitySettings.disabledGroupKeys);
    const hiddenProducts = new Set(state.visibilitySettings.disabledProductIds);
    const products = new Map(state.products.map((product) => [product.goodsId, product]));
    const hiddenIds = cart.items
      .filter((item) => {
        const product = products.get(item.goodsId);
        return !product || hiddenProducts.has(item.goodsId) || hiddenGroups.has(getProductGroupKey(product));
      })
      .map((item) => item.goodsId);
    if (hiddenIds.length > 0) {
      cart.removeUnavailableItems(hiddenIds);
      showWarning("Giỏ hàng đã được cập nhật", `${hiddenIds.length} sản phẩm vừa ngừng bán đã được xóa khỏi giỏ.`);
    }
    const prices = new Map(state.products.map((product) => [
      product.goodsId, product.afterTaxPrice > 0 ? product.afterTaxPrice : product.price,
    ]));
    if (cart.refreshItemPrices(prices)) {
      showWarning("Giá sản phẩm đã thay đổi", "Kiểm tra số tiền mới trên giỏ trước khi thanh toán.");
    }
  }), []);
}
