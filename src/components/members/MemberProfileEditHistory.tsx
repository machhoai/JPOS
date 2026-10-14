import { formatDate, formatDateTime } from "@/lib/utils/dateFormat";
import { useState } from "react";
import type { MemberProfileChange, MemberProfileSyncStatus } from "@/lib/types/memberProfileEdit";

export const memberProfileSyncLabels: Record<MemberProfileSyncStatus, string> = {
  PENDING: "Chờ đồng bộ", SYNCING: "Đang đồng bộ", PARTIAL: "Đồng bộ một phần", RETRY_WAIT: "Chờ thử lại",
  UNKNOWN: "Chưa xác định kết quả", NEEDS_ACTION: "Cần xử lý", SYNCED: "Đã đồng bộ", SUPERSEDED: "Đã được thay thế",
};
const fieldLabels = { fullName: "Họ tên", phone: "Điện thoại", nickName: "Tên gọi", gender: "Giới tính", birthDate: "Ngày sinh", email: "Email" };
function valueLabel(value: unknown, field: string): string {
  if (!value) return "Chưa có";
  if (field === "birthDate") return formatDate(String(value)) || "Chưa có";
  return ({ MALE: "Nam", FEMALE: "Nữ", UNKNOWN: "Chưa xác định", OTHER: "Khác" } as Record<string, string>)[String(value)] ?? String(value);
}
interface Props {
  changes: MemberProfileChange[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  canRetry: boolean;
  onReload: () => void;
  onMore: () => void;
  onRetry: (operationId: string) => void;
  onResolve: (operationId: string) => void;
}
const MemberProfileEditHistory: React.FC<Props> = ({ changes, loading, error, hasMore, canRetry, onReload, onMore, onRetry, onResolve }) => {
  const [filter, setFilter] = useState("ALL");
  const filtered = changes.filter(change => filter === "ALL" || (filter === "PENDING" ? !["SYNCED", "SUPERSEDED"].includes(change.status) : change.status === filter));
  return <section className="space-y-3 rounded-3xl border border-[var(--color-border)] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">Lịch sử chỉnh sửa thông tin</h3><button type="button" onClick={onReload} disabled={loading} className="rounded-xl border px-3 py-2 text-sm font-bold">{loading ? "Đang tải…" : "Tải lại"}</button></div>
    <label className="block text-sm font-semibold">Trạng thái<select value={filter} onChange={e => setFilter(e.target.value)} className="ml-2 rounded-lg border p-2"><option value="ALL">Tất cả</option><option value="PENDING">Chưa hoàn tất</option><option value="SYNCED">Đã đồng bộ</option><option value="NEEDS_ACTION">Cần xử lý</option></select></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!loading && !filtered.length && <p className="py-4 text-sm text-[var(--color-text-muted)]">Chưa có thay đổi phù hợp trong trang đã tải.</p>}
    {filtered.map(change => <details key={change.operationId} className="rounded-2xl border border-[var(--color-border)] p-3">
      <summary className="cursor-pointer text-sm font-semibold">Phiên bản {change.revision} · {memberProfileSyncLabels[change.status]}<span className="mt-1 block text-xs font-normal text-[var(--color-text-muted)]">{formatDateTime(change.createdAt, { second: "2-digit" })} · {change.createdByName}</span></summary>
      <dl className="mt-3 space-y-2 text-sm">{change.changedFields.map(field => <div key={field}><dt className="font-bold">{fieldLabels[field]}</dt><dd className="break-words">{valueLabel(change.before[field], field)} → {valueLabel(change.after[field], field)}</dd></div>)}</dl>
      <div className="mt-3 space-y-1 text-xs text-[var(--color-text-secondary)]"><p>Đổi điện thoại: {change.phoneStep === "DONE" ? "Đã đối chiếu / không cần đổi" : "Chưa hoàn tất"}</p><p>Sửa hồ sơ: {change.profileStep === "DONE" ? "Đã đối chiếu / không cần đổi" : "Chưa hoàn tất"}</p><p>Số lần thử: {change.attemptCount} · Cập nhật cuối: {formatDateTime(change.updatedAt, { second: "2-digit" })}</p></div>
      {change.lastError && <p className="mt-2 rounded-lg bg-orange-50 p-2 text-sm text-orange-800">{change.lastError}</p>}
      {change.status === "PENDING" && changes.some(item => item.revision < change.revision && !["SYNCED", "SUPERSEDED"].includes(item.status)) && <p className="mt-2 text-xs text-orange-700">Chờ xử lý thay đổi trước.</p>}
      {canRetry && !["SYNCED", "SUPERSEDED", "SYNCING"].includes(change.status) && <button type="button" onClick={() => onRetry(change.operationId)} className="mt-3 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-bold text-white">Thử đồng bộ lại</button>}
      {canRetry && change.status === "NEEDS_ACTION" && !change.inFlightStep && !changes.some(item => item.revision < change.revision && !["SYNCED", "SUPERSEDED"].includes(item.status)) && <button type="button" onClick={() => onResolve(change.operationId)} className="ml-2 mt-3 rounded-lg border px-3 py-2 text-sm font-bold">Sửa dữ liệu và đồng bộ lại</button>}
      {change.resolvedByOperationId && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Đã được liên kết với một bản sửa mới; thay đổi này không được tính là đồng bộ thành công.</p>}
    </details>)}
    {hasMore && <button type="button" disabled={loading} onClick={onMore} className="w-full rounded-xl border p-3 text-sm font-bold">Xem thay đổi trước</button>}
  </section>;
};
export default MemberProfileEditHistory;
