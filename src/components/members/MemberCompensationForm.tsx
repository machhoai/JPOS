import { AlertTriangle, Banknote, LoaderCircle, Repeat2, WalletCards } from "lucide-react";
import type { MemberCompensationDraft, MemberMutationState } from "@/lib/types/member";

interface MemberCompensationFormProps {
  draft: MemberCompensationDraft;
  mutation: MemberMutationState;
  onChange: (values: Partial<MemberCompensationDraft>) => void;
  onReview: () => void;
}

const COMPENSATION_REASON_PRESETS = [
  "Sửa lỗi thiết bị đọc hoặc ghi thẻ",
  "Thẻ không ghi nhận đúng số dư",
  "Khôi phục số dư sau khi cấp đổi thẻ",
  "Bù giao dịch bị gián đoạn giữa chừng",
  "Thu hồi số dư đã nạp thừa",
  "Điều chỉnh sai lệch sau khi đối soát",
] as const;

const COMPENSATION_CATEGORIES = [
  { value: 1, label: "Tiền", description: "Điều chỉnh số dư VND", icon: Banknote },
  { value: 6, label: "Lượt", description: "Điều chỉnh số lượt chơi", icon: Repeat2 },
] as const;

const TURN_QUICK_AMOUNTS = [-5, -1, 1, 5, 12] as const;
const MONEY_QUICK_AMOUNTS = [-22, -77, 22, 77] as const;
const amountFormatter = new Intl.NumberFormat("vi-VN");

export default function MemberCompensationForm({
  draft,
  mutation,
  onChange,
  onReview,
}: MemberCompensationFormProps) {
  const busy = mutation.kind === "COMPENSATION_TOP_UP" &&
    mutation.status === "WAITING_API";
  const failed = mutation.kind === "COMPENSATION_TOP_UP" &&
    mutation.status === "FAILED";
  const selectedPreset = COMPENSATION_REASON_PRESETS.find(
    (reason) => reason === draft.reason,
  ) ?? "";
  const isMoney = draft.storedCategory === 1;
  const categoryUnit = isMoney ? "tiền" : "lượt";
  const quickAmounts = isMoney ? MONEY_QUICK_AMOUNTS : TURN_QUICK_AMOUNTS;

  return (
    <section className="rounded-3xl border border-amber-200 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><WalletCards className="size-6" /></span>
        <div><h2 className="text-lg font-extrabold">Nạp bù / trừ số dư thẻ</h2><p className="text-xs text-[var(--color-text-muted)]">Chọn cột cần điều chỉnh, sau đó nhập hoặc chọn nhanh số lượng.</p></div>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); onReview(); }} className="space-y-4">
        <fieldset disabled={busy}>
          <legend className="text-sm font-bold">Cột số dư nạp bù *</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cột số dư nạp bù">
            {COMPENSATION_CATEGORIES.map(({ value, label, description, icon: Icon }) => {
              const selected = draft.storedCategory === value;
              return <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => onChange({ storedCategory: value })} className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 text-left transition-colors disabled:opacity-50 ${selected ? "border-amber-600 bg-amber-50 text-amber-900 shadow-sm" : "border-[var(--color-border-subtle)] bg-white text-[var(--color-text-secondary)] hover:border-amber-300"}`}>
                <Icon className="size-5 shrink-0" />
                <span><span className="block text-sm font-extrabold">{label}</span><span className="block text-xs font-semibold opacity-75">{description}</span></span>
              </button>;
            })}
          </div>
        </fieldset>
        <div>
          <label htmlFor="member-compensation-amount" className="block text-sm font-bold">{isMoney ? "Số tiền" : "Số lượt"} điều chỉnh *</label>
          <input id="member-compensation-amount" type="number" inputMode="numeric" min={-10_000_000} max={10_000_000} step={1} value={draft.amount ?? ""} onChange={(event) => onChange({ amount: event.target.value === "" ? null : Number(event.target.value) })} disabled={busy} className="mt-1.5 h-13 w-full rounded-2xl border border-[var(--color-border-subtle)] px-4 text-lg font-extrabold focus:border-[var(--color-accent)] disabled:bg-neutral-50" placeholder={isMoney ? "Nhập số tiền VND; số âm để trừ" : "Số dương để cộng, số âm để trừ"} />
          <div className={`mt-2 grid gap-2 ${isMoney ? "grid-cols-4" : "grid-cols-5"}`} aria-label="Chọn nhanh số lượng điều chỉnh">
            {quickAmounts.map((amount) => {
              const selected = !isMoney && draft.amount === amount;
              return <button key={amount} type="button" aria-pressed={isMoney ? undefined : selected} onClick={() => onChange({ amount: isMoney ? (draft.amount ?? 0) + amount : amount })} disabled={busy} className={`min-h-11 rounded-xl border text-sm font-extrabold transition-colors disabled:opacity-50 ${selected ? "border-amber-600 bg-amber-600 text-white shadow-sm" : amount < 0 ? "border-red-200 bg-red-50 text-red-700 hover:border-red-400" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400"}`}>{amount > 0 ? "+" : ""}{amountFormatter.format(amount)}</button>;
            })}
          </div>
          {isMoney ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">Mỗi lần bấm sẽ cộng hoặc trừ thêm vào số tiền điều chỉnh hiện tại.</p> : null}
        </div>
        <label className="block text-sm font-bold">Chọn nhanh lý do
          <select value={selectedPreset} onChange={(event) => onChange({ reason: event.target.value })} disabled={busy} className="mt-1.5 h-13 w-full rounded-2xl border border-[var(--color-border-subtle)] bg-white px-4 text-sm font-semibold focus:border-[var(--color-accent)] disabled:bg-neutral-50">
            <option value="">Chọn một lý do có sẵn</option>
            {COMPENSATION_REASON_PRESETS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
        </label>
        <label className="block text-sm font-bold">Lý do điều chỉnh *
          <textarea value={draft.reason} onChange={(event) => onChange({ reason: event.target.value })} disabled={busy} minLength={5} maxLength={500} rows={4} className="mt-1.5 w-full resize-none rounded-2xl border border-[var(--color-border-subtle)] px-4 py-3 text-sm font-semibold focus:border-[var(--color-accent)] disabled:bg-neutral-50" placeholder="Mô tả lỗi thẻ, chứng từ hoặc lý do đã xác minh..." />
        </label>
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-5 shrink-0" /><p>Thao tác này làm thay đổi trực tiếp cột {isMoney ? "Tiền" : "Lượt"} của khách và được ghi vĩnh viễn vào nhật ký kiểm toán.</p></div>
        {failed ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{mutation.failureReason}</p> : null}
        <button type="submit" disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-amber-600 px-5 font-extrabold text-white shadow-sm active:scale-[0.98] disabled:opacity-50">{busy ? <LoaderCircle className="size-5 animate-spin" /> : <WalletCards className="size-5" />}{busy ? "Đang xử lý" : draft.amount && draft.amount < 0 ? `Kiểm tra trừ ${categoryUnit}` : `Kiểm tra cộng ${categoryUnit}`}</button>
      </form>
    </section>
  );
}
