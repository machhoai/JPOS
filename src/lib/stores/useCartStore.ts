// =============================================================================
// Zustand Cart Store — Local-first state management for the cashier
// =============================================================================
// This store manages the cashier's cart entirely in memory for zero-latency
// interaction. When the cashier completes checkout, the cart is persisted to
// Firestore and the local state is cleared.
// =============================================================================

import { create } from "zustand";
import type {
  OrderItem,
  OrderMemberSnapshot,
  OrderStatus,
  PaymentMethod,
} from "@/lib/types/order";
import {
  checkoutOrder,
  fetchOrderSyncStatus,
  generateLocalOrderId,
  prepareOrder,
  type CheckoutOrderResult,
} from "@/lib/services/orderService";
import {
  clearCheckoutJournal,
  loadCheckoutJournal,
  recordPendingFailure,
  saveCheckoutJournal,
} from "@/lib/services/checkoutJournalService";
import type {
  CheckoutCheckpoint,
  CheckoutJournalRecord,
} from "@/lib/types/checkoutRecovery";
import type { PosVoucherResolution } from "@/lib/types/voucher";
import { getVietnamDateInputValue } from "@/lib/utils/orderHistoryDate";

interface CheckoutContext {
  shopId: number;
  warehouseId: string;
}

/** The shape of the cart store. */
export interface CartState {
  // ── State ──────────────────────────────────────────────────────────────────
  items: OrderItem[];
  vouchers: PosVoucherResolution[];
  memberUid: string | null;
  member: OrderMemberSnapshot | null;
  paymentMethod: PaymentMethod;
  draftOrderId: string | null;
  currentOrderId: string | null;
  currentHkOrderNumber: string | null;
  currentOrderStatus: OrderStatus | null;
  isCheckingOut: boolean;
  isPaymentLocked: boolean;
  paymentLockOrderId: string | null;
  checkoutContext: CheckoutContext | null;
  checkoutCheckpoint: CheckoutCheckpoint | null;
  journalHydrated: boolean;
  recoveryNotice: CheckoutCheckpoint | null;
  checkoutModalRequested: boolean;

  // ── Computed (derived in selectors, not stored) ────────────────────────────
  // Use `useCartStore(selectTotalAmount)` to get the total.

  // ── Actions ────────────────────────────────────────────────────────────────
  addItem: (item: OrderItem) => void;
  applyVoucher: (voucher: PosVoucherResolution) => void;
  removeVoucher: (code: string) => void;
  setMemberUid: (uid: string | null) => void;
  setMember: (member: OrderMemberSnapshot | null) => void;
  removeItem: (goodsId: string) => void;
  removeUnavailableItems: (goodsIds: string[]) => void;
  updateQuantity: (goodsId: string, quantity: number) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  clearCart: () => void;
  prepareCurrentOrder: (shopId: number, warehouseId: string) => Promise<void>;
  refreshCurrentOrderStatus: () => Promise<void>;
  completePayOSCheckout: (
    localOrderId: string,
    status: OrderStatus,
  ) => void;
  lockCartForPayOS: (localOrderId: string) => boolean;
  unlockCartAfterPayOSCancellation: (localOrderId: string, reuseDraft?: boolean) => void;
  setCheckoutContext: (shopId: number, warehouseId: string) => void;
  hydrateCheckoutJournal: () => Promise<void>;
  dismissRecoveryNotice: () => void;
  requestCheckoutModal: () => void;
  consumeCheckoutModalRequest: () => void;
  markReceiptPrinted: (localOrderId: string) => void;

  /**
   * Complete the checkout flow:
   * 1. Create a DRAFT order in Firestore
   * 2. Immediately update it to LOCAL_PAID
   * 3. Clear the local cart
   *
   * @param shopId - The shop this order belongs to.
   * @returns The localOrderId of the completed order.
   */
  checkout: (
    shopId: number,
    warehouseId: string,
  ) => Promise<CheckoutOrderResult>;
}

