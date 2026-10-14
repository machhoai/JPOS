"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/lib/contexts/AuthContext';
import {showError,showSuccess} from '@/lib/utils/toast';
import {readMemberBatchFile} from '../helpers/memberBatchImport';
import {phaseCopy} from '../helpers/memberBatchPresentation';
import {useMemberBatchProcessor} from './useMemberBatchProcessor';
import {useMemberBatchStore} from '../store/useMemberBatchStore';
import type {MemberBatchImportError} from '../types/memberBatch';
export function useMemberBatchWorkspaceController(){
  const router = useRouter();
  const auth = useAuth();
  const job = useMemberBatchStore((state) => state.job);
  const hasHydrated = useMemberBatchStore((state) => state.hasHydrated);
  const createJob = useMemberBatchStore((state) => state.createJob);
  const startOrResume = useMemberBatchStore((state) => state.startOrResume);
  const requestPause = useMemberBatchStore((state) => state.requestPause);
  const retryCurrent = useMemberBatchStore((state) => state.retryCurrent);
  const skipCurrent = useMemberBatchStore((state) => state.skipCurrent);
  const clearJob = useMemberBatchStore((state) => state.clearJob);
  const [importErrors, setImportErrors] = useState<MemberBatchImportError[]>([]);
  const [isImporting, setImporting] = useState(false);
  const [navigateToSalesWhenPaused, setNavigateToSalesWhenPaused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shopId = Number(process.env.NEXT_PUBLIC_SHOP_ID) || 1;
  const warehouseId = auth.effectiveWarehouseId;
  const canCompensate = auth.hasPermission(
    "pos.members.compensate",
    warehouseId || undefined,
  );

  useMemberBatchProcessor({ shopId, warehouseId });

  const current = job?.items[job.currentIndex] ?? null;
  const stats = useMemo(() => {
    const items = job?.items ?? [];
    return {
      completed: items.filter((item) => item.safeStage === "COMPLETED").length,
      skipped: items.filter((item) => item.safeStage === "SKIPPED").length,
      failed: items.filter((item) => Boolean(item.errorMessage) && item.safeStage !== "SKIPPED").length,
      points: items.reduce((total, item) => total + item.points, 0),
    };
  }, [job?.items]);
  const hasPointRows = Boolean(job?.items.some((item) => item.points > 0));
  const warehouseMismatch = Boolean(job && warehouseId && job.warehouseId !== warehouseId);
  const phase = current?.phase ?? "IDLE";
  const phaseMessage = phaseCopy[phase];

  useEffect(() => {
    if (navigateToSalesWhenPaused && (job?.status === "PAUSED" || job?.status === "COMPLETED")) {
      router.push("/");
    }
  }, [job?.status, navigateToSalesWhenPaused, router]);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    if (!warehouseId) {
      showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi nhập danh sách.");
      return;
    }
    if (job && job.status !== "COMPLETED" && !window.confirm(
      "Nhập file mới sẽ thay thế lô đang lưu trên máy này. Bạn có chắc muốn tiếp tục?",
    )) return;

    setImporting(true);
    setImportErrors([]);
    try {
      const result = await readMemberBatchFile(file);
      setImportErrors(result.errors);
      if (result.errors.length > 0) {
        showError("File chưa hợp lệ", `Có ${result.errors.length} lỗi cần sửa trước khi bắt đầu.`);
        return;
      }
      createJob({
        fileName: file.name,
        warehouseId,
        warehouseName: auth.effectiveWarehouseName || warehouseId,
        rows: result.rows,
      });
      showSuccess("Đã đọc file", `Đã nạp ${result.rows.length} thành viên vào hàng đợi.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Không thể đọc file Excel.";
      setImportErrors([{ rowNumber: null, message }]);
      showError("Không thể đọc file", message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [auth.effectiveWarehouseName, createJob, job, warehouseId]);

  const handleStart = useCallback(() => {
    if (!job || warehouseMismatch) return;
    if (hasPointRows && !canCompensate) {
      showError(
        "Thiếu quyền nạp điểm",
        "Lô có thành viên cần nạp điểm nhưng tài khoản chưa có quyền pos.members.compensate.",
      );
      return;
    }
    startOrResume();
  }, [canCompensate, hasPointRows, job, startOrResume, warehouseMismatch]);

  const handlePauseAndSell = useCallback(() => {
    if (!job) return;
    setNavigateToSalesWhenPaused(true);
    requestPause();
  }, [job, requestPause]);

  const handleSkip = useCallback(() => {
    if (!current || !window.confirm(
      `Bỏ qua dòng ${current.rowNumber} – ${current.fullName}? Dòng này sẽ không được tự chạy lại.${
        current.memberUid ? " Thành viên đã tạo trên Joyworld vẫn được giữ lại." : ""
      }`,
    )) return;
    skipCurrent();
  }, [current, skipCurrent]);

  const handleClear = useCallback(() => {
    if (!job || window.confirm("Xóa toàn bộ tiến độ lô này khỏi máy POS?")) {
      clearJob();
      setImportErrors([]);
    }
  }, [clearJob, job]);


return {auth,job,hasHydrated,current,stats,phaseMessage,warehouseMismatch,hasPointRows,canCompensate,isImporting,importErrors,fileInputRef,handleFile,handleStart,handlePauseAndSell,handleSkip,handleClear,requestPause,retryCurrent,goToSales:()=>router.push("/")};
}
