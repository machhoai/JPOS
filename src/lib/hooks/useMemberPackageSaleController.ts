"use client";

import { openCashDrawerAfterPayment } from "@/features/printer/services/cashDrawerService";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePayOSCheckoutController } from "@/lib/hooks/usePayOSCheckoutController";
import { lookupMember, toMemberServiceError } from "@/lib/services/memberService";
import {
  finalizeMemberPackageSale,
  prepareMemberPackageOrder,
  sellMemberPackageForCash,
} from "@/lib/services/memberPackageService";
import { generateLocalOrderId } from "@/lib/services/orderService";
import { logCheckoutTelemetry } from "@/lib/services/checkoutTelemetryService";
import {
  selectSelectedMemberPackage,
  useMemberStore,
} from "@/lib/stores/useMemberStore";
import type { PaymentMethod } from "@/lib/types/order";
import type { Product } from "@/lib/types/product";
import { showPromise, showWarning } from "@/lib/utils/toast";

function clickButton(id: string): void {
  const button = document.getElementById(id);
  if (button instanceof HTMLButtonElement) button.click();
}

interface MemberPackageSaleControllerInput {
  shopId: number;
  warehouseId: string | null;
  products: Product[];
  productsLoading: boolean;
  productsError: string | null;
  reloadProducts: () => Promise<void>;
  onSaleCompleted?: (localOrderId: string) => void | Promise<void>;
}

const MEMBER_PACKAGE_CATEGORIES = new Set([1, 2, 6]);

export function isMemberPackageProduct(product: Product): boolean {
  return MEMBER_PACKAGE_CATEGORIES.has(product.category);
}

function toCachedMemberPackage(product: Product) {
  const paymentAmountVnd = product.afterTaxPrice > 0
    ? product.afterTaxPrice
    : product.price;
  const principalPoints = Math.max(0, product.principalPoints ?? 0);
  const bonusPoints = Math.max(0, product.bonusPoints ?? 0);

  return {
    goodsId: product.goodsId,
    name: product.goodsName,
    description: product.description ?? "",
    badge: product.badge ?? "",
    paymentAmountVnd,
    originalAmountVnd: product.underlinePrice > 0
      ? product.underlinePrice
      : paymentAmountVnd,
    discountAmountVnd: 0,
    priceBeforeTaxVnd: product.price,
    taxRate: product.taxRate,
    taxRateType: product.taxRateType ?? 1,
    principalPoints,
    bonusBucketPoints: bonusPoints,
    totalPoints: principalPoints + bonusPoints,
    extraBonusPoints: null,
    credits: [],
    category: product.category,
    typeName: product.typeName || product.subCategory,
    foreColor: product.foreColor,
    backColor: product.backColor,
  };
}

