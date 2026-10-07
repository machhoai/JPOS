"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/AuthContext";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { dismissToast, showError, showWarningAction } from "@/lib/utils/toast";
import { fetchOrderForReceipt } from "@/lib/services/orderService";
import { acknowledgePayOSAlert, listPendingPayOSOrders } from "../api/payOSReconciliationApi";
import { buildOrderNotificationHref } from "../helpers/orderNotificationLink";
import { usePayOSReconciliationStore } from "../store/usePayOSReconciliationStore";

export default function PayOSReconciliationMonitor() {
  const { user, effectiveWarehouseId } = useAuth();
  return <Monitor key={`${user?.uid ?? ""}:${effectiveWarehouseId ?? ""}`} />;
}

function Monitor() {
  const { user, effectiveWarehouseId, hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const active = Boolean(user && effectiveWarehouseId && hasPermission("pos.orders.read", effectiveWarehouseId) &&
    !pathname.startsWith("/display") && !pathname.startsWith("/login") && !pathname.startsWith("/invoice"));
  const userId = user?.uid;

  useEffect(() => {
    if (!active || !effectiveWarehouseId || !userId) return;
    const scopeKey = `${userId}:${effectiveWarehouseId}`;
    let stopped = false;
    let loading = false;
    let errorShown = false;
    let timer: ReturnType<typeof setTimeout>;
    const shown = new Map<string, { toastId: string | number; lastShownAt: number }>();
    const acknowledge = (id: string) => {
      if (!stopped) void acknowledgePayOSAlert(id).catch((error: unknown) => {
        console.warn("[PayOS] Không thể đánh dấu thông báo đã xem", error);
      });
    };
    const refresh = async () => {
      if (loading || stopped) return;
      loading = true;
      try {
        const response = await listPendingPayOSOrders(effectiveWarehouseId);
        if (stopped) return;
        usePayOSReconciliationStore.getState().setPendingOrders(scopeKey, response.orders);
        errorShown = false;
        const pending = new Set(response.orders.filter((order) => !order.acknowledged).map((order) => order.localOrderId));
        for (const [id, toast] of shown) {
          if (!pending.has(id)) {
            shown.delete(id);
            dismissToast(toast.toastId);
          }
        }
        const now = Date.now();
        const overdue = response.orders.filter((order) => order.alertedAt && !order.acknowledged &&
          now - (shown.get(order.localOrderId)?.lastShownAt ?? 0) >= 5 * 60_000).slice(0, 3);
        for (const order of overdue) {
          const toastId = showWarningAction(
            `Đơn #${order.localOrderId.split("-").pop()} chưa được PayOS xác nhận`,
            `${formatCurrency(order.totalAmount)} · Đã hoàn thành thủ công hơn 5 phút. Vui lòng đối chiếu giao dịch.`,
            {
              label: "Xem đơn",
              onClick: () => {
                void fetchOrderForReceipt(order.localOrderId).then((target) => {
                  if (stopped) return;
                  if (target.warehouseId !== effectiveWarehouseId) throw new Error("Đơn không thuộc điểm bán đang chọn.");
                  router.push(buildOrderNotificationHref(target), { scroll: false });
                  acknowledge(order.localOrderId);
                  dismissToast(toastId);
                }).catch((error: unknown) => {
                  if (!stopped) showError("Không thể mở đơn hàng", error instanceof Error ? error.message : "Vui lòng thử lại.");
                });
              },
            },
            { id: `payos-unverified:${userId}:${order.localOrderId}`, onDismiss: () => acknowledge(order.localOrderId) },
          );
          shown.set(order.localOrderId, { toastId, lastShownAt: now });
        }
      } catch (error) {
        if (!stopped && !errorShown) {
          errorShown = true;
          showError("Không thể cập nhật cảnh báo PayOS", "Vui lòng kiểm tra kết nối. Hệ thống sẽ tự thử lại.");
          console.warn("[PayOS] Không thể tải cảnh báo", error);
        }
      } finally {
        loading = false;
        if (!stopped) timer = setTimeout(() => void refresh(), 15_000);
      }
    };
    const wake = () => { clearTimeout(timer); void refresh(); };
    void refresh();
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      usePayOSReconciliationStore.getState().clearScope(scopeKey);
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      shown.forEach((toast) => dismissToast(toast.toastId));
    };
  }, [active, effectiveWarehouseId, userId, router]);

  return null;
}
