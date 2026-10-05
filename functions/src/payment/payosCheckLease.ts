import { randomUUID } from "node:crypto";
import type { DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import type { PosOrder } from "../types/order";

const CHECK_INTERVAL_MS = 5000;
const LEASE_MS = 8000;

interface CheckLease {
  leaseId?: string | null;
  leaseUntil?: number;
  nextAllowedAt?: number;
  completedAt?: number;
  backoffUntil?: number;
}

export function canClaimPayOSCheck(value: CheckLease, now: number, requireFresh: boolean): boolean {
  return (value.leaseUntil ?? 0) <= now && (value.backoffUntil ?? 0) <= now &&
    (requireFresh || (value.nextAllowedAt ?? 0) <= now);
}

export function payOSRetryDelay(error: unknown, now = Date.now()): number {
  if (!error || typeof error !== "object" || !("status" in error) || error.status !== 429) return CHECK_INTERVAL_MS;
  const headers = "headers" in error ? error.headers as Headers | undefined : undefined;
  const retryAfter = headers?.get?.("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  return Math.max(CHECK_INTERVAL_MS, Number.isFinite(seconds) ? seconds * 1000 :
    retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Date.parse(retryAfter) - now : 10000);
}

/** Distributed lease: different tabs/devices/instances share the same PayOS GET.
 * Keep provider calls outside Firestore transaction retries. */
export async function withPayOSCheckLease(
  orderRef: DocumentReference,
  orderCode: number,
  requireFresh: boolean,
  check: () => Promise<PosOrder>,
): Promise<PosOrder> {
  const ref = db.collection(POS_COLLECTIONS.paymentChecks).doc(String(orderCode));
  const leaseId = randomUUID();
  const startedAt = Date.now();
  while (true) {
    const claim = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const value = (snapshot.data() ?? {}) as CheckLease;
      const now = Date.now();
      if (requireFresh && (value.completedAt ?? 0) >= startedAt) return "FRESH";
      if ((value.backoffUntil ?? 0) > now) return "BACKOFF";
      if (!canClaimPayOSCheck(value, now, requireFresh)) {
        return (value.leaseUntil ?? 0) > now ? "BUSY" : "FRESH";
      }
      transaction.set(ref, { leaseId, leaseUntil: now + LEASE_MS, nextAllowedAt: now + CHECK_INTERVAL_MS }, { merge: true });
      return "CLAIMED";
    });
    if (claim === "CLAIMED") break;
    if (claim === "BACKOFF" && requireFresh) throw new HttpsError("resource-exhausted", "PayOS đang giới hạn truy vấn. Vui lòng thử lại sau.");
    if (claim !== "BUSY") return (await orderRef.get()).data() as PosOrder;
    if (Date.now() - startedAt >= LEASE_MS + 1000) throw new HttpsError("unavailable", "Đang kiểm tra trạng thái PayOS. Vui lòng thử lại.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  let error: unknown;
  try {
    // A webhook may have completed or replaced this attempt while claiming.
    const current = (await orderRef.get()).data() as PosOrder;
    if (current.status !== "DRAFT" || current.paymentDetails?.currentOrderCode !== orderCode) return current;
    return await check();
  } catch (caught: unknown) {
    error = caught;
    throw caught;
  } finally {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.leaseId !== leaseId) return;
      const now = Date.now();
      transaction.update(ref, {
        leaseId: null,
        leaseUntil: 0,
        ...(error ? { backoffUntil: now + payOSRetryDelay(error, now) } : { completedAt: now, backoffUntil: 0 }),
      });
    });
  }
}
