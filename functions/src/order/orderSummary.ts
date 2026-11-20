import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import type { PosOrder } from "../types/order";

const normalizePhone = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("84") && digits.length >= 11
    ? `0${digits.slice(2)}`
    : digits;
};

const paymentStatusOf = (order: PosOrder): string =>
  order.paymentStatus ?? (order.status === "DRAFT" ? "DRAFT" : "PAID");

const syncStatusOf = (order: PosOrder): string => {
  if (order.syncStatus) return order.syncStatus;
  return {
    DRAFT: "NOT_SYNCED",
    LOCAL_PAID: "PENDING",
    SYNCING: "SYNCING",
    SYNC_FAILED: "SYNC_FAILED",
    SYNC_SUCCESS: "SYNC_SUCCESS",
    CANCELLED: "CANCELLED",
  }[order.status];
};

export const buildPosOrderSummary = (order: PosOrder) => {
  const customerPhone = order.member?.phone?.trim() || null;
  return {
    id: order.localOrderId,
    localOrderId: order.localOrderId,
    warehouseId: order.warehouseId,
    source: order.source ?? "JPOS",
    legacyStatus: order.status,
    paymentStatus: paymentStatusOf(order),
    syncStatus: syncStatusOf(order),
    hkOrderNumber: order.hkOrderNumber ?? null,
    remoteOrderId: order.remoteOrderId ?? null,
    customerName: order.member?.fullName?.trim() || null,
    customerPhone,
    normalizedPhone: normalizePhone(customerPhone),
    operatorId: order.operatorId,
    operatorName: order.operatorName,
    productNames: Array.from(
      new Set(order.items.map((item) => item.goodsName.trim()).filter(Boolean)),
    ),
    items: order.items.map((item) => ({
      goodsId: item.goodsId,
      goodsName: item.goodsName,
      quantity: item.quantity,
      price: item.price,
    })),
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    paidAt: order.paidAt ?? null,
    cancelledAt: order.cancelledAt ?? null,
    version: order.version ?? 0,
    is_deleted: false,
    updatedAt: order.updatedAt,
  };
};

export const shouldApplyOrderSummary = (
  current: Record<string, unknown> | undefined,
  incoming: { version: number; updatedAt: string },
): boolean => {
  if (!current) return true;
  const currentVersion = Number(current.version ?? -1);
  if (incoming.version !== currentVersion) {
    return incoming.version > currentVersion;
  }
  const currentUpdatedAt = typeof current.updatedAt === "string"
    ? current.updatedAt
    : "";
  return incoming.updatedAt > currentUpdatedAt;
};

export const onPosOrderSummaryChanged = onDocumentWritten(
  {
    document: `${POS_COLLECTIONS.orders}/{orderId}`,
    region: "asia-southeast1",
  },
  async (event) => {
    const summaryRef = db
      .collection(POS_COLLECTIONS.orderSummaries)
      .doc(event.params.orderId);
    const snapshot = event.data?.after;
    if (!snapshot?.exists) {
      const deletedAt = new Date().toISOString();
      const deletedVersion = Number(event.data?.before.data()?.version ?? 0) + 1;
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(summaryRef);
        const tombstone = { version: deletedVersion, updatedAt: deletedAt };
        if (
          !shouldApplyOrderSummary(current.data(), tombstone)
        ) return;
        transaction.set(
          summaryRef,
          { ...tombstone, is_deleted: true },
          { merge: true },
        );
      });
      return;
    }
    const incoming = buildPosOrderSummary(snapshot.data() as PosOrder);
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(summaryRef);
      if (!shouldApplyOrderSummary(current.data(), incoming)) return;
      transaction.set(summaryRef, incoming, { merge: false });
    });
  },
);
