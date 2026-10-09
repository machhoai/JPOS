"use client";

import { MonitorCheck, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRemoteDeviceSettingsSync } from "@/lib/hooks/useRemoteDeviceSettingsSync";
import {
  activateDevice,
  canUseOfflineDeviceCredential,
  clearDeviceCredential,
  DeviceSessionError,
  isDeviceEnrollmentRuntime,
  loadDeviceCredential,
  openDeviceSession,
  persistVerifiedDeviceSession,
} from "@/lib/services/deviceEnrollmentService";
import { setCheckoutTelemetryDeviceContext } from "@/lib/services/checkoutTelemetryService";
import type { PosDeviceCredential } from "@/lib/types/deviceEnrollment";
import { isRemoteSettingsOwnerPathname } from "@/lib/utils/remoteSettingsPolling";
export default function DeviceActivationGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ownsRemoteSettings = isRemoteSettingsOwnerPathname(pathname);
  const [credential, setCredential] = useState<PosDeviceCredential | null>(null);
  const [checking, setChecking] = useState(true);
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState("Quầy POS");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState<
    "REVOKED" | "OFFLINE_EXPIRED" | "PENDING" | null
  >(null);
  const [warning, setWarning] = useState("");
  const handleRevoked = useCallback((message: string) => {
    setBlocked(true);
    setBlockReason(credential?.warehouse_id ? "REVOKED" : "PENDING");
    setError(message);
  }, [credential?.warehouse_id]);
  useRemoteDeviceSettingsSync({
    credential,
    blocked,
    enabled: ownsRemoteSettings,
    onRevoked: handleRevoked,
  });

  const syncDevice = useCallback(
    async (deviceCredential: PosDeviceCredential) => {
      try {
        const session = await openDeviceSession(deviceCredential);
        const updatedCredential = await persistVerifiedDeviceSession(
          deviceCredential,
          session,
        );
        setCheckoutTelemetryDeviceContext({
          deviceId: updatedCredential.device_id,
          warehouseId: updatedCredential.warehouse_id,
        });
        setCredential(updatedCredential);
        setBlocked(false);
        setBlockReason(null);
        setWarning("");
        if (
          deviceCredential.warehouse_id &&
          deviceCredential.warehouse_id !== session.device.warehouse_id
        ) {
          window.dispatchEvent(new Event("jpos:device-warehouse-changed"));
        }
      } catch (reason: unknown) {
        if (reason instanceof DeviceSessionError && reason.revoked) {
          setBlocked(true);
          setBlockReason(deviceCredential.warehouse_id ? "REVOKED" : "PENDING");
          setError(reason.message);
          return;
        }
        if (!canUseOfflineDeviceCredential(deviceCredential)) {
          setBlocked(true);
          setBlockReason(deviceCredential.warehouse_id ? "OFFLINE_EXPIRED" : "PENDING");
          setError(
            deviceCredential.warehouse_id
              ? "Quyền offline đã quá 8 giờ. Máy POS phải kết nối lại JPULSE trước khi tiếp tục."
              : "Chưa thể xác minh lần kích hoạt trước. Hãy kết nối JPULSE để tiếp tục.",
          );
          return;
        }
        setBlocked(false);
        setBlockReason(null);
        setWarning(
          "Đang dùng quyền và cấu hình đã cache. JPOS phải kết nối lại JPULSE trong vòng 8 giờ kể từ lần xác minh gần nhất.",
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!isDeviceEnrollmentRuntime()) {
      queueMicrotask(() => setChecking(false));
      return;
    }
    void loadDeviceCredential()
      .then(async (stored) => {
        if (stored) {
          setCheckoutTelemetryDeviceContext({
            deviceId: stored.device_id,
            warehouseId: stored.warehouse_id,
          });
        }
        setCredential(stored);
        if (stored) await syncDevice(stored);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Không thể kiểm tra thiết bị."),
      )
      .finally(() => setChecking(false));
  }, [syncDevice]);

  useEffect(() => {
    if (!credential || !isDeviceEnrollmentRuntime()) return;
    const timer = window.setInterval(() => void syncDevice(credential), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [credential, syncDevice]);

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-200 border-t-amber-500" />
      </main>
    );
  }
  if (!isDeviceEnrollmentRuntime()) return children;
  if (credential && !blocked) {
    return (
      <>
        {warning && (
          <div className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-3 py-1 text-center text-xs font-bold text-white">
            {warning}
          </div>
        )}
        {children}
      </>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const activated = await activateDevice({
        pairingCode: pairingCode.trim(),
        deviceName: deviceName.trim(),
      });
      setCredential(activated);
      setBlocked(false);
      setBlockReason(null);
      await syncDevice(activated);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Kích hoạt không thành công.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetActivation = async () => {
    await clearDeviceCredential();
    setCredential(null);
    setBlocked(false);
    setBlockReason(null);
    setError("");
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-3xl border border-amber-100 bg-white p-7 shadow-xl">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <MonitorCheck size={26} />
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-amber-600">JPOS · Thiết bị tin cậy</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Kích hoạt máy POS</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Nhập mã 8 số do quản trị viên tạo trên JPULSE. Mã chỉ dùng một lần và hết hạn sau 10 phút.
        </p>
        {blocked && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
            {blockReason === "OFFLINE_EXPIRED"
              ? "Quyền offline đã hết hạn sau 8 giờ. Kết nối lại JPULSE để xác minh thiết bị và quyền truy cập."
              : credential?.warehouse_id
                ? "Máy này đã bị khóa trên JPULSE. Quản trị viên cần mở khóa trước khi thử lại."
                : "Lần kích hoạt trước chưa hoàn tất. Hãy kiểm tra lại hoặc xóa phiên chờ để nhập mã mới."}
          </p>
        )}
        {blocked && credential && (
          <div className={`mt-3 grid gap-2 ${blockReason === "OFFLINE_EXPIRED" ? "grid-cols-1" : "grid-cols-2"}`}>
            <button type="button" onClick={() => void syncDevice(credential)} className="h-10 rounded-xl border border-red-200 text-sm font-bold text-red-700">Kiểm tra lại</button>
            {blockReason !== "OFFLINE_EXPIRED" && <button type="button" onClick={() => void resetActivation()} className="h-10 rounded-xl border border-slate-200 text-sm font-bold text-slate-600">Nhập mã mới</button>}
          </div>
        )}
        {!blocked && <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-slate-700">
            Tên quầy
            <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-amber-500" />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Mã kích hoạt
            <input inputMode="numeric" maxLength={8} value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, ""))} placeholder="00000000" required className="mt-1 h-14 w-full rounded-xl border border-slate-200 px-3 text-center font-mono text-2xl tracking-widest outline-none focus:border-amber-500" />
          </label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button type="submit" disabled={submitting || pairingCode.length !== 8 || !deviceName.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 font-bold text-white hover:bg-amber-600 disabled:opacity-50">
            <ShieldCheck size={18} /> {submitting ? "Đang kích hoạt…" : "Kích hoạt thiết bị"}
          </button>
        </form>}
      </section>
    </main>
  );
}
