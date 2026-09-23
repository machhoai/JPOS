"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  Wrench,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Sidebar from "@/components/layout/Sidebar";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { useAuth } from "@/lib/contexts/AuthContext";
import { useUpdater } from "@/features/updater/components/UpdateProvider";
import { useCartStore } from "@/lib/stores/useCartStore";

interface RepairProgress {
  stage: "checking" | "downloading" | "installing";
  downloadedBytes: number;
  totalBytes: number | null;
}

interface RepairState extends RepairProgress {
  error: string | null;
}

const INITIAL_REPAIR_STATE: RepairState = {
  stage: "checking",
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
};

const getRepairError = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string"
    ? error : "Không thể sửa chữa JPOS. Vui lòng thử lại.";

const SystemSettingsPage: React.FC = () => {
  const router = useRouter();
  const { user, userDoc, isLoading: authLoading, logout } = useAuth();
  const updater = useUpdater();
  const [repairState, setRepairState] = useState<RepairState | null>(null);
  const repairInProgress = useRef(false);
  const isRepairing = repairState !== null && repairState.error === null;
  const isUpdaterBusy = updater.status === "checking" || updater.status === "downloading" || updater.status === "installing";

  useEffect(() => {
    if (!authLoading && (!user || !userDoc)) router.replace("/login");
  }, [authLoading, router, user, userDoc]);

  const handleCheck = useCallback(() => {
    if (repairInProgress.current) return;
    void updater.checkForUpdates(false);
  }, [updater]);

  const handleInstall = useCallback(() => {
    if (repairInProgress.current) return;
    void updater.installUpdate();
  }, [updater]);

  const isBusy = updater.status === "downloading" || updater.status === "installing";

  const handleRepair = useCallback(async (): Promise<void> => {
    if (repairInProgress.current || !isTauri() || isUpdaterBusy) return;

    const cart = useCartStore.getState();
    if (cart.isCheckingOut || cart.isPaymentLocked || cart.checkoutCheckpoint === "PAYMENT_INITIATED") {
      setRepairState({ ...INITIAL_REPAIR_STATE, error: "Hãy hoàn tất hoặc hủy giao dịch đang xử lý trước khi sửa chữa JPOS." });
      return;
    }

    repairInProgress.current = true;
    setRepairState(INITIAL_REPAIR_STATE);
    try {
      const { Channel, invoke } = await import("@tauri-apps/api/core");
      const onEvent = new Channel<RepairProgress>();
      onEvent.onmessage = (progress) => {
        setRepairState({ ...progress, error: null });
      };
      await invoke<void>("repair_app", { onEvent });
    } catch (error: unknown) {
      setRepairState({ ...INITIAL_REPAIR_STATE, error: getRepairError(error) });
    } finally {
      repairInProgress.current = false;
    }
  }, [isUpdaterBusy]);

  const repairProgress = repairState?.stage === "downloading" && repairState.totalBytes
    ? Math.min(100, Math.round((repairState.downloadedBytes / repairState.totalBytes) * 100))
    : null;

  return (
    <div className="flex h-screen bg-[var(--color-background)]">
      <Sidebar onLogout={logout} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-[var(--color-accent)]">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-[var(--color-text-primary)]">Cập nhật hệ thống</h1>
              <p className="text-xs text-[var(--color-text-muted)]">
                Kiểm tra và cài đặt phiên bản JPOS đã được xác thực
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCheck}
            disabled={isUpdaterBusy || isRepairing}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-white px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${updater.status === "checking" ? "animate-spin" : ""}`} />
            {updater.status === "checking" ? "Đang kiểm tra..." : "Kiểm tra cập nhật"}
          </button>
        </header>

        <SettingsTabs />

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-3xl space-y-5">
          <section className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
            <div className="border-b border-[var(--color-border)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Phiên bản hiện tại</p>
                  <p className="mt-2 text-3xl font-black text-[var(--color-text-primary)]">
                    {updater.currentVersion ? `JPOS ${updater.currentVersion}` : "JPOS"}
                  </p>
                </div>
                <StatusBadge status={updater.status} />
              </div>
            </div>

            <div className="space-y-5 p-6">
              {updater.status === "unsupported" && (
                <MessageBox icon={AlertCircle} tone="muted">
                  Chức năng cập nhật chỉ hoạt động trong ứng dụng JPOS desktop, không hoạt động khi mở bằng trình duyệt.
                </MessageBox>
              )}

              {updater.status === "up-to-date" && (
                <MessageBox icon={CheckCircle2} tone="success">
                  Bạn đang sử dụng phiên bản JPOS mới nhất.
                </MessageBox>
              )}

              {updater.error && (
                <MessageBox icon={AlertCircle} tone="error">{updater.error}</MessageBox>
              )}

              {updater.availableVersion && (
                <div className="rounded-2xl border border-orange-100 bg-orange-50/60 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-[var(--color-accent)]">CÓ BẢN CẬP NHẬT</p>
                      <h2 className="mt-1 text-xl font-extrabold text-[var(--color-text-primary)]">
                        JPOS {updater.availableVersion}
                      </h2>
                      {updater.publishedAt && (
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Phát hành: {new Date(updater.publishedAt).toLocaleString("vi-VN")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleInstall}
                      disabled={isBusy || isRepairing}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {isBusy ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {updater.status === "downloading"
                        ? `Đang tải${updater.progressPercent === null ? "" : ` ${updater.progressPercent}%`}`
                        : updater.status === "installing"
                          ? "Đang cài đặt..."
                          : "Cập nhật ngay"}
                    </button>
                  </div>

                  {updater.status === "downloading" && (
                    <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-orange-100">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
                        style={{ width: updater.progressPercent === null ? "20%" : `${updater.progressPercent}%` }}
                      />
                    </div>
                  )}

                  {updater.notes && (
                    <div className="mt-5 border-t border-orange-100 pt-4">
                      <p className="text-xs font-bold text-[var(--color-text-secondary)]">Nội dung cập nhật</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-muted)]">
                        {updater.notes}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["1", "Kiểm tra", "JPOS đọc thông tin release mới nhất."],
                  ["2", "Xác thực", "Gói cài đặt được kiểm tra bằng chữ ký số."],
                  ["3", "Khởi động lại", "Ứng dụng cài bản mới và tự mở lại."],
                ].map(([number, title, description]) => (
                  <div key={number} className="rounded-2xl border border-[var(--color-border)] p-4">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-black text-[var(--color-text-secondary)]">{number}</span>
                    <p className="mt-3 text-sm font-extrabold text-[var(--color-text-primary)]">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex max-w-xl items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[var(--color-accent)]">
                  <Wrench className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-[var(--color-text-primary)]">Sửa chữa JPOS</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                    Tải lại bộ cài đã xác thực và cài lại JPOS, kể cả khi bạn đang dùng phiên bản mới nhất. Ứng dụng sẽ đóng để cài đặt rồi mở lại.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRepair()}
                disabled={!isTauri() || isUpdaterBusy || isRepairing}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRepairing ? <RefreshCw className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                {isRepairing ? repairState?.stage === "checking"
                  ? "Đang kiểm tra..." : repairState?.stage === "installing"
                    ? "Đang cài đặt..." : `Đang tải${repairProgress === null ? "..." : ` ${repairProgress}%`}`
                  : "Sửa chữa / cài lại"}
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-[var(--color-text-muted)]">
              Cần kết nối Internet. Nếu 360 Total Security đã xóa tệp đọc thẻ, hãy thêm tệp đó vào danh sách tin cậy của 360 trước khi sửa chữa để tránh bị xóa lại.
            </p>
            {repairState?.error && (
              <div className="mt-4" role="alert">
                <MessageBox icon={AlertCircle} tone="error">{repairState.error}</MessageBox>
              </div>
            )}
          </section>
          </div>
        </div>
      </main>
    </div>
  );
};

interface StatusBadgeProps {
  status: ReturnType<typeof useUpdater>["status"];
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const labels: Record<StatusBadgeProps["status"], string> = {
    idle: "Chưa kiểm tra",
    checking: "Đang kiểm tra",
    "up-to-date": "Mới nhất",
    available: "Có bản mới",
    downloading: "Đang tải",
    installing: "Đang cài",
    error: "Cần kiểm tra lại",
    unsupported: "Chỉ dành cho desktop",
  };

  return (
    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-[var(--color-text-secondary)]">
      {labels[status]}
    </span>
  );
};

interface MessageBoxProps {
  icon: React.FC<{ className?: string }>;
  tone: "success" | "error" | "muted";
  children: ReactNode;
}

const MessageBox: React.FC<MessageBoxProps> = ({ icon: Icon, tone, children }) => {
  const toneClasses = {
    success: "bg-emerald-50 text-emerald-800",
    error: "bg-red-50 text-red-700",
    muted: "bg-slate-50 text-slate-600",
  };

  return (
    <div className={`flex gap-3 rounded-2xl p-4 text-sm leading-6 ${toneClasses[tone]}`}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </div>
  );
};

export default SystemSettingsPage;