/** Selector: compute total amount from items. */
export const selectTotalAmount = (state: CartState): number =>
  state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

/** Selector: compute total item count. */
export const selectItemCount = (state: CartState): number =>
  state.items.reduce((sum, item) => sum + item.quantity, 0);

export const selectVoucherDiscount = (state: CartState): number => {
  const subtotal = selectTotalAmount(state);
  const freeDiscount = state.vouchers
    .filter((voucher) => voucher.rewardType !== "DISCOUNT_PERCENT")
    .reduce(
      (total, voucher) => total + voucher.product.price * voucher.product.quantity,
      0,
    );
  const percent = state.vouchers.find(
    (voucher) => voucher.rewardType === "DISCOUNT_PERCENT",
  );
  const percentDiscount = percent
    ? Math.round((subtotal - freeDiscount) * percent.rewardValue / 100)
    : 0;
  return Math.min(subtotal, freeDiscount + percentDiscount);
};

export const selectPayableAmount = (state: CartState): number =>
  selectTotalAmount(state) - selectVoucherDiscount(state);

function saveCartCheckpoint(
  state: CartState,
  checkpoint: CheckoutCheckpoint,
  overrides: Partial<CheckoutJournalRecord> = {},
): void {
  const context = state.checkoutContext;
  if (!context) return;
  const now = new Date().toISOString();
  const items = overrides.items ?? state.items;
  void saveCheckoutJournal({
    id: "active-checkout",
    schemaVersion: 1,
    checkpoint,
    localOrderId:
      overrides.localOrderId ?? state.currentOrderId ?? state.draftOrderId,
    shopId: context.shopId,
    warehouseId: context.warehouseId,
    memberUid: overrides.memberUid ?? state.memberUid,
    member: overrides.member ?? state.member,
    items,
    vouchers: overrides.vouchers ?? state.vouchers,
    paymentMethod: overrides.paymentMethod ?? state.paymentMethod,
    totalAmount:
      overrides.totalAmount ??
      selectPayableAmount({ ...state, items }),
    orderStatus: overrides.orderStatus ?? state.currentOrderStatus,
    startedAt: overrides.startedAt ?? now,
    updatedAt: now,
    lastError: overrides.lastError ?? null,
    recoveryCount: overrides.recoveryCount ?? 0,
  });
}

/**
 * The main cart store.
 * Operates entirely in local memory — Firestore writes only happen on checkout.
 */
