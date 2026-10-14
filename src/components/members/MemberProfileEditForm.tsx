import DateInput from "@/components/ui/DateInput";
import { LoaderCircle, Save, X } from "lucide-react";
import type { MemberEditableProfile } from "@/lib/types/memberProfileEdit";

interface Props {
  draft: MemberEditableProfile;
  saving: boolean;
  uncertain: boolean;
  canSave: boolean;
  error: string | null;
  onChange: (patch: Partial<MemberEditableProfile>) => void;
  onSave: () => void;
  onCancel: () => void;
  onReload: () => void;
}
const inputClass = "mt-1 h-12 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 font-semibold disabled:bg-neutral-100";
const MemberProfileEditForm: React.FC<Props> = ({ draft, saving, uncertain, canSave, error, onChange, onSave, onCancel, onReload }) => {
  const locked = saving || uncertain;
  const nameError = !draft.fullName.trim() ? "Họ tên không được để trống." : null;
  const phoneError = !/^\+?\d{8,15}$/.test(draft.phone.trim().replace(/[\s().-]/g, "")) ? "Số điện thoại phải gồm 8–15 chữ số." : null;
  return <form onSubmit={event => { event.preventDefault(); onSave(); }} className="space-y-4 rounded-3xl border border-orange-200 bg-white p-5">
    <h3 className="text-lg font-extrabold">Chỉnh sửa thông tin thành viên</h3>
    <p className="text-sm text-[var(--color-text-muted)]">Khách đang nhìn thấy thông tin bạn nhập trên màn hình khách. Các ô có dấu * là bắt buộc.</p>
    <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-bold">Họ tên *<input aria-label="Họ tên *" autoFocus required maxLength={120} value={draft.fullName} aria-invalid={Boolean(nameError)} onChange={e => onChange({ fullName: e.target.value })} className={inputClass} />{nameError && <span className="mt-1 block text-xs text-red-700">{nameError}</span>}</label>
      <label className="text-sm font-bold">Số điện thoại *<input aria-label="Số điện thoại *" required type="tel" maxLength={32} value={draft.phone} aria-invalid={Boolean(phoneError)} onChange={e => onChange({ phone: e.target.value })} className={inputClass} />{phoneError && <span className="mt-1 block text-xs text-red-700">{phoneError}</span>}</label>
      <label className="text-sm font-bold">Tên gọi *<input aria-label="Tên gọi *" required maxLength={120} value={draft.nickName} onChange={e => onChange({ nickName: e.target.value })} className={inputClass} /><span className="mt-1 block text-xs font-normal text-[var(--color-text-muted)]">Giữ tên gọi riêng nếu khách đã có; khi chưa có thì dùng họ tên.</span></label>
      <label className="text-sm font-bold">Giới tính *<select required value={draft.gender} onChange={e => onChange({ gender: e.target.value as MemberEditableProfile["gender"] })} className={inputClass}>
        {!['MALE', 'FEMALE'].includes(draft.gender) && <option value={draft.gender} disabled>Vui lòng chọn giới tính</option>}<option value="MALE">Nam</option><option value="FEMALE">Nữ</option>
      </select></label>
      <label className="text-sm font-bold">Ngày sinh<DateInput type="date" value={draft.birthDate ?? ""} onValueChange={value => onChange({ birthDate: value || null })} className={inputClass} /></label>
      <label className="text-sm font-bold">Email<input type="email" maxLength={254} value={draft.email ?? ""} onChange={e => onChange({ email: e.target.value || null })} className={inputClass} /></label>
    </fieldset>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {uncertain && <p className="text-sm font-semibold text-orange-700">Kết quả lưu chưa xác định. Bấm kiểm tra để thử lại cùng mã thao tác trước khi chỉnh sửa tiếp.</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {error && !locked && <button type="button" onClick={onReload} className="min-h-12 rounded-xl border px-4 text-sm font-bold">Tải bản đã lưu để sửa</button>}
      <button type="button" disabled={locked} onClick={onCancel} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 font-bold disabled:opacity-50"><X className="size-4" />Hủy chỉnh sửa</button>
      <button type="submit" disabled={!canSave} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? "Đang lưu thông tin…" : uncertain ? "Kiểm tra kết quả lưu" : "Lưu thay đổi"}</button>
    </div>
  </form>;
};
export default MemberProfileEditForm;
