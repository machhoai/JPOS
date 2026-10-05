"use client";

import { useEffect } from "react";
import { usePayOSPaymentStore } from "@/lib/stores/usePayOSPaymentStore";
import { usePaymentStatusWatch } from "@/lib/hooks/usePaymentStatusWatch";

const ORDER_STATUS_POLL_INTERVAL_MS = 2000;
const COUNTDOWN_INTERVAL_MS = 1000;

/**
 * Runs the QR countdown and watches webhook-driven order completion.
 * Realtime delivers confirmation; periodic PayOS checks provide redundancy.
 */
export function usePayOSPaymentTimer(enabled = true): void {
  const realtimeEnabled = usePayOSPaymentStore((state) => state.realtimeEnabled);
  const pollingIntervalMs = usePayOSPaymentStore((state) => state.pollingIntervalMs);
  usePaymentStatusWatch(enabled && realtimeEnabled);
  const realtimeHealthy = usePayOSPaymentStore((state) => state.realtimeHealthy);
  const session = usePayOSPaymentStore((state) => state.session);
  const nextAction = usePayOSPaymentStore((state) => state.nextAction);
  const serverClockOffsetMs = usePayOSPaymentStore(
    (state) => state.serverClockOffsetMs,
  );
  const updateRemainingSeconds = usePayOSPaymentStore(
    (state) => state.updateRemainingSeconds,
  );
  const handleDisplayTimeout = usePayOSPaymentStore(
    (state) => state.handleDisplayTimeout,
  );
  const checkOrderCompletion = usePayOSPaymentStore(
    (state) => state.checkOrderCompletion,
  );
  const fallbackCheck = usePayOSPaymentStore((state) => state.fallbackCheck);

  useEffect(() => {
    if (!enabled || !session || nextAction !== "WAIT") return;

    updateRemainingSeconds();
    const countdownId = window.setInterval(
      updateRemainingSeconds,
      COUNTDOWN_INTERVAL_MS,
    );
    const localDeadlineMs = Math.max(
      Date.now(),
      Date.parse(session.displayExpiresAt) - serverClockOffsetMs,
    );
    const timeoutId = window.setTimeout(() => {
      void handleDisplayTimeout().catch(() => undefined);
    }, localDeadlineMs - Date.now());

    return () => {
      window.clearInterval(countdownId);
      window.clearTimeout(timeoutId);
    };
  }, [
    enabled,
    handleDisplayTimeout,
    nextAction,
    serverClockOffsetMs,
    session,
    updateRemainingSeconds,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      realtimeHealthy ||
      nextAction === "COMPLETED" ||
      nextAction === "FALLBACK"
    ) return;

    let active = true;
    let timeoutId: number | undefined;
    const poll = async () => {
      await checkOrderCompletion();
      if (active) {
        timeoutId = window.setTimeout(poll, ORDER_STATUS_POLL_INTERVAL_MS);
      }
    };
    timeoutId = window.setTimeout(poll, ORDER_STATUS_POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [checkOrderCompletion, enabled, nextAction, realtimeHealthy]);

  useEffect(() => {
    if (!enabled || !session || nextAction !== "WAIT") return;

    const intervalId = window.setInterval(() => {
      const state = usePayOSPaymentStore.getState();
      const activeSession = state.session;
      if (!activeSession || state.nextAction !== "WAIT") return;
      void fallbackCheck();
    }, pollingIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [enabled, fallbackCheck, nextAction, pollingIntervalMs, session]);
}
