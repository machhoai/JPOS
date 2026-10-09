"use client";

import { useCallback, useEffect, useMemo } from "react";

import { mapRemoteReceiptSettings } from "@/features/receipt/helpers/remoteReceiptSettings";
import { useReceiptSettingsStore } from "@/features/receipt/store/useReceiptSettingsStore";
import { mapRemoteTicketSettings } from "@/features/ticket/helpers/remoteTicketSettings";
import { useTicketSettingsStore } from "@/features/ticket/store/useTicketSettingsStore";
import { applyCustomerDisplayAdvertisingView } from "@/lib/services/customerDisplayAdvertisingSyncService";
import {
  listenCustomerDisplayAdvertisingReady,
  publishCustomerDisplayAdvertising,
} from "@/lib/services/customerDisplayAdvertisingBridge";
import {
  DeviceSessionError,
  isDeviceEnrollmentRuntime,
  syncRemoteDeviceConfig,
} from "@/lib/services/deviceEnrollmentService";
import {
  cachePaymentSettings,
  clearCachedPaymentSettings,
  loadCachedPaymentSettings,
} from "@/lib/services/paymentSettingsCacheService";
import { useCustomerDisplayAdvertisingStore } from "@/lib/stores/useCustomerDisplayAdvertisingStore";
import type {
  PosDeviceConfigSyncResult,
  PosDeviceCredential,
} from "@/lib/types/deviceEnrollment";
import { getRemoteSettingsRetryDelayMs } from "@/lib/utils/remoteSettingsPolling";

const CONFIG_POLL_INTERVAL_MS = 3 * 60 * 1000;

interface RemoteSettingsSyncInput {
  credential: PosDeviceCredential | null;
  blocked: boolean;
  enabled: boolean;
  onRevoked: (message: string) => void;
}

export function useRemoteDeviceSettingsSync({
  credential,
  blocked,
  enabled,
  onRevoked,
}: RemoteSettingsSyncInput): void {
  const applyReceipt = useReceiptSettingsStore((state) => state.applyRemoteSettings);
  const clearReceipt = useReceiptSettingsStore((state) => state.clearRemoteSettings);
  const applyTicket = useTicketSettingsStore((state) => state.applyRemoteSettings);
  const clearTicket = useTicketSettingsStore((state) => state.clearRemoteSettings);
  const clearAdvertising = useCustomerDisplayAdvertisingStore((state) => state.clear);
  const deviceId = credential?.device_id ?? null;
  const deviceCredential = credential?.device_credential ?? null;
  const warehouseId = credential?.warehouse_id ?? null;
  const pollingCredential = useMemo<PosDeviceCredential | null>(() => {
    if (!deviceId || !deviceCredential || !warehouseId) {
      return null;
    }
    return {
      device_id: deviceId,
      device_credential: deviceCredential,
      warehouse_id: warehouseId,
    };
  }, [deviceCredential, deviceId, warehouseId]);

  const applyAdvertisingSettings = useCallback(async (
    view: NonNullable<PosDeviceConfigSyncResult["customer_display_settings"]>,
  ) => {
    await applyCustomerDisplayAdvertisingView(view);
    await publishCustomerDisplayAdvertising({
      ...view,
      media: view.media.map((item) => ({ ...item, download_url: "" })),
    });
  }, []);

  const applyConfig = useCallback(async (result: PosDeviceConfigSyncResult) => {
    if (result.changed.receipt_settings) {
      if (result.receipt_settings) {
        applyReceipt(
          result.receipt_settings.warehouse_id,
          result.receipt_settings.version,
          mapRemoteReceiptSettings(result.receipt_settings),
        );
      } else if (pollingCredential) {
        clearReceipt(pollingCredential.warehouse_id);
      }
    }
    if (result.changed.ticket_settings) {
      if (result.ticket_settings) {
        applyTicket(
          result.ticket_settings.warehouse_id,
          result.ticket_settings.version,
          mapRemoteTicketSettings(result.ticket_settings),
        );
      } else if (pollingCredential) {
        clearTicket(pollingCredential.warehouse_id);
      }
    }
    if (result.changed.payment_settings) {
      if (result.payment_settings) cachePaymentSettings(result.payment_settings);
      else clearCachedPaymentSettings();
    }
    if (result.changed.customer_display_settings) {
      if (result.customer_display_settings) {
        await applyAdvertisingSettings(result.customer_display_settings);
      } else {
        clearAdvertising();
      }
    }
  }, [
    applyAdvertisingSettings,
    applyReceipt,
    applyTicket,
    clearAdvertising,
    clearReceipt,
    clearTicket,
    pollingCredential,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !pollingCredential ||
      blocked ||
      !isDeviceEnrollmentRuntime()
    ) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let failureCount = 0;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => void poll(), delayMs);
    };
    const poll = async () => {
      try {
        const receiptState = useReceiptSettingsStore.getState();
        const ticketState = useTicketSettingsStore.getState();
        const advertisingState = useCustomerDisplayAdvertisingStore.getState();
        const payment = loadCachedPaymentSettings(
          pollingCredential.device_id,
          pollingCredential.warehouse_id,
        );
        const result = await syncRemoteDeviceConfig(pollingCredential, {
          receipt_settings: receiptState.remoteVersion || null,
          ticket_settings: ticketState.remoteVersion || null,
          payment_settings: payment?.version ?? null,
          customer_display_settings: advertisingState.view?.settings?.version ?? null,
        });
        if (cancelled) return;
        await applyConfig(result);
        failureCount = 0;
        schedule(CONFIG_POLL_INTERVAL_MS);
      } catch (reason: unknown) {
        if (cancelled) return;
        if (reason instanceof DeviceSessionError && reason.revoked) {
          onRevoked(reason.message);
          return;
        }
        failureCount += 1;
        const retryAfterMs =
          reason instanceof DeviceSessionError ? reason.retryAfterMs : null;
        schedule(getRemoteSettingsRetryDelayMs(failureCount, retryAfterMs));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [applyConfig, blocked, enabled, onRevoked, pollingCredential]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let stopListening: (() => void) | null = null;
    const initialize = async () => {
      stopListening = await listenCustomerDisplayAdvertisingReady(() => {
        const currentView = useCustomerDisplayAdvertisingStore.getState().view;
        if (currentView) void publishCustomerDisplayAdvertising(currentView);
      });
      if (disposed) stopListening();
    };
    void initialize();
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [enabled]);
}