export const useCartStore = create<CartState>((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────────
  items: [],
  vouchers: [],
  memberUid: null,
  member: null,
  paymentMethod: "CASH",
  draftOrderId: null,
  currentOrderId: null,
  currentHkOrderNumber: null,
  currentOrderStatus: null,
  isCheckingOut: false,
  isPaymentLocked: false,
  paymentLockOrderId: null,
  checkoutContext: null,
  checkoutCheckpoint: null,
  journalHydrated: false,
  recoveryNotice: null,
  checkoutModalRequested: false,

  // ── Actions ────────────────────────────────────────────────────────────────

  addItem: (item) => {
    set((state) => {
      if (state.isPaymentLocked) return {};
      const existing = state.items.find((i) => i.goodsId === item.goodsId);
      if (existing) {
        // Increment quantity if item already in cart
        return {
          items: state.items.map((i) =>
            i.goodsId === item.goodsId
              ? { ...i, quantity: i.quantity + item.quantity }
              : i
          ),
        };
      }
      // Add new item to cart
      return {
        items: [...state.items, item],
        ...(state.items.length === 0
          ? {
              draftOrderId: null,
              currentOrderId: null,
              currentHkOrderNumber: null,
              currentOrderStatus: null,
            }
          : {}),
      };
    });
    saveCartCheckpoint(get(), "CART_READY");
  },

  applyVoucher: (voucher) => {
    const state = get();
    if (state.isPaymentLocked) {
      throw new Error("Giỏ hàng đang bị khóa trong phiên thanh toán.");
    }
    if (state.vouchers.some((item) => item.code === voucher.code)) {
      throw new Error("Voucher đã có trong đơn hàng.");
    }
    if (
      voucher.rewardType === "DISCOUNT_PERCENT" &&
      state.vouchers.some((item) => item.rewardType === "DISCOUNT_PERCENT")
    ) {
      throw new Error("Mỗi đơn chỉ được dùng một voucher giảm phần trăm.");
    }
    set((current) => {
      const existing = current.items.find(
        (item) => item.goodsId === voucher.product.goodsId,
      );
      const mappedItem: OrderItem = {
        goodsId: voucher.product.goodsId,
        goodsName: voucher.product.goodsName,
        price: voucher.product.price,
        quantity: voucher.product.quantity,
        ticketsPerUnit: voucher.product.ticketsPerUnit,
      };
      return {
        items: existing
          ? current.items.map((item) =>
              item.goodsId === mappedItem.goodsId
                ? { ...item, quantity: item.quantity + mappedItem.quantity }
                : item,
            )
          : [...current.items, mappedItem],
        vouchers: [...current.vouchers, voucher],
        draftOrderId: null,
        currentOrderId: null,
        currentHkOrderNumber: null,
        currentOrderStatus: null,
      };
    });
    saveCartCheckpoint(get(), "CART_READY");
  },

  removeVoucher: (code) => {
    if (get().isPaymentLocked) return;
    const voucher = get().vouchers.find((item) => item.code === code);
    if (!voucher) return;
    set((state) => ({
      vouchers: state.vouchers.filter((item) => item.code !== code),
      items: state.items.flatMap((item) => {
        if (item.goodsId !== voucher.product.goodsId) return [item];
        const quantity = item.quantity - voucher.product.quantity;
        return quantity > 0 ? [{ ...item, quantity }] : [];
      }),
      draftOrderId: null,
      currentOrderId: null,
      currentHkOrderNumber: null,
      currentOrderStatus: null,
    }));
    const current = get();
    if (current.items.length === 0) void clearCheckoutJournal();
    else saveCartCheckpoint(current, "CART_READY");
  },

  setMemberUid: (memberUid) => {
    if (get().isPaymentLocked) return;
    set((state) => ({
      memberUid,
      member: state.member?.uid === memberUid ? state.member : null,
      ...(state.memberUid !== memberUid && state.items.length > 0
        ? {
            draftOrderId: null,
            currentOrderId: null,
            currentHkOrderNumber: null,
            currentOrderStatus: null,
          }
        : {}),
    }));
    if (get().items.length > 0) saveCartCheckpoint(get(), "CART_READY");
  },

  setMember: (member) => {
    if (get().isPaymentLocked) return;
    set((state) => ({
      member,
      memberUid: member?.uid ?? null,
      ...(state.memberUid !== (member?.uid ?? null) && state.items.length > 0
        ? {
            draftOrderId: null,
            currentOrderId: null,
            currentHkOrderNumber: null,
            currentOrderStatus: null,
          }
        : {}),
    }));
    if (get().items.length > 0) saveCartCheckpoint(get(), "CART_READY");
  },

  removeItem: (goodsId) => {
    set((state) => {
      if (state.isPaymentLocked) return {};
      const required = state.vouchers
        .filter((voucher) => voucher.product.goodsId === goodsId)
        .reduce((total, voucher) => total + voucher.product.quantity, 0);
      return {
        items: state.items.flatMap((item) =>
          item.goodsId !== goodsId
            ? [item]
            : required > 0
              ? [{ ...item, quantity: required }]
              : [],
        ),
      };
    });
    const current = get();
    if (current.items.length === 0) void clearCheckoutJournal();
    else saveCartCheckpoint(current, "CART_READY");
  },

  removeUnavailableItems: (goodsIds) => {
    const blocked = new Set(goodsIds);
    set((state) => state.isPaymentLocked
      ? {}
      : {
          items: state.items.filter((item) => !blocked.has(item.goodsId)),
          vouchers: state.vouchers.filter(
            (voucher) => !blocked.has(voucher.product.goodsId),
          ),
          draftOrderId: null,
          currentOrderId: null,
          currentHkOrderNumber: null,
          currentOrderStatus: null,
          checkoutCheckpoint: null,
        });
    const current = get();
    if (current.isPaymentLocked) return;
    if (current.items.length === 0) void clearCheckoutJournal();
    else saveCartCheckpoint(current, "CART_READY");
  },

  updateQuantity: (goodsId, quantity) => {
    set((state) => {
      if (state.isPaymentLocked) return {};
      const required = state.vouchers
        .filter((voucher) => voucher.product.goodsId === goodsId)
        .reduce((total, voucher) => total + voucher.product.quantity, 0);
      if (quantity <= 0 && required === 0) {
        return { items: state.items.filter((i) => i.goodsId !== goodsId) };
      }
      return {
        items: state.items.map((i) =>
          i.goodsId === goodsId ? { ...i, quantity: Math.max(quantity, required) } : i
        ),
      };
    });
    const current = get();
    if (current.items.length === 0) void clearCheckoutJournal();
    else saveCartCheckpoint(current, "CART_READY");
  },

  setPaymentMethod: (method) => {
    if (get().isPaymentLocked) return;
    set({ paymentMethod: method });
    if (get().items.length > 0) saveCartCheckpoint(get(), "CART_READY");
  },

  clearCart: () => {
    if (get().isPaymentLocked) return;
    set({
      items: [],
      vouchers: [],
      memberUid: null,
      member: null,
      paymentMethod: "CASH",
      draftOrderId: null,
      currentOrderId: null,
      currentHkOrderNumber: null,
      currentOrderStatus: null,
      isCheckingOut: false,
      checkoutCheckpoint: null,
      recoveryNotice: null,
      checkoutModalRequested: false,
    });
    void clearCheckoutJournal();
  },

  setCheckoutContext: (shopId, warehouseId) => {
    set({ checkoutContext: { shopId, warehouseId } });
    const current = get();
    if (current.journalHydrated && current.items.length > 0) {
      saveCartCheckpoint(current, "CART_READY");
    }
  },

  hydrateCheckoutJournal: async () => {
    if (get().journalHydrated) return;
    const context = get().checkoutContext;
    if (!context) return;
    const journal = await loadCheckoutJournal();
    if (!journal || journal.checkpoint === "COMPLETED") {
      set({ journalHydrated: true });
      if (journal?.checkpoint === "COMPLETED") void clearCheckoutJournal();
      return;
    }
    if (journal.warehouseId !== context.warehouseId) {
      set({ journalHydrated: true });
      return;
    }

    // Journal checkpoints can be rewritten after the draft order was created.
    const orderTimestamp = /^ORD-(\d{10,13})-[A-Z0-9]{6}$/.exec(
      journal.localOrderId ?? "",
    )?.[1];
    const startedAt = orderTimestamp
      ? new Date(Number(orderTimestamp) * (orderTimestamp.length === 10 ? 1000 : 1))
      : new Date(journal.startedAt);
    if (
      !Number.isFinite(startedAt.getTime()) ||
      getVietnamDateInputValue(startedAt) !== getVietnamDateInputValue()
    ) {
      set({ journalHydrated: true });
      return;
    }

    const recoveryCount = journal.recoveryCount + 1;
    const paymentPending = journal.checkpoint === "PAYMENT_INITIATED";
    const paymentFinished = [
      "PAYMENT_CONFIRMED",
      "RECEIPT_PENDING",
      "SYNC_PENDING",
    ].includes(journal.checkpoint);
    set({
      items: paymentFinished ? [] : journal.items,
      vouchers: paymentFinished ? [] : journal.vouchers ?? [],
      memberUid: paymentFinished ? null : journal.memberUid ?? null,
      member: paymentFinished ? null : journal.member ?? null,
      paymentMethod: journal.paymentMethod,
      draftOrderId: paymentFinished ? null : journal.localOrderId,
      currentOrderId: journal.localOrderId,
      currentOrderStatus: journal.orderStatus,
      isPaymentLocked: paymentPending && journal.paymentMethod === "QR_CODE",
      paymentLockOrderId:
        paymentPending && journal.paymentMethod === "QR_CODE"
          ? journal.localOrderId
          : null,
      checkoutCheckpoint: journal.checkpoint,
      journalHydrated: true,
      recoveryNotice: journal.checkpoint,
    });
    void saveCheckoutJournal({
      ...journal,
      recoveryCount,
      updatedAt: new Date().toISOString(),
    });
  },

  dismissRecoveryNotice: () => set({ recoveryNotice: null }),

  requestCheckoutModal: () => {
    if (get().items.length === 0) return;
    set({ checkoutModalRequested: true });
  },

  consumeCheckoutModalRequest: () => set({ checkoutModalRequested: false }),

  markReceiptPrinted: (localOrderId) => {
    const state = get();
    if (state.currentOrderId !== localOrderId) return;
    set({ checkoutCheckpoint: "SYNC_PENDING" });
    saveCartCheckpoint(get(), "SYNC_PENDING", { localOrderId });
  },

  prepareCurrentOrder: async (shopId, warehouseId) => {
    const state = get();
    if (state.isPaymentLocked || state.items.length === 0 || state.draftOrderId) {
      return;
    }

    const localOrderId = generateLocalOrderId();
    set({ draftOrderId: localOrderId });
    saveCartCheckpoint(get(), "CART_READY", { localOrderId });

    try {
      const prepared = await prepareOrder({
        localOrderId,
        shopId,
        warehouseId,
        items: state.items.map(({ goodsId, quantity }) => ({
          goodsId,
          quantity,
        })),
        voucherCodes: state.vouchers.map((voucher) => voucher.code),
        ...(state.memberUid ? { uid: state.memberUid } : {}),
        ...(state.member ? { member: state.member } : {}),
      });

      const current = get();
      if (
        current.draftOrderId === localOrderId &&
        current.items.length > 0
      ) {
        set({
          currentOrderId: prepared.localOrderId,
          currentOrderStatus: prepared.status,
        });
      }
    } catch (error: unknown) {
      console.error("[Giỏ hàng] Không thể tạo đơn nháp nền:", error);
    }
  },

  refreshCurrentOrderStatus: async () => {
    const localOrderId = get().currentOrderId;
    if (!localOrderId) return;

    try {
      const result = await fetchOrderSyncStatus(localOrderId);
      if (get().currentOrderId !== localOrderId) return;
      set({
        currentHkOrderNumber: result.hkOrderNumber,
        currentOrderStatus: result.status,
      });
      if (
        result.status === "SYNC_SUCCESS" &&
        get().checkoutCheckpoint === "SYNC_PENDING"
      ) {
        set({ checkoutCheckpoint: "COMPLETED" });
        void clearCheckoutJournal();
      }
    } catch (error: unknown) {
      console.error("[Giỏ hàng] Không thể tải trạng thái đồng bộ đơn:", error);
    }
  },

  completePayOSCheckout: (localOrderId, status) => {
    const previous = get();
    saveCartCheckpoint(previous, "RECEIPT_PENDING", {
      localOrderId,
      orderStatus: status,
      items: previous.items,
    });
    set({
      items: [],
      vouchers: [],
      memberUid: null,
      member: null,
      paymentMethod: "CASH",
      draftOrderId: null,
      currentOrderId: localOrderId,
      currentHkOrderNumber: null,
      currentOrderStatus: status,
      isCheckingOut: false,
      isPaymentLocked: false,
      paymentLockOrderId: null,
      checkoutCheckpoint: "RECEIPT_PENDING",
      checkoutModalRequested: false,
    });
  },

  lockCartForPayOS: (localOrderId) => {
    const state = get();
    if (
      state.items.length === 0 ||
      (state.isPaymentLocked && state.paymentLockOrderId !== localOrderId)
    ) {
      return false;
    }
    set({
      isPaymentLocked: true,
      paymentLockOrderId: localOrderId,
      draftOrderId: localOrderId,
      checkoutCheckpoint: "PAYMENT_INITIATED",
    });
    saveCartCheckpoint(get(), "PAYMENT_INITIATED", { localOrderId });
    return true;
  },

  unlockCartAfterPayOSCancellation: (localOrderId, reuseDraft = true) => {
    const state = get();
    if (state.paymentLockOrderId !== localOrderId) return;
    const draftOrderId = reuseDraft ? localOrderId : generateLocalOrderId();
    set({
      isPaymentLocked: false,
      paymentLockOrderId: null,
      draftOrderId,
      ...(!reuseDraft && state.currentOrderId === localOrderId ? {
        currentOrderId: null,
        currentHkOrderNumber: null,
        currentOrderStatus: null,
      } : {}),
      checkoutCheckpoint: "CART_READY",
    });
    saveCartCheckpoint(get(), "CART_READY", { localOrderId: draftOrderId });
  },

  checkout: async (shopId, warehouseId) => {
    const state = get();
    if (state.isPaymentLocked) {
      throw new Error("Phải hủy mã chuyển khoản trước khi sửa hoặc thanh toán lại đơn.");
    }
    if (state.items.length === 0) {
      throw new Error("Không thể thanh toán khi giỏ hàng trống.");
    }

    const localOrderId = state.draftOrderId || generateLocalOrderId();
    set({
      isCheckingOut: true,
      draftOrderId: localOrderId,
      checkoutCheckpoint: "PAYMENT_INITIATED",
    });
    saveCartCheckpoint(get(), "PAYMENT_INITIATED", {
      localOrderId,
      items: state.items,
    });

    try {
      const result = await checkoutOrder({
        localOrderId,
        shopId,
        warehouseId,
        paymentMethodId: state.paymentMethod,
        items: state.items.map(({ goodsId, quantity }) => ({
          goodsId,
          quantity,
        })),
        voucherCodes: state.vouchers.map((voucher) => voucher.code),
        ...(state.memberUid ? { uid: state.memberUid } : {}),
        ...(state.member ? { member: state.member } : {}),
      });

      saveCartCheckpoint(get(), "RECEIPT_PENDING", {
        localOrderId: result.localOrderId,
        items: state.items,
        paymentMethod: state.paymentMethod,
        totalAmount: state.items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        ),
        orderStatus: result.status,
      });

      set({
        items: [],
        vouchers: [],
        memberUid: null,
        member: null,
        paymentMethod: "CASH",
        draftOrderId: null,
        currentOrderId: result.localOrderId,
        currentHkOrderNumber: result.hkOrderNumber,
        currentOrderStatus: result.status,
        isCheckingOut: false,
        checkoutCheckpoint: "RECEIPT_PENDING",
        checkoutModalRequested: false,
      });

      return result;
    } catch (error: unknown) {
      console.error("[Giỏ hàng] Thanh toán Firebase thất bại:", error);
      set({
        isCheckingOut: false,
        checkoutCheckpoint: "PAYMENT_INITIATED",
      });
      saveCartCheckpoint(get(), "PAYMENT_INITIATED", {
        localOrderId,
        items: state.items,
        lastError: error instanceof Error ? error.message : "PAYMENT_ERROR",
      });
      void recordPendingFailure("PAYMENT_ERROR", error, { localOrderId });
      throw error;
    }
  },
}));
