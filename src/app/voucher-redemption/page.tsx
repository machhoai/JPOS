"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import Sidebar from "@/components/layout/Sidebar";
import VoucherRedemptionWorkspace from "@/components/vouchers/VoucherRedemptionWorkspace";
import { useAuth } from "@/lib/contexts/AuthContext";
import { useBarcodeScanner } from "@/lib/hooks/useBarcodeScanner";
import { useVoucherRedemptionQueue } from "@/lib/hooks/useVoucherRedemptionQueue";

export default function VoucherRedemptionPage() {
  const router = useRouter();
  const { user, userDoc, effectiveWarehouseId, effectiveWarehouseName, isLoading, logout } = useAuth();
  const queue = useVoucherRedemptionQueue(
    Number(process.env.NEXT_PUBLIC_SHOP_ID) || 1,
    effectiveWarehouseId || "",
  );
  useBarcodeScanner({
    enabled: Boolean(user && userDoc && effectiveWarehouseId),
    onScan: queue.enqueue,
  });
  useEffect(() => {
    if (!isLoading && (!user || !userDoc)) router.replace("/login");
  }, [isLoading, router, user, userDoc]);

  if (isLoading || !user || !userDoc || !effectiveWarehouseId) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Đang chuẩn bị quầy đổi voucher…</div>;
  }
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      <Sidebar onLogout={logout} />
      <VoucherRedemptionWorkspace
        mode={queue.mode}
        results={queue.results}
        isProcessing={queue.isProcessing}
        isFinalizing={queue.isFinalizing}
        pendingCount={queue.pendingCount}
        batchCount={queue.batchCount}
        canFlush={queue.canFlush}
        warehouseId={effectiveWarehouseId}
        warehouseName={effectiveWarehouseName || undefined}
        onModeChange={queue.setMode}
        onSubmit={queue.enqueue}
        onFlush={queue.flushNow}
        onReprint={queue.reprintOrder}
        onClearResults={queue.clearResults}
      />
    </div>
  );
}
