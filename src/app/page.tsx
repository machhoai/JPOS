"use client";

import { openCashDrawerAfterPayment } from "@/features/printer/services/cashDrawerService";

// =============================================================================
// Main POS Dashboard — Cashier interface
// =============================================================================
// Layout: Sidebar (left) | Product workspace (center) | Cart (right)
// Auth-guarded: redirects to /login if not authenticated.
// =============================================================================

import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/lib/contexts/AuthContext";
import {
  useCartStore,
  selectTotalAmount,
  selectItemCount,
  selectVoucherDiscount,
  selectPayableAmount,
} from "@/lib/stores/useCartStore";
import { selectVisibleProducts, useProductStore } from "@/lib/stores/useProductStore";
import { JPOS_PAYMENT_METHODS } from "@/lib/data/paymentMethods";
import { syncProducts } from "@/lib/services/productService";
import { fetchOrderForReceipt, resolveVoucher } from "@/lib/services/orderService";
import {
  cancelMemberCardRead,
  readMemberCard,
  toCardReaderServiceError,
} from "@/lib/services/cardReaderService";
import {
  lookupMember,
  toMemberServiceError,
} from "@/lib/services/memberService";
import { showError, showPromise, showSuccess, showWarning } from "@/lib/utils/toast";
import {
  describeReceiptPrintError,
  printReceiptSilently,
} from "@/features/receipt/components/ReceiptPrintButton";
import { useReceiptSettingsStore } from "@/features/receipt/store/useReceiptSettingsStore";
import type { ReceiptLanguage } from "@/features/receipt/types/receipt";
import { printTicketsSilently } from "@/features/ticket/components/TicketPrintButton";
import { useTicketSettingsStore } from "@/features/ticket/store/useTicketSettingsStore";
import { printLuckyDrawTicketsSilently } from "@/features/lucky-draw/components/LuckyDrawPrintButton";
import { useLuckyDrawSettingsSync } from "@/features/lucky-draw/hooks/useLuckyDrawSettingsSync";
import { useLuckyDrawSettingsStore } from "@/features/lucky-draw/store/useLuckyDrawSettingsStore";
import { filterProducts } from "@/lib/utils/productSearch";
import { findProductByBarcode } from "@/lib/utils/productBarcode";
import { useBarcodeScanner } from "@/lib/hooks/useBarcodeScanner";
import { usePayOSCheckoutController } from "@/lib/hooks/usePayOSCheckoutController";
import { useCustomerDisplayWindow } from "@/lib/hooks/useCustomerDisplayWindow";
import { useCustomerDisplayPublisher } from "@/lib/hooks/useCustomerDisplayPublisher";
import { recordPendingFailure } from "@/lib/services/checkoutJournalService";
import { logCheckoutTelemetry } from "@/lib/services/checkoutTelemetryService";
import TopNav from "@/components/pos/TopNav";
import Sidebar from "@/components/layout/Sidebar";
import ProductGrid from "@/components/pos/ProductGrid";
import CartPanel from "@/components/pos/CartPanel";
import StoreSelector from "@/components/pos/StoreSelector";
import CheckoutRecoveryNotice from "@/components/resilience/CheckoutRecoveryNotice";
import CheckoutSafetyBoundary from "@/components/resilience/CheckoutSafetyBoundary";
import MinimalCheckoutFallback from "@/components/resilience/MinimalCheckoutFallback";
import type { Product } from "@/lib/types/product";
import { useProductVisibilitySync } from "@/lib/hooks/useProductVisibilitySync";

