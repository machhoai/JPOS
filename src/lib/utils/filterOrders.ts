import type { OrderFilterState } from "@/components/orders/OrderFilters";
import type { PosOrder } from "@/lib/types/order";
import { getOrderCustomerDisplay } from "@/lib/utils/orderCustomer";
import { getOrderDisplayStatus } from "@/lib/utils/orderLifecycle";

export function filterAndSortOrders(
  orders: PosOrder[],
  filters: OrderFilterState,
  warehouseId: string,
): PosOrder[] {
  let result = orders.filter((order) => order.warehouseId === warehouseId);

  if (filters.statusFilter !== "all") {
    result = result.filter(
      (order) => getOrderDisplayStatus(order) === filters.statusFilter,
    );
  }

  if (filters.paymentMethodFilter !== "all") {
    result = result.filter(
      (order) =>
        (order.paymentMethodId || order.paymentMethod) ===
        filters.paymentMethodFilter,
    );
  }

  if (filters.employeeFilter !== "all") {
    result = result.filter(
      (order) =>
        (order.createdBy || order.operatorFirebaseUid) ===
        filters.employeeFilter,
    );
  }

  const query = filters.searchQuery.toLowerCase().trim();
  if (query) {
    result = result.filter((order) => {
      const customer = getOrderCustomerDisplay(order);
      return (
        order.localOrderId.toLowerCase().includes(query) ||
        order.hkOrderNumber?.toLowerCase().includes(query) ||
        order.items.some((item) =>
          item.goodsName.toLowerCase().includes(query)
        ) ||
        customer.name.toLowerCase().includes(query) ||
        customer.phone.includes(query) ||
        customer.memberCode.toLowerCase().includes(query) ||
        customer.levelName.toLowerCase().includes(query) ||
        customer.uid.toLowerCase().includes(query)
      );
    });
  }

  return result.sort((left, right) => {
    if (filters.sortBy === "oldest") {
      return new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime();
    }
    if (filters.sortBy === "highest") {
      return right.totalAmount - left.totalAmount;
    }
    if (filters.sortBy === "lowest") {
      return left.totalAmount - right.totalAmount;
    }
    return new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime();
  });
}
