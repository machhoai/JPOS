"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/lib/contexts/AuthContext";
import { db } from "@/lib/firebase/client";
import { loadDeviceCredential } from "@/lib/services/deviceEnrollmentService";
import { usePrinterSettingsStore } from "@/features/printer/store/usePrinterSettingsStore";
import { isRemoteSettingsOwnerPathname } from "@/lib/utils/remoteSettingsPolling";

const COLLECTION = "pos_cash_drawer_settings";

export default function CashDrawerSettingsSync() {
  const { user, effectiveWarehouseId } = useAuth();
  const pathname = usePathname();
  useEffect(() => {
    if (!user || !effectiveWarehouseId || !isRemoteSettingsOwnerPathname(pathname)) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void loadDeviceCredential().then((credential) => {
      if (disposed || !credential || credential.warehouse_id !== effectiveWarehouseId) return;
      const { device_id: deviceId, warehouse_id: warehouseId } = credential;
      usePrinterSettingsStore.getState().bindCashDrawerDevice(deviceId, warehouseId);
      unsubscribe = onSnapshot(doc(db, COLLECTION, deviceId), (snapshot) => {
        if (disposed || snapshot.metadata.fromCache) return;
        try {
          usePrinterSettingsStore.getState().applyRemoteCashDrawerSettings(snapshot.exists() ? snapshot.data() : null, deviceId, warehouseId);
        } catch (error: unknown) {
          console.error("[Két tiền] Không lưu được cache cấu hình két:", error);
        }
      }, (error) => console.error("[Két tiền] Đồng bộ JPULSE chưa sẵn sàng, giữ cấu hình cache:", error));
    }).catch((error: unknown) => console.error("[Két tiền] Không thể đọc thông tin thiết bị:", error));
    return () => { disposed = true; unsubscribe?.(); };
  }, [effectiveWarehouseId, pathname, user]);
  return null;
}
