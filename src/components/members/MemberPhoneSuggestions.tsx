import { LoaderCircle, RotateCcw } from "lucide-react";
import type { MemberPhoneSuggestion } from "@/lib/types/memberPhoneSearch";
interface Props {
  items: MemberPhoneSuggestion[];
  loading: boolean;
  error: string | null;
  valid: boolean;
  disabled: boolean;
  onSelect: (item: MemberPhoneSuggestion) => void;
  onRetry: () => void;
}
export default function MemberPhoneSuggestions({items,loading,error,valid,disabled,onSelect,onRetry}: Props) {
  return <div id="member-phone-suggestions" aria-live="polite" className="space-y-2">
    {!valid && <p className="text-xs text-[var(--color-text-muted)]">Nhập ít nhất 3 chữ số, rồi chọn thành viên trong danh sách.</p>}
    {loading && <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle className="size-4 animate-spin"/>Đang tìm số điện thoại...</p>}
    {error && <div className="text-sm text-red-700"><p>{error}</p><button type="button" onClick={onRetry} disabled={disabled} className="mt-1 flex items-center gap-1 font-bold"><RotateCcw className="size-4"/>Thử lại tìm kiếm</button></div>}
    {valid && !loading && !error && !items.length && <p className="text-sm text-[var(--color-text-muted)]">Không tìm thấy thành viên trong dữ liệu POS.</p>}
    {!!items.length && <ul aria-label="Gợi ý số điện thoại" className="max-h-64 overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-white shadow-sm">
      {items.map(item => <li key={item.uid}>
        <button type="button" disabled={disabled} onClick={()=>onSelect(item)} className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-orange-50 focus-visible:bg-orange-50 disabled:opacity-50">
          <span><span className="block font-bold text-[var(--color-text-primary)]">{item.phone}</span><span className="block text-sm text-[var(--color-text-secondary)]">{item.fullName || "Khách chưa cung cấp họ tên"}</span>{item.state === "READY" && item.isEnabled === false && <span className="mt-1 block text-xs font-bold text-red-700">Trạng thái: Đang tắt</span>}</span>
          <span className="text-xs font-semibold text-[var(--color-accent)]">{item.state === "READY" ? "Tra cứu" : item.state === "NEEDS_REVIEW" ? "Kiểm tra đăng ký" : "Phục hồi đăng ký"}</span>
        </button>
      </li>)}
    </ul>}
  </div>;
}
