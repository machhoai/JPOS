import type { OrderKind } from "@/lib/types/order";

export type CheckoutTelemetryEvent =
  | "payment_status_received"
  | "payment_detected"
  | "openapi_prepare_started"
  | "openapi_prepare_completed"
  | "openapi_prepare_failed"
  | "openapi_finalize_started"
  | "openapi_finalize_completed"
  | "openapi_finalize_failed"
  | "order_loaded"
  | "receipt_dispatched"
  | "receipt_completed"
  | "receipt_failed"
  | "raffle_dispatched"
  | "raffle_completed"
  | "raffle_failed";

type TelemetryDetailValue = string | number | boolean | null;

interface CheckoutTelemetryInput {
  localOrderId: string;
  orderKind?: OrderKind;
  warehouseId?: string | null;
  details?: Record<string, TelemetryDetailValue>;
}

export interface CheckoutTelemetryEntry {
  event: CheckoutTelemetryEvent;
  timestamp: string;
  localOrderId: string;
  orderKind: OrderKind;
  warehouseId: string | null;
  deviceId: string | null;
  durationSincePreviousMs: number | null;
  durationSincePaymentMs: number | null;
  details?: Record<string, TelemetryDetailValue>;
}

const STORAGE_KEY = "jpos:checkout-telemetry:v1";
const MAX_STORED_ENTRIES = 400;
const MAX_TRACKED_ORDERS = 100;

let deviceContext: { deviceId: string | null; warehouseId: string | null } = {
  deviceId: null,
  warehouseId: null,
};
const previousEventAtByOrder = new Map<string, number>();
const paymentDetectedAtByOrder = new Map<string, number>();

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

function trimTrackedOrders(map: Map<string, number>): void {
  while (map.size > MAX_TRACKED_ORDERS) {
    const oldestKey = map.keys().next().value;
    if (typeof oldestKey !== "string") return;
    map.delete(oldestKey);
  }
}

function persistEntry(entry: CheckoutTelemetryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(parsed) ? parsed : [];
    entries.push(entry);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_STORED_ENTRIES)),
    );
  } catch (error: unknown) {
    console.warn("[CheckoutTelemetry] Không thể lưu telemetry cục bộ:", error);
  }
}

export function setCheckoutTelemetryDeviceContext(input: {
  deviceId: string;
  warehouseId: string;
}): void {
  deviceContext = {
    deviceId: input.deviceId || null,
    warehouseId: input.warehouseId || null,
  };
}

export function logCheckoutTelemetry(
  event: CheckoutTelemetryEvent,
  input: CheckoutTelemetryInput,
): CheckoutTelemetryEntry {
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  const previousAt = previousEventAtByOrder.get(input.localOrderId);
  if (event === "payment_detected") {
    paymentDetectedAtByOrder.set(input.localOrderId, now);
  }
  const paymentDetectedAt = paymentDetectedAtByOrder.get(input.localOrderId);
  const entry: CheckoutTelemetryEntry = {
    event,
    timestamp: new Date().toISOString(),
    localOrderId: input.localOrderId,
    orderKind: input.orderKind ?? "STANDARD",
    warehouseId: input.warehouseId || deviceContext.warehouseId,
    deviceId: deviceContext.deviceId,
    durationSincePreviousMs:
      previousAt === undefined ? null : roundDuration(now - previousAt),
    durationSincePaymentMs:
      paymentDetectedAt === undefined ? null : roundDuration(now - paymentDetectedAt),
    ...(input.details ? { details: input.details } : {}),
  };

  previousEventAtByOrder.delete(input.localOrderId);
  previousEventAtByOrder.set(input.localOrderId, now);
  trimTrackedOrders(previousEventAtByOrder);
  trimTrackedOrders(paymentDetectedAtByOrder);
  console.info("[CheckoutTelemetry]", entry);
  persistEntry(entry);
  return entry;
}

export function readCheckoutTelemetry(): CheckoutTelemetryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CheckoutTelemetryEntry[]) : [];
  } catch {
    return [];
  }
}