export function useMemberPackageSaleController({
  shopId,
  warehouseId,
  products,
  productsLoading,
  productsError,
  reloadProducts,
  onSaleCompleted,
}: MemberPackageSaleControllerInput) {
  const member = useMemberStore((state) => state.currentMember);
  const packages = useMemberStore((state) => state.packages);
  const packagesRequest = useMemberStore((state) => state.packagesRequest);
  const selectedPackage = useMemberStore(selectSelectedMemberPackage);
  const mutation = useMemberStore((state) => state.mutation);
  const lookupMode = useMemberStore((state) => state.lookupMode);
  const lookupQuery = useMemberStore((state) => state.lookupQuery);
  const cardReaderStatus = useMemberStore((state) => state.cardReaderStatus);
  const startLoading = useMemberStore((state) => state.startLoadingPackages);
  const setPackages = useMemberStore((state) => state.setPackages);
  const failLoading = useMemberStore((state) => state.failLoadingPackages);
  const selectPackage = useMemberStore((state) => state.selectPackage);
  const startMutation = useMemberStore((state) => state.startMutation);
  const markWaitingApi = useMemberStore((state) => state.markMutationWaitingApi);
  const completeMutation = useMemberStore((state) => state.completeMutation);
  const failMutation = useMemberStore((state) => state.failMutation);
  const resetMutation = useMemberStore((state) => state.resetMutation);
  const completeLookup = useMemberStore((state) => state.completeLookup);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [isCheckoutOpen, setCheckoutOpen] = useState(false);
  const [localOrderId, setLocalOrderId] = useState<string | null>(null);
  const [paymentCollected, setPaymentCollected] = useState(false);
  const cachedPackages = useMemo(
    () => products
      .filter(isMemberPackageProduct)
      .map(toCachedMemberPackage),
    [products],
  );

  const loadPackages = useCallback(async () => {
    startLoading();
    await reloadProducts();
  }, [reloadProducts, startLoading]);

  useEffect(() => {
    if (!member || !warehouseId) return;
    if (productsLoading) {
      startLoading();
      return;
    }
    if (productsError) {
      failLoading(productsError, "CATALOG_LOAD_FAILED");
      return;
    }
    setPackages(cachedPackages);
  }, [
    cachedPackages,
    failLoading,
    member,
    productsError,
    productsLoading,
    setPackages,
    startLoading,
    warehouseId,
  ]);

  const refreshMember = useCallback(async () => {
    if (!member || !warehouseId) return;
    const useCardQuery = lookupMode === "CARD" && lookupQuery.trim().length > 0;
    const result = await lookupMember({
      shopId,
      warehouseId,
      mode: useCardQuery ? "CARD" : "PHONE",
      query: useCardQuery ? lookupQuery : member.phone,
      selectedUid: useCardQuery ? undefined : member.uid,
      cardLookupKind: useCardQuery && cardReaderStatus === "SUCCEEDED"
        ? "SERIAL_NUMBER"
        : undefined,
    });
    if (result.member.uid !== member.uid) {
      throw new Error("Kết quả tải lại không khớp thành viên vừa nạp thẻ.");
    }
    completeLookup(result.member);
  }, [cardReaderStatus, completeLookup, lookupMode, lookupQuery, member, shopId, warehouseId]);

  const completeSuccessfulSale = useCallback(async (
    orderId: string,
    remoteOrderNumber: string | null,
  ) => {
    completeMutation(remoteOrderNumber ?? undefined);
    try {
      await onSaleCompleted?.(orderId);
    } catch (error: unknown) {
      console.error("[Thành viên] Hậu xử lý biên lai thất bại:", error);
    }
    try {
      await refreshMember();
    } catch (error: unknown) {
      const serviceError = toMemberServiceError(error);
      console.error("[Thành viên] Không thể tải lại số dư sau khi nạp gói:", serviceError);
      showWarning(
        "Đã nạp gói nhưng chưa tải lại được số dư",
        serviceError.message,
      );
    }
  }, [completeMutation, onSaleCompleted, refreshMember]);

  const finishRemoteSale = useCallback(async (
    orderId: string,
    sourcePaymentMethod: PaymentMethod = "QR_CODE",
  ) => {
    setPaymentCollected(true);
    setCheckoutOpen(false);
    markWaitingApi();
    logCheckoutTelemetry("openapi_finalize_started", {
      localOrderId: orderId,
      orderKind: "MEMBER_PACKAGE",
      warehouseId,
      details: { paymentMethod: sourcePaymentMethod },
    });
    try {
      const result = await showPromise(finalizeMemberPackageSale(orderId), {
        loading: "OpenAPI đang nạp gói vào thẻ...",
        success: "Nạp gói thành công",
        error: "OpenAPI chưa hoàn tất nạp gói",
        successDescription: "Đơn đã được xác nhận thanh toán và cộng điểm.",
        errorDescription: "Tiền đã được ghi nhận. Không tạo đơn mới; hãy thử lại đơn hiện tại.",
        onRetry: () => clickButton("member-package-retry-remote"),
      });
      logCheckoutTelemetry("openapi_finalize_completed", {
        localOrderId: orderId,
        orderKind: "MEMBER_PACKAGE",
        warehouseId,
        details: { paymentMethod: sourcePaymentMethod },
      });
      if (warehouseId) {
        void openCashDrawerAfterPayment(orderId, warehouseId, sourcePaymentMethod);
      }
      await completeSuccessfulSale(orderId, result.remoteOrderNumber);
    } catch (error: unknown) {
      const serviceError = toMemberServiceError(error);
      logCheckoutTelemetry("openapi_finalize_failed", {
        localOrderId: orderId,
        orderKind: "MEMBER_PACKAGE",
        warehouseId,
        details: {
          code: serviceError.code,
          paymentMethod: sourcePaymentMethod,
        },
      });
      console.error("[Thành viên] Hoàn tất gói thất bại:", serviceError);
      failMutation(serviceError.message, serviceError.code);
    }
  }, [completeSuccessfulSale, failMutation, markWaitingApi, warehouseId]);

  const orderItems = useMemo(() => selectedPackage ? [{
    goodsId: selectedPackage.goodsId,
    goodsName: selectedPackage.name,
    price: selectedPackage.paymentAmountVnd,
    quantity: 1,
  }] : [], [selectedPackage]);

  const payOSPayment = usePayOSCheckoutController({
    shopId,
    warehouseId,
    draftOrderId: localOrderId,
    items: orderItems,
    manageCartLock: false,
    requireRemoteCompletion: true,
    orderKind: "MEMBER_PACKAGE",
    onCompleted: (orderId) => finishRemoteSale(orderId),
    onCancelled: resetMutation,
  });
  const createPayOSPayment = payOSPayment.createPayment;

  const beginCheckout = useCallback(() => {
    setPaymentCollected(false);
    resetMutation();
    setLocalOrderId(generateLocalOrderId());
    setCheckoutOpen(true);
  }, [resetMutation]);

  const openCheckout = useCallback(() => {
    if (selectedPackage) beginCheckout();
  }, [beginCheckout, selectedPackage]);

  const openCheckoutForProduct = useCallback((goodsId: string): boolean => {
    if (!cachedPackages.some((item) => item.goodsId === goodsId)) return false;
    setPackages(cachedPackages);
    selectPackage(goodsId);
    setPaymentMethod("CASH");
    beginCheckout();
    return true;
  }, [beginCheckout, cachedPackages, selectPackage, setPackages]);

  const closeCheckout = useCallback(() => {
    if (payOSPayment.hasActiveTransfer || payOSPayment.isBusy) return;
    setCheckoutOpen(false);
  }, [payOSPayment.hasActiveTransfer, payOSPayment.isBusy]);

  const sellForCash = useCallback(async () => {
    if (!member || !selectedPackage || !warehouseId || !localOrderId) return;
    setPaymentCollected(true);
    startMutation("PACKAGE_TOP_UP", "WAITING_API");
    logCheckoutTelemetry("payment_detected", {
      localOrderId,
      orderKind: "MEMBER_PACKAGE",
      warehouseId,
      details: { paymentMethod: "CASH" },
    });
    logCheckoutTelemetry("openapi_finalize_started", {
      localOrderId,
      orderKind: "MEMBER_PACKAGE",
      warehouseId,
      details: { paymentMethod: "CASH" },
    });
    try {
      const result = await showPromise(sellMemberPackageForCash({
        shopId,
        warehouseId,
        uid: member.uid,
        localOrderId,
        goodsId: selectedPackage.goodsId,
        quotedPrice: selectedPackage.paymentAmountVnd,
        member: {
          uid: member.uid,
          memberCode: member.memberCode,
          fullName: member.fullName,
          phone: member.phone,
          levelName: member.levelName,
        },
      }), {
        loading: "Đang chờ OpenAPI tạo và thanh toán đơn...",
        success: "Bán gói thành công",
        error: "Không thể hoàn tất bán gói",
        successDescription: "OpenAPI đã xác nhận đơn và cộng điểm cho thành viên.",
        errorDescription: (error) => toMemberServiceError(error).message,
      });
      logCheckoutTelemetry("openapi_finalize_completed", {
        localOrderId,
        orderKind: "MEMBER_PACKAGE",
        warehouseId,
        details: { paymentMethod: "CASH" },
      });
      setCheckoutOpen(false);
      void openCashDrawerAfterPayment(localOrderId, warehouseId, "CASH");
      await completeSuccessfulSale(localOrderId, result.remoteOrderNumber);
    } catch (error: unknown) {
      const serviceError = toMemberServiceError(error);
      if (serviceError.code === "MEMBER_PACKAGE_QUOTE_CHANGED") {
        setPaymentCollected(false);
        setLocalOrderId(null);
        await reloadProducts();
      }
      logCheckoutTelemetry("openapi_finalize_failed", {
        localOrderId,
        orderKind: "MEMBER_PACKAGE",
        warehouseId,
        details: { code: serviceError.code },
      });
      console.error("[Thành viên] Bán gói tiền mặt thất bại:", serviceError);
      failMutation(serviceError.message, serviceError.code);
      setCheckoutOpen(false);
    }
  }, [
    completeSuccessfulSale,
    failMutation,
    localOrderId,
    member,
    reloadProducts,
    selectedPackage,
    shopId,
    startMutation,
    warehouseId,
  ]);

  const startQrPayment = useCallback(async () => {
    if (!member || !selectedPackage || !warehouseId || !localOrderId) return;
    startMutation("PACKAGE_TOP_UP", "WAITING_PAYMENT");
    logCheckoutTelemetry("openapi_prepare_started", {
      localOrderId,
      orderKind: "MEMBER_PACKAGE",
      warehouseId,
    });
    try {
      await showPromise(prepareMemberPackageOrder({
        shopId,
        warehouseId,
        uid: member.uid,
        localOrderId,
        goodsId: selectedPackage.goodsId,
        quotedPrice: selectedPackage.paymentAmountVnd,
        member: {
          uid: member.uid,
          memberCode: member.memberCode,
          fullName: member.fullName,
          phone: member.phone,
          levelName: member.levelName,
        },
      }), {
        loading: "Đang xác minh gói và chốt giá thanh toán...",
        success: "Đơn gói đã sẵn sàng",
        error: "Không thể chuẩn bị đơn gói",
        successDescription: "Đã chốt số tiền để tạo mã chuyển khoản.",
        errorDescription: (error) => toMemberServiceError(error).message,
      });
      logCheckoutTelemetry("openapi_prepare_completed", {
        localOrderId,
        orderKind: "MEMBER_PACKAGE",
        warehouseId,
      });
      await createPayOSPayment();
    } catch (error: unknown) {
      const serviceError = toMemberServiceError(error);
      if (serviceError.code === "MEMBER_PACKAGE_QUOTE_CHANGED") {
        setLocalOrderId(null);
        setCheckoutOpen(false);
        await reloadProducts();
      }
      logCheckoutTelemetry("openapi_prepare_failed", {
        localOrderId,
        orderKind: "MEMBER_PACKAGE",
        warehouseId,
        details: { code: serviceError.code },
      });
      console.error("[Thành viên] Chuẩn bị QR thất bại:", serviceError);
      failMutation(serviceError.message, serviceError.code);
    }
  }, [
    failMutation,
    localOrderId,
    member,
    createPayOSPayment,
    reloadProducts,
    selectedPackage,
    shopId,
    startMutation,
    warehouseId,
  ]);

  const retryRemoteSale = useCallback(() => {
    if (localOrderId && paymentCollected) {
      void finishRemoteSale(localOrderId, paymentMethod);
    }
  }, [finishRemoteSale, localOrderId, paymentCollected, paymentMethod]);

  return {
    packages,
    packagesRequest,
    selectedPackage,
    mutation,
    paymentMethod,
    isCheckoutOpen,
    payOSPayment,
    selectPackage,
    setPaymentMethod,
    loadPackages,
    openCheckout,
    openCheckoutForProduct,
    closeCheckout,
    sellForCash,
    startQrPayment,
    retryRemoteSale,
    canRetryRemote: Boolean(localOrderId && paymentCollected),
  };
}
