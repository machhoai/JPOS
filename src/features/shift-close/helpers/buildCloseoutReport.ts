import type { PosOrder } from "@/lib/types/order";
import type {
  CloseoutPaymentSummary,
  CloseoutProductSummary,
  CloseoutReport,
} from "@/features/shift-close/types/closeout";
import { isOrderRevenueEligible } from "@/lib/utils/orderLifecycle";
import { isPayOSOrder, needsPayOSReconciliation } from "@/features/payments/helpers/payOSReconciliation";

const PAYMENT_METHOD_NAMES: Record<string, string> = {
  CASH: "Tiền mặt",
  QR_CODE: "Chuyển khoản",
};

const PAYMENT_METHOD_ORDER = ["CASH", "QR_CODE"];

function toMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function buildCloseoutReport(orders: PosOrder[]): CloseoutReport {
  const productMap = new Map<string, CloseoutProductSummary>();
  const paymentMap = new Map<string, CloseoutPaymentSummary>(
    PAYMENT_METHOD_ORDER.map((paymentMethodId) => [
      paymentMethodId,
      {
        paymentMethodId,
        paymentMethodName: PAYMENT_METHOD_NAMES[paymentMethodId],
        orderCount: 0,
        totalAmount: 0,
      },
    ]),
  );
  const operatorNames = new Set<string>();
  let productQuantity = 0;
  let totalRevenue = 0;
  const revenueOrders = orders.filter(isOrderRevenueEligible);
  const payosOrders = revenueOrders.filter(isPayOSOrder);
  const payosPendingOrders = payosOrders.filter(needsPayOSReconciliation).map((order) => ({
    localOrderId: order.localOrderId,
    totalAmount: toMoney(order.totalAmount),
    operatorName: order.paymentDetails?.manualConfirmation?.confirmedByName ?? order.operatorName ?? "Chưa rõ",
    completedAt: order.paidAt ?? null,
    lastCheckedAt: order.payosReconciliation?.lastCheckedAt ?? null,
    lastError: order.payosReconciliation?.lastError ?? null,
  }));

  for (const order of revenueOrders) {
    const orderAmount = toMoney(order.totalAmount);
    totalRevenue += orderAmount;
    if (order.operatorName?.trim()) operatorNames.add(order.operatorName.trim());

    const paymentMethodId = order.paymentMethodId || order.paymentMethod;
    const payment = paymentMap.get(paymentMethodId) || {
      paymentMethodId,
      paymentMethodName:
        order.paymentMethodName || PAYMENT_METHOD_NAMES[paymentMethodId] || "Phương thức khác",
      orderCount: 0,
      totalAmount: 0,
    };
    payment.orderCount += 1;
    payment.totalAmount += orderAmount;
    paymentMap.set(paymentMethodId, payment);

    for (const item of order.items) {
      const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
      productQuantity += quantity;
      const current = productMap.get(item.goodsId);
      if (current) {
        current.quantity += quantity;
      } else {
        productMap.set(item.goodsId, {
          goodsId: item.goodsId,
          goodsName: item.goodsName || item.goodsId,
          quantity,
        });
      }
    }
  }

  const payments = Array.from(paymentMap.values()).sort((left, right) => {
    const leftIndex = PAYMENT_METHOD_ORDER.indexOf(left.paymentMethodId);
    const rightIndex = PAYMENT_METHOD_ORDER.indexOf(right.paymentMethodId);
    if (leftIndex === -1 && rightIndex === -1) {
      return left.paymentMethodName.localeCompare(right.paymentMethodName, "vi");
    }
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });

  return {
    orderCount: revenueOrders.length,
    productQuantity,
    totalRevenue,
    payosVerifiedAmount: payosOrders.filter((order) => order.paymentVerificationStatus !== "UNVERIFIED")
      .reduce((sum, order) => sum + toMoney(order.totalAmount), 0),
    payosUnverifiedAmount: payosPendingOrders.reduce((sum, order) => sum + order.totalAmount, 0),
    payosPendingOrders,
    products: Array.from(productMap.values()).sort((left, right) =>
      left.goodsName.localeCompare(right.goodsName, "vi"),
    ),
    payments,
    operatorNames: Array.from(operatorNames).sort((left, right) =>
      left.localeCompare(right, "vi"),
    ),
  };
}
