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
  fetchOrders: (query: OrderHistoryQuery) => Promise<void>;
}

export const useOrderHistoryStore = create<OrderHistoryState>((set) => ({
  orders: [],
  isLoading: false,
  error: null,
  fetchedAt: null,
  queryKey: null,
  requestId: 0,

  fetchOrders: async (query) => {
    const queryKey = `${query.warehouseId}:${query.startAt}:${query.endAt}`;
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
          isLoading: false,
          error: "Không thể tải lịch sử đơn hàng. Vui lòng thử lại.",
        } : state);
      throw error;
    }
  },
}));
