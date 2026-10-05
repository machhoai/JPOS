import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase/client";
import { POS_CLIENT_COLLECTIONS } from "@/lib/firebase/collections";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import type { OrderStatus, PayOSPaymentStatus } from "@/lib/types/order";

export interface PaymentStatusSnapshot {
  confirmationSource?: "WEBHOOK" | "API_CHECK" | "MANUAL" | null;
  localOrderId: string;
  orderCode: number | null;
  orderStatus: OrderStatus;
  paymentStatus: PayOSPaymentStatus | null;
  paidAt: string | null;
  updatedAt: string;
}

export interface PaymentWatch {
  watchId: string;
  expiresAt: string;
}

export async function createPaymentWatch(localOrderId: string): Promise<PaymentWatch> {
  const request = await withDeviceAuth({ action: "watch", payload: { localOrderId } });
  const result = await httpsCallable<typeof request, PaymentWatch>(functions, "payosPayment")(request);
  return result.data;
}

export function watchPaymentStatus(
  watchId: string,
  onStatus: (snapshot: PaymentStatusSnapshot) => void,
  onHealth: (healthy: boolean) => void,
): () => void {
  return onSnapshot(doc(db, POS_CLIENT_COLLECTIONS.paymentStatus, watchId),
    { includeMetadataChanges: true },
    (snapshot) => {
      const authoritative = snapshot.exists() && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
      onHealth(authoritative);
      if (authoritative) onStatus(snapshot.data() as PaymentStatusSnapshot);
    },
    (error) => {
      console.warn("[PayOS] Realtime không khả dụng; dùng kiểm tra dự phòng", error.code);
      onHealth(false);
    },
  );
}
