import { createHash, timingSafeEqual } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { POS_COLLECTIONS } from "../config/collections";
import { db } from "../config/firebase";

export interface ActivePosDevice {
  id: string;
  warehouseId: string;
  paymentLatencyOptimizationEnabled: boolean;
}

export async function assertActivePosDevice(data: unknown): Promise<ActivePosDevice> {
  const auth =
    data && typeof data === "object"
      ? (data as { device_auth?: unknown }).device_auth
      : null;
  const deviceId =
    auth && typeof auth === "object"
      ? (auth as { device_id?: unknown }).device_id
      : null;
  const credential =
    auth && typeof auth === "object"
      ? (auth as { device_credential?: unknown }).device_credential
      : null;
  if (typeof deviceId !== "string" || typeof credential !== "string") {
    throw new HttpsError("permission-denied", "Máy POS chưa được kích hoạt.");
  }

  const snapshot = await db.collection(POS_COLLECTIONS.devices).doc(deviceId).get();
  const device = snapshot.data();
  const receivedHash = createHash("sha256").update(credential).digest("hex");
  const stored = Buffer.from(
    typeof device?.credential_hash === "string" ? device.credential_hash : "",
    "utf8",
  );
  const received = Buffer.from(receivedHash, "utf8");
  const matches =
    stored.length === received.length && timingSafeEqual(stored, received);
  if (
    !snapshot.exists ||
    device?.is_deleted === true ||
    device?.status !== "ACTIVE" ||
    typeof device?.warehouse_id !== "string" ||
    !matches
  ) {
    throw new HttpsError(
      "permission-denied",
      "Máy POS không có quyền truy cập hoặc đã bị khóa trên JPULSE.",
    );
  }
  return {
    id: snapshot.id,
    warehouseId: device.warehouse_id,
    paymentLatencyOptimizationEnabled: device.payment_latency_optimization_enabled === true,
  };
}