export default function CashierPage() {
  useCustomerDisplayWindow();
  const router = useRouter();
  const {
    user,
    userDoc,
    availableWarehouses,
    effectiveWarehouseId,
    effectiveWarehouseName,
    isLoading: authLoading,
    logout,
    needsWarehouseSelection,
    selectWarehouse,
  } = useAuth();
  useLuckyDrawSettingsSync(effectiveWarehouseId);
  useProductVisibilitySync(effectiveWarehouseId);

  // ── Product Store ──────────────────────────────────────────────────────
  const allProducts = useProductStore(useShallow(selectVisibleProducts));
  const selectedCategory = useProductStore((s) => s.selectedCategory);
  const searchQuery = useProductStore((s) => s.searchQuery);

  const products = useMemo(
    () => filterProducts(allProducts, selectedCategory, searchQuery),
    [allProducts, selectedCategory, searchQuery],
  );

  // Derive filtered products — useMemo tránh tạo array mới mỗi render
  const isProductsLoading = useProductStore((s) => s.isLoading);
  const fetchProducts = useProductStore((s) => s.fetchProducts);
  const setSelectedCategory = useProductStore((s) => s.setSelectedCategory);
  const setSearchQuery = useProductStore((s) => s.setSearchQuery);

  // ── Cart Store ─────────────────────────────────────────────────────────
  const cartItems = useCartStore((s) => s.items);
  const cartMemberUid = useCartStore((s) => s.memberUid);
  const cartMember = useCartStore((s) => s.member);
  const paymentMethod = useCartStore((s) => s.paymentMethod);
  const isCheckingOut = useCartStore((s) => s.isCheckingOut);
  const isPaymentLocked = useCartStore((s) => s.isPaymentLocked);
  const currentOrderId = useCartStore((s) => s.currentOrderId);
  const draftOrderId = useCartStore((s) => s.draftOrderId);
  const currentHkOrderNumber = useCartStore((s) => s.currentHkOrderNumber);
  const currentOrderStatus = useCartStore((s) => s.currentOrderStatus);
  const totalAmount = useCartStore(selectTotalAmount);
  const voucherDiscount = useCartStore(selectVoucherDiscount);
  const payableAmount = useCartStore(selectPayableAmount);
  const itemCount = useCartStore(selectItemCount);
  const vouchers = useCartStore((s) => s.vouchers);
  const voucherCodes = useMemo(
    () => vouchers.map((voucher) => voucher.code),
    [vouchers],
  );
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const applyVoucher = useCartStore((s) => s.applyVoucher);
  const removeVoucher = useCartStore((s) => s.removeVoucher);
  const setCartMember = useCartStore((s) => s.setMember);
  const setPaymentMethod = useCartStore((s) => s.setPaymentMethod);
  const checkout = useCartStore((s) => s.checkout);
  const prepareCurrentOrder = useCartStore((s) => s.prepareCurrentOrder);
  const refreshCurrentOrderStatus = useCartStore((s) => s.refreshCurrentOrderStatus);
  const clearCart = useCartStore((s) => s.clearCart);
  const completePayOSCheckout = useCartStore((s) => s.completePayOSCheckout);
  const setCheckoutContext = useCartStore((s) => s.setCheckoutContext);
  const hydrateCheckoutJournal = useCartStore((s) => s.hydrateCheckoutJournal);
  const recoveryNotice = useCartStore((s) => s.recoveryNotice);
  const dismissRecoveryNotice = useCartStore((s) => s.dismissRecoveryNotice);
  const checkoutModalRequested = useCartStore((s) => s.checkoutModalRequested);
  const consumeCheckoutModalRequest = useCartStore((s) => s.consumeCheckoutModalRequest);
  const markReceiptPrinted = useCartStore((s) => s.markReceiptPrinted);
  const receiptSettings = useReceiptSettingsStore((state) => state.settings);
  const ticketSettings = useTicketSettingsStore((state) => state.settings);
  const luckyDrawSettings = useLuckyDrawSettingsStore((state) => state.settings);
  const paymentMethods = JPOS_PAYMENT_METHODS;
  const [isSyncingProducts, setIsSyncingProducts] = useState(false);
  const [receiptLanguage, setReceiptLanguage] = useState<ReceiptLanguage>("vi");
  const [memberReadStatus, setMemberReadStatus] = useState<"IDLE" | "READING" | "LOOKING_UP" | "FAILED">("IDLE");
  const [memberReadError, setMemberReadError] = useState<string | null>(null);
  const [isValidatingVoucher, setIsValidatingVoucher] = useState(false);
  const memberReadAttemptRef = useRef(0);
  const voucherRequestRef = useRef(false);
  const shopId = Number(process.env.NEXT_PUBLIC_SHOP_ID) || 1;

  const handleReadMemberCard = useCallback(async () => {
    if (!effectiveWarehouseId) {
      showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi đọc thẻ thành viên.");
      return;
    }

    const attemptId = memberReadAttemptRef.current + 1;
    memberReadAttemptRef.current = attemptId;
    setMemberReadStatus("READING");
    setMemberReadError(null);

    try {
      const card = await readMemberCard();
      if (memberReadAttemptRef.current !== attemptId) return;
      const cardNumber = card.memberCode ?? card.serialNumber;
      if (!cardNumber) {
        throw new Error("Đầu đọc không trả mã thành viên hoặc serial thẻ.");
      }
      const result = await lookupMember({
        shopId,
        warehouseId: effectiveWarehouseId,
        mode: "CARD",
        query: cardNumber,
        cardLookupKind: card.memberCode ? "MEMBER_CODE" : "SERIAL_NUMBER",
      });
      if (memberReadAttemptRef.current !== attemptId) return;
      setCartMember({
        uid: result.member.uid,
        memberCode: result.member.memberCode,
        fullName: result.member.fullName,
        phone: result.member.phone,
        levelName: result.member.levelName,
      });
      setMemberReadStatus("IDLE");
      showSuccess(
        "Đã gắn thành viên vào đơn",
        result.member.fullName || result.member.memberCode || result.member.phone,
      );
    } catch (error: unknown) {
      if (memberReadAttemptRef.current !== attemptId) return;
      const readerError = toCardReaderServiceError(error);
      if (readerError.code === "READ_CANCELLED") {
        setMemberReadStatus("IDLE");
        return;
      }
      const message = readerError.code === "UNKNOWN"
        ? toMemberServiceError(error).message
        : readerError.message;
      setMemberReadError(message);
      setMemberReadStatus("FAILED");
      showError("Không thể gắn thành viên", message);
    }
  }, [effectiveWarehouseId, setCartMember, shopId]);

  const handleCancelMemberCardRead = useCallback(() => {
    memberReadAttemptRef.current += 1;
    setMemberReadStatus("IDLE");
    setMemberReadError(null);
    void cancelMemberCardRead().catch((error: unknown) => {
      console.warn("[Đầu đọc thẻ] Không thể gửi lệnh hủy:", error);
    });
  }, []);

  const handleLookupMemberByPhone = useCallback(async (phone: string) => {
    if (!effectiveWarehouseId) {
      showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi tìm thành viên.");
      return;
    }

    const attemptId = memberReadAttemptRef.current + 1;
    memberReadAttemptRef.current = attemptId;
    setMemberReadStatus("LOOKING_UP");
    setMemberReadError(null);

    try {
      const result = await lookupMember({
        shopId,
        warehouseId: effectiveWarehouseId,
        mode: "PHONE",
        query: phone,
      });
      if (memberReadAttemptRef.current !== attemptId) return;
      setCartMember({
        uid: result.member.uid,
        memberCode: result.member.memberCode,
        fullName: result.member.fullName,
        phone: result.member.phone,
        levelName: result.member.levelName,
      });
      setMemberReadStatus("IDLE");
      showSuccess(
        "Đã gắn thành viên vào đơn",
        result.member.fullName || result.member.memberCode || result.member.phone,
      );
    } catch (error: unknown) {
      if (memberReadAttemptRef.current !== attemptId) return;
      const memberError = toMemberServiceError(error);
      setMemberReadError(memberError.message);
      setMemberReadStatus("FAILED");
      showError("Không thể gắn thành viên", memberError.message);
    }
  }, [effectiveWarehouseId, setCartMember, shopId]);

  const handleRemoveMember = useCallback(() => {
    setCartMember(null);
    setMemberReadStatus("IDLE");
    setMemberReadError(null);
  }, [setCartMember]);

  useEffect(() => () => {
    memberReadAttemptRef.current += 1;
    void cancelMemberCardRead();
  }, []);

  const handleAutoPrint = useCallback(async (localOrderId: string) => {
    console.info("[Biên lai] Bắt đầu in tự động", { localOrderId });
    let order: Awaited<ReturnType<typeof fetchOrderForReceipt>>;
    try {
      order = await fetchOrderForReceipt(localOrderId);
      logCheckoutTelemetry("order_loaded", {
        localOrderId,
        orderKind: order.orderKind,
        warehouseId: order.warehouseId,
        details: { status: order.status },
      });
    } catch (error: unknown) {
      console.error("[Biên lai] Không thể tải đơn để in tự động:", error);
      showError(
        "Thanh toán thành công nhưng chưa tải được biên lai",
        "Dịch vụ đơn hàng chưa sẵn sàng. Vui lòng in lại từ lịch sử đơn hàng.",
      );
      return;
    }

    try {
      await printReceiptSilently(order, receiptSettings, undefined, receiptLanguage);
      if (ticketSettings.autoPrintAfterPayment) {
        await printTicketsSilently(order, ticketSettings);
      }
      await printLuckyDrawTicketsSilently(order, luckyDrawSettings);
      markReceiptPrinted(localOrderId);
    } catch (error: unknown) {
      console.error("[In chứng từ] In tự động thất bại:", error);
      void recordPendingFailure("PRINT_ERROR", error, { localOrderId });
      showError(
        "Thanh toán thành công nhưng chưa in đủ chứng từ",
        describeReceiptPrintError(
          error,
          "Không thể gửi biên lai hoặc vé tới máy in mặc định của Windows.",
        ),
      );
    }
  }, [luckyDrawSettings, markReceiptPrinted, receiptLanguage, receiptSettings, ticketSettings]);

  const handlePayOSCompleted = useCallback((localOrderId: string, status: Parameters<typeof completePayOSCheckout>[1]) => {
    completePayOSCheckout(localOrderId, status);
    void handleAutoPrint(localOrderId);
  }, [completePayOSCheckout, handleAutoPrint]);

  const payOSPayment = usePayOSCheckoutController({
    shopId,
    warehouseId: effectiveWarehouseId,
    memberUid: cartMemberUid,
    member: cartMember,
    draftOrderId,
    items: cartItems,
    voucherCodes,
    orderKind: "STANDARD",
    onCompleted: handlePayOSCompleted,
  });
  useCustomerDisplayPublisher(payOSPayment);

  useEffect(() => {
    if (!effectiveWarehouseId) return;
    setCheckoutContext(shopId, effectiveWarehouseId);
    void hydrateCheckoutJournal();
  }, [effectiveWarehouseId, hydrateCheckoutJournal, setCheckoutContext, shopId]);

  // ── Auth Guard ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!user || !userDoc)) {
      router.replace("/login");
    }
  }, [authLoading, user, userDoc, router]);

  // ── Load Products on Mount ─────────────────────────────────────────────
  useEffect(() => {
    if (user && userDoc) {
      void fetchProducts();
    }
  }, [user, userDoc, fetchProducts]);

  useEffect(() => {
    if (
      paymentMethods.length > 0 &&
      !paymentMethods.some((method) => method.id === paymentMethod)
    ) {
      const preferredMethod =
        paymentMethods.find((method) => method.id === "CASH") ||
        paymentMethods[0];
      setPaymentMethod(preferredMethod.id);
    }
  }, [paymentMethod, paymentMethods, setPaymentMethod]);

  // ── Product Sync ───────────────────────────────────────────────────────
  const handleSyncProducts = useCallback(async () => {
    setIsSyncingProducts(true);
    try {
      await syncProducts();
      await fetchProducts();
    } catch (error) {
      console.error("[POS] Lỗi đồng bộ sản phẩm:", error);
    } finally {
      setIsSyncingProducts(false);
    }
  }, [fetchProducts]);

  // ── Add to Cart ────────────────────────────────────────────────────────
  const handleAddToCart = useCallback(
    (product: Product): boolean => {
      if (isPaymentLocked) {
        showWarning(
          "Giỏ hàng đang được khóa",
          "Hãy hoàn tất hoặc hủy phiên chuyển khoản trước khi sửa đơn.",
        );
        return false;
      }
      // Dùng afterTaxPrice (giá sau thuế) cho giỏ hàng
      const displayPrice = product.afterTaxPrice > 0
        ? product.afterTaxPrice
        : product.price;
      addItem({
        goodsId: product.goodsId,
        goodsName: product.goodsName,
        price: displayPrice,
        quantity: 1,
        ticketsPerUnit: product.ticketsPerUnit,
      });
      if (cartItems.length === 0 && effectiveWarehouseId) {
        void prepareCurrentOrder(shopId, effectiveWarehouseId);
      }
      return true;
    },
    [
      addItem,
      cartItems.length,
      effectiveWarehouseId,
      isPaymentLocked,
      prepareCurrentOrder,
      shopId,
    ]
  );

  const handleApplyVoucher = useCallback(async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code || voucherRequestRef.current) return;
    if (!effectiveWarehouseId) {
      showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi quét voucher.");
      return;
    }
    if (isPaymentLocked) {
      showWarning("Giỏ hàng đang được khóa", "Hãy hoàn tất hoặc hủy phiên thanh toán hiện tại.");
      return;
    }

    voucherRequestRef.current = true;
    setIsValidatingVoucher(true);
    try {
      const voucher = await resolveVoucher(code, effectiveWarehouseId);
      applyVoucher(voucher);
      showSuccess(
        "Đã áp dụng voucher",
        voucher.rewardType === "DISCOUNT_PERCENT"
          ? `${voucher.campaignName}: giảm ${voucher.rewardValue}% toàn đơn.`
          : `${voucher.product.goodsName} đã được tự động thêm vào giỏ hàng.`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : "Voucher không hợp lệ hoặc không thể sử dụng tại điểm bán này.";
      console.error("[Voucher] Không thể áp dụng voucher:", error);
      showError("Không thể áp dụng voucher", message);
    } finally {
      voucherRequestRef.current = false;
      setIsValidatingVoucher(false);
    }
  }, [applyVoucher, effectiveWarehouseId, isPaymentLocked]);

  const handleBarcodeScan = useCallback((barcode: string) => {
    const product = findProductByBarcode(allProducts, barcode);
    if (!product) {
      void handleApplyVoucher(barcode);
      return;
    }

    if (handleAddToCart(product)) {
      showSuccess("Đã quét sản phẩm", `${product.goodsName} đã được thêm vào giỏ hàng.`);
    }
  }, [allProducts, handleAddToCart, handleApplyVoucher]);

  useBarcodeScanner({
    enabled: !authLoading && Boolean(user && userDoc) && !needsWarehouseSelection,
    onScan: handleBarcodeScan,
  });

  useEffect(() => {
    if (
      !currentOrderId ||
      !["LOCAL_PAID", "SYNCING"].includes(currentOrderStatus || "")
    ) {
      return;
    }

    void refreshCurrentOrderStatus();
    const intervalId = window.setInterval(() => {
      void refreshCurrentOrderStatus();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [currentOrderId, currentOrderStatus, refreshCurrentOrderStatus]);

  // ── Checkout ───────────────────────────────────────────────────────────
  const handleCheckout = useCallback(async () => {
    if (!effectiveWarehouseId) {
      const error = new Error("Chưa xác định được điểm bán.");
      showError(
        "Không thể thanh toán",
        "Vui lòng chọn điểm bán trước khi thanh toán.",
      );
      throw error;
    }

    const runCheckout = async () => {
      const paidWith = useCartStore.getState().paymentMethod;
      const result = await checkout(shopId, effectiveWarehouseId);
      void openCashDrawerAfterPayment(result.localOrderId, effectiveWarehouseId, paidWith);
      logCheckoutTelemetry("payment_detected", {
        localOrderId: result.localOrderId,
        orderKind: "STANDARD",
        warehouseId: effectiveWarehouseId,
        details: { paymentMethod: "CASH" },
      });
      await handleAutoPrint(result.localOrderId);
      return result;
    };
    const notifyCheckout = (): ReturnType<typeof runCheckout> => {
      return showPromise(runCheckout(), {
        loading: "Đang ghi nhận thanh toán...",
        success: "Thanh toán thành công",
        error: "Không thể thanh toán",
        successDescription:
          "Đơn đã được lưu trên Firebase. Hệ thống đang đồng bộ nền.",
        errorDescription:
          "Đơn chưa được ghi nhận. Vui lòng kiểm tra kết nối và thử lại.",
        onRetry: () => {
          void notifyCheckout();
        },
      });
    };

    try {
      await notifyCheckout();
    } catch (error: unknown) {
      console.error("[POS] Lỗi thanh toán:", error);
      throw error;
    }
  }, [effectiveWarehouseId, checkout, handleAutoPrint, shopId]);

  // ── Loading / Auth Guard State ─────────────────────────────────────────
  if (authLoading || !user || !userDoc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)]">Đang tải...</p>
        </div>
      </div>
    );
  }

  // ── Admin Store Selector ────────────────────────────────────────────────
  if (needsWarehouseSelection) {
    return (
      <StoreSelector
        userName={userDoc.full_name}
        warehouses={availableWarehouses}
        onSelectWarehouse={selectWarehouse}
        onLogout={logout}
      />
    );
  }

  return (
    <CheckoutSafetyBoundary
      fallback={(retry) => (
        <div className="h-screen bg-[var(--color-background)]">
          <MinimalCheckoutFallback
            totalAmount={payableAmount}
            itemCount={itemCount}
            isBusy={isCheckingOut || payOSPayment.isBusy}
            onRetryInterface={retry}
            onCashPayment={() => {
              setPaymentMethod("CASH");
              void handleCheckout();
            }}
            onTransferPayment={() => {
              setPaymentMethod("QR_CODE");
              void payOSPayment.createPayment();
            }}
            onOpenOrders={() => router.push("/orders")}
            payment={payOSPayment}
          />
        </div>
      )}
    >
      <div className="h-screen flex overflow-hidden bg-[var(--color-background)]">
      {recoveryNotice ? (
        <CheckoutRecoveryNotice
          checkpoint={recoveryNotice}
          onDismiss={dismissRecoveryNotice}
          onOpenOrders={() => router.push("/orders")}
        />
      ) : null}
      <Sidebar onLogout={logout} />

      {/* Center: welcome, search, categories and products */}
      <main className="flex-1 flex flex-col min-w-0">
        <TopNav
          storeName={effectiveWarehouseName || "Điểm làm việc"}
          cashierName={userDoc.full_name}
          searchQuery={searchQuery}
          selectedCategory={selectedCategory}
          onSearchChange={setSearchQuery}
          onSelectCategory={setSelectedCategory}
          onSyncProducts={handleSyncProducts}
          isSyncing={isSyncingProducts}
        />

        <div className="flex-1 min-h-0">
          <ProductGrid
            key={selectedCategory ?? "all"}
            products={products}
            isLoading={isProductsLoading}
            onAddToCart={handleAddToCart}
          />
        </div>
      </main>

      {/* Right: fixed order panel */}
      <div className="w-[350px] xl:w-[380px] shrink-0">
        <CheckoutSafetyBoundary
          fallback={(retry) => (
            <MinimalCheckoutFallback
              totalAmount={payableAmount}
              itemCount={itemCount}
              isBusy={isCheckingOut || payOSPayment.isBusy}
              onRetryInterface={retry}
              onCashPayment={() => {
                setPaymentMethod("CASH");
                void handleCheckout();
              }}
              onTransferPayment={() => {
                setPaymentMethod("QR_CODE");
                void payOSPayment.createPayment();
              }}
              onOpenOrders={() => router.push("/orders")}
              payment={payOSPayment}
            />
          )}
        >
          <CartPanel
            items={cartItems}
            member={cartMember}
            memberReadStatus={memberReadStatus}
            memberReadError={memberReadError}
            paymentMethod={paymentMethod}
            paymentMethods={paymentMethods}
            receiptLanguage={receiptLanguage}
            payOSPayment={payOSPayment}
            isCheckingOut={isCheckingOut}
            isPaymentLocked={isPaymentLocked}
            currentOrderId={currentOrderId}
            currentHkOrderNumber={currentHkOrderNumber}
            currentOrderStatus={currentOrderStatus}
            totalAmount={totalAmount}
            itemCount={itemCount}
            vouchers={vouchers}
            discountAmount={voucherDiscount}
            isValidatingVoucher={isValidatingVoucher}
            onUpdateQuantity={updateQuantity}
            onRemoveItem={removeItem}
            onApplyVoucher={(code) => void handleApplyVoucher(code)}
            onRemoveVoucher={removeVoucher}
            onReadMemberCard={() => void handleReadMemberCard()}
            onCancelMemberCardRead={handleCancelMemberCardRead}
            onLookupMemberByPhone={handleLookupMemberByPhone}
            onRemoveMember={handleRemoveMember}
            onSetPaymentMethod={setPaymentMethod}
            onSetReceiptLanguage={setReceiptLanguage}
            onCheckout={handleCheckout}
            onClearCart={clearCart}
            openCheckoutRequested={checkoutModalRequested}
            onCheckoutOpened={consumeCheckoutModalRequest}
          />
        </CheckoutSafetyBoundary>
      </div>
      </div>
    </CheckoutSafetyBoundary>
  );

}
