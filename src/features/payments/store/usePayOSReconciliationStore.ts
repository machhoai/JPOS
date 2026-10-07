import { create } from "zustand";

interface PayOSReconciliationState {
  scopeKey: string | null;
  pendingCount: number;
  setPendingOrders: (scopeKey: string, orders: Array<{ localOrderId: string }>) => void;
  clearScope: (scopeKey: string) => void;
}

/** The global monitor owns fetching; sidebar reads the same scoped result. */
export const usePayOSReconciliationStore = create<PayOSReconciliationState>((set) => ({
  scopeKey: null,
  pendingCount: 0,
  setPendingOrders: (scopeKey, orders) => set({
    scopeKey,
    pendingCount: new Set(orders.map((order) => order.localOrderId)).size,
  }),
  clearScope: (scopeKey) => set((state) => state.scopeKey === scopeKey
    ? { scopeKey: null, pendingCount: 0 }
    : state),
}));
