import type { OrderStatus, OrderSyncStatus } from "@/lib/types/order";

interface OrderNumberStatusProps {
  localOrderId: string | null;
  hkOrderNumber: string | null;
  status: OrderStatus | null;
  syncStatus: OrderSyncStatus | null;
}

export default function OrderNumberStatus({
  localOrderId,
  hkOrderNumber,
  status,
  syncStatus,
}: OrderNumberStatusProps) {
  if (hkOrderNumber) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        <span className="font-semibold text-emerald-700">
          Mã Trung Quốc: {hkOrderNumber}
        </span>
      </div>
    );
  }

  if (!localOrderId) {
    return (
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        Sẵn sàng nhận món
      </p>
    );
  }

  const isLocal = syncStatus === "SKIPPED";
  const isSyncing = !isLocal && (status === "LOCAL_PAID" || status === "SYNCING");
  const isFailed = status === "SYNC_FAILED";

  return (
    <div className="mt-1 space-y-0.5 text-[11px]">
      <p className="truncate text-[var(--color-text-muted)]">
        Mã local: {localOrderId}
      </p>
      {isLocal && <p className="text-emerald-700">Đã thanh toán · hoàn tất nội bộ</p>}
      {(isSyncing || isFailed) && (
        <p className={isFailed ? "text-amber-600" : "text-blue-600"}>
          {isFailed
            ? "Đã thanh toán · chờ đồng bộ lại"
            : "Đã thanh toán · đang đồng bộ nền"}
        </p>
      )}
    </div>
  );
}
