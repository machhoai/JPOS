import type {MemberBatchPhase,MemberBatchJobStatus,MemberBatchSafeStage,MemberBatchItem} from '../types/memberBatch';
export const phaseCopy: Record<MemberBatchPhase, { title: string; description: string }> = {
  IDLE: {
    title: "Sẵn sàng đọc thẻ",
    description: "Đặt đúng thẻ chưa kích hoạt lên đầu đọc và giữ nguyên cho đến khi xác thực xong.",
  },
  WAITING_FOR_NEW_CARD: {
    title: "Hãy nhấc thẻ vừa hoàn thành",
    description: "Đặt thẻ mới lên đầu đọc. JPOS sẽ tự nhận khi mã thẻ thay đổi.",
  },
  READING_CARD: {
    title: "Đang đọc thẻ lần 1",
    description: "Giữ nguyên thẻ trên đầu đọc, không thay thẻ lúc này.",
  },
  VERIFYING_CARD: {
    title: "Đang xác thực thẻ lần 2",
    description: "Tiếp tục giữ nguyên thẻ cho đến khi JPOS chuyển sang bước tạo thành viên.",
  },
  REGISTERING_MEMBER: {
    title: "Đang tạo thành viên",
    description: "Thẻ đã đọc chỉ được giữ tạm. Nếu dừng tại đây, lần tiếp tục sẽ yêu cầu đọc lại.",
  },
  ATTACHING_CARD: {
    title: "Đang gắn thẻ trên Joyworld",
    description: "Không đóng ứng dụng. JPOS đang xác nhận quyền sở hữu thẻ và lưu hồ sơ.",
  },
  TOPPING_UP_POINTS: {
    title: "Đang nạp điểm",
    description: "Thẻ đã được gắn. Yêu cầu nạp điểm có mã chống thực hiện trùng khi thử lại.",
  },
};

export const jobStatusCopy: Record<MemberBatchJobStatus, string> = {
  READY: "Sẵn sàng",
  RUNNING: "Đang chạy",
  PAUSE_REQUESTED: "Đang chờ điểm dừng an toàn",
  PAUSED: "Đã tạm dừng",
  NEEDS_ATTENTION: "Cần xử lý",
  COMPLETED: "Hoàn thành",
};

export function safeStageLabel(stage: MemberBatchSafeStage): string {
  return {
    AWAITING_CARD: "Chờ thẻ",
    MEMBER_CREATED: "Đã tạo, cần đọc lại thẻ",
    CARD_ATTACHED: "Đã gắn thẻ",
    COMPLETED: "Hoàn thành",
    SKIPPED: "Đã bỏ qua",
  }[stage];
}

export function stageTone(stage: MemberBatchSafeStage): string {
  if (stage === "COMPLETED") return "bg-emerald-50 text-emerald-700";
  if (stage === "CARD_ATTACHED") return "bg-sky-50 text-sky-700";
  if (stage === "MEMBER_CREATED") return "bg-amber-50 text-amber-800";
  if (stage === "SKIPPED") return "bg-slate-100 text-slate-600";
  return "bg-orange-50 text-orange-700";
}

export function downloadResult(items: MemberBatchItem[], fileName: string): void {
  const escape = (value: unknown): string => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Dòng", "Họ và tên", "Số điện thoại", "Mã thẻ", "Điểm", "Trạng thái", "Lỗi"],
    ...items.map((item) => [
      item.rowNumber,
      item.fullName,
      item.phone,
      item.memberCode || "",
      item.points,
      safeStageLabel(item.safeStage),
      item.errorMessage || "",
    ]),
  ].map((row) => row.map(escape).join(","));
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ket-qua-${fileName.replace(/\.[^.]+$/, "")}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

