"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { createPaymentWatch, watchPaymentStatus } from "@/lib/services/paymentStatusService";
import { usePayOSPaymentStore } from "@/lib/stores/usePayOSPaymentStore";

export function usePaymentStatusWatch(enabled: boolean): void {
  const localOrderId = usePayOSPaymentStore((state) => state.localOrderId);
  const ready = usePayOSPaymentStore((state) => Boolean(state.session) && !state.isCreating);
  const completed = usePayOSPaymentStore((state) => state.nextAction === "COMPLETED");

  useEffect(() => {
    if (!enabled || !localOrderId || !ready || completed) return;
    let active = true;
    let connectionGeneration = 0;
    let stopWatch: (() => void) | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const store = usePayOSPaymentStore;
    const setHealth = (healthy: boolean) => {
      if (active && store.getState().localOrderId === localOrderId) store.getState().setRealtimeHealthy(healthy);
    };
    const connect = async () => {
      const generation = ++connectionGeneration;
      try {
        const watch = await createPaymentWatch(localOrderId);
        if (!active || !auth.currentUser || generation !== connectionGeneration) return;
        stopWatch?.();
        stopWatch = watchPaymentStatus(watch.watchId, (snapshot) => {
          if (active && generation === connectionGeneration && snapshot.localOrderId === localOrderId) store.getState().receivePaymentStatus(snapshot);
        }, setHealth);
        expiryTimer = setTimeout(() => {
          setHealth(false);
          void connect();
        }, Math.max(1000, Date.parse(watch.expiresAt) - Date.now() - 30000));
      } catch (error: unknown) {
        console.warn("[PayOS] Không thể mở phiên realtime; dùng kiểm tra dự phòng", error);
        setHealth(false);
      }
    };
    const stopAuth = onAuthStateChanged(auth, (user) => {
      connectionGeneration++;
      stopWatch?.();
      if (expiryTimer) clearTimeout(expiryTimer);
      setHealth(false);
      if (user) void connect();
    });
    const offline = () => setHealth(false);
    window.addEventListener("offline", offline);
    return () => {
      active = false;
      stopAuth();
      stopWatch?.();
      if (expiryTimer) clearTimeout(expiryTimer);
      window.removeEventListener("offline", offline);
      store.getState().setRealtimeHealthy(false);
    };
  }, [completed, enabled, localOrderId, ready]);
}
