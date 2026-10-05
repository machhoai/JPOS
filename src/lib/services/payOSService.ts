import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import type {
  OrderItem,
  OrderMemberSnapshot,
} from "@/lib/types/order";
import type { PayOSPaymentResult } from "@/lib/types/payment";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";

export interface CreatePayOSPaymentInput {
  localOrderId: string;
  shopId: number;
  warehouseId: string;
  uid?: string;
  member?: OrderMemberSnapshot;
  items: Array<Pick<OrderItem, "goodsId" | "quantity">>;
  voucherCodes?: string[];
}

type PayOSPaymentAction =
  | "create"
  | "status"
  | "timeout"
  | "resume"
  | "recreate"
  | "cancel"
  | "manual-confirm";

interface PayOSCallableRequest {
  action: PayOSPaymentAction;
  payload: CreatePayOSPaymentInput | { localOrderId: string };
}

const callPayOSPayment = httpsCallable<
  PayOSCallableRequest,
  PayOSPaymentResult
>(functions, "payosPayment");

async function callOrderAction(
  action: Exclude<PayOSPaymentAction, "create">,
  localOrderId: string,
): Promise<PayOSPaymentResult> {
  const response = await callPayOSPayment({
    ...(await withDeviceAuth({ action, payload: { localOrderId } })),
  } as PayOSCallableRequest);
  return response.data;
}

export async function createPayOSPayment(
  input: CreatePayOSPaymentInput,
): Promise<PayOSPaymentResult> {
  const response = await callPayOSPayment(
    (await withDeviceAuth({ action: "create" as const, payload: input })) as PayOSCallableRequest,
  );
  return response.data;
}

const statusChecks = new Map<string, Promise<PayOSPaymentResult>>();

export function fetchPayOSPaymentStatus(localOrderId: string): Promise<PayOSPaymentResult> {
  const existing = statusChecks.get(localOrderId);
  if (existing) return existing;
  const result = callOrderAction("status", localOrderId).finally(() => {
    if (statusChecks.get(localOrderId) === result) statusChecks.delete(localOrderId);
  });
  statusChecks.set(localOrderId, result);
  return result;
}

export async function waitForPayOSStatusCheck(localOrderId: string): Promise<void> {
  await statusChecks.get(localOrderId)?.catch(() => undefined);
}

export const handlePayOSPaymentTimeout = (localOrderId: string) =>
  callOrderAction("timeout", localOrderId);

export const resumePayOSPayment = (localOrderId: string) =>
  callOrderAction("resume", localOrderId);

export const recreatePayOSPayment = (localOrderId: string) =>
  callOrderAction("recreate", localOrderId);

export const cancelPayOSPayment = (localOrderId: string) =>
  callOrderAction("cancel", localOrderId);

export const confirmPayOSPaymentManually = (localOrderId: string) =>
  callOrderAction("manual-confirm", localOrderId);
