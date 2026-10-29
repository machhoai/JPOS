import { create } from "zustand";
import {
  fetchOrderHistory,
  type OrderHistoryQuery,
} from "@/lib/services/orderService";
import type { PosOrder } from "@/lib/types/order";

interface OrderHistoryState {
  orders: PosOrder[];
  isLoading: boolean;
  error: string | null;
  fetchedAt: string | null;
  queryKey: string | null;
  requestId: number;
  reset: () => void;
  fetchOrders: (query: OrderHistoryQuery) => Promise<void>;
}

export const useOrderHistoryStore = create<OrderHistoryState>((set) => ({
  orders: [],
  isLoading: false,
  error: null,
  fetchedAt: null,
  queryKey: null,
  requestId: 0,

  reset: () => set((state) => ({ orders: [], isLoading: false, error: null, fetchedAt: null, queryKey: null, requestId: state.requestId + 1 })),

  fetchOrders: async (query) => {
    const queryKey = orderHistoryQueryKey(query);
    let requestId = 0;
    set((state) => {
      requestId = state.requestId + 1;
      return {
        orders: state.queryKey === queryKey ? state.orders : [],
        isLoading: true,
        error: null,
        queryKey,
        requestId,
      };
    });
    try {
      const result = await fetchOrderHistory(query);
      set((state) => state.requestId === requestId ? {
          orders: result.orders,
          isLoading: false,
          error: null,
          fetchedAt: result.fetchedAt,
        } : state);
    } catch (error: unknown) {
      console.error("[Lịch sử đơn] Không thể tải đơn hàng:", error);
      set((state) => state.requestId === requestId ? {
          orders: [],
          isLoading: false,
          error: "Không thể tải lịch sử đơn hàng. Vui lòng thử lại.",
        } : state);
      throw error;
    }
  },
}));

export function orderHistoryQueryKey(query: OrderHistoryQuery): string {
  return `${query.accessKey ?? ""}:${query.warehouseId}:${query.startAt}:${query.endAt}`;
}
