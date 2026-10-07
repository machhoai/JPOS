import type { CloseoutAccountScope } from "@/lib/services/orderService";

export type CloseoutPeriodMode = "SHIFT" | "DAY";

export interface CloseoutProductSummary {
  goodsId: string;
  goodsName: string;
  quantity: number;
}

export interface CloseoutPaymentSummary {
  paymentMethodId: string;
  paymentMethodName: string;
  orderCount: number;
  totalAmount: number;
}

export interface CloseoutReport {
  orderCount: number;
  productQuantity: number;
  totalRevenue: number;
  products: CloseoutProductSummary[];
  payments: CloseoutPaymentSummary[];
  operatorNames: string[];
  payosVerifiedAmount: number;
  payosUnverifiedAmount: number;
  payosPendingOrders: Array<{
    localOrderId: string;
    totalAmount: number;
    operatorName: string;
    completedAt: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  }>;
}

export interface CloseoutReportMeta {
  periodMode: CloseoutPeriodMode;
  accountScope: CloseoutAccountScope;
  startAt: string;
  endAt: string;
  warehouseName: string;
  accountLabel: string;
  generatedBy: string;
  fetchedAt: string;
}
