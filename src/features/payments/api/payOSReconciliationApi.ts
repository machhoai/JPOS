import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";

export interface PendingPayOSOrder {
  localOrderId: string;
  totalAmount: number;
  operatorName: string;
  completedAt: string | null;
  dueAt: string | null;
  alertedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  acknowledged: boolean;
}

async function request<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const data = await withDeviceAuth({ action, payload });
  const response = await httpsCallable<typeof data, T>(functions, "payosPayment")(data);
  return response.data;
}

export const listPendingPayOSOrders = (warehouseId: string) =>
  request<{ orders: PendingPayOSOrder[]; serverTime: string }>("reconcile-list", { warehouseId });

export const checkPendingPayOSOrder = (localOrderId: string) =>
  request<{ pending: boolean; verified: boolean; order: PendingPayOSOrder }>("reconcile-check", { localOrderId });

export const acknowledgePayOSAlert = (localOrderId: string) =>
  request<{ acknowledged: boolean }>("reconcile-ack", { localOrderId });
