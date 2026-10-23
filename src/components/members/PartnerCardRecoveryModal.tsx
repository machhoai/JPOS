"use client";
import { useEffect, useRef } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, Radio, X } from "lucide-react";
import { usePartnerCardRecovery } from "@/lib/hooks/usePartnerCardRecovery";
import { formatDateTime } from "@/lib/utils/dateFormat";
import type { PartnerCardRecoveryInput, PartnerCardRecoveryView } from "@/lib/types/partnerCardRecovery";

interface Props { shopId: number; warehouseId: string; initial?: { view: PartnerCardRecoveryView; input: PartnerCardRecoveryInput }; onClose: () => void; onOpenMember: (view: PartnerCardRecoveryView) => void }
export default function PartnerCardRecoveryModal({ shopId, warehouseId, initial, onClose, onOpenMember }: Props) {
  const c = usePartnerCardRecovery(shopId, warehouseId, initial), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  const complete = c.view?.state === "COMPLETED";
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!c.busy && !c.active && !complete) onClose(); }} aria-labelledby="partner-recovery-title" className="m-auto w-[min(94vw,620px)] max-h-[90vh] rounded-3xl border-0 bg-white p-0 text-[var(--color-text-primary)] shadow-2xl backdrop:bg-black/50">
    <div className="flex items-center justify-between border-b border-orange-100 bg-orange-50 px-6 py-4">
      <div className="flex items-center gap-3"><CreditCard className="size-6 text-orange-600"/><h2 id="partner-recovery-title" className="text-lg font-extrabold">Khôi phục thẻ đối tác</h2></div>
      {!complete && <button type="button" aria-label="Đóng" disabled={c.busy || c.active} onClick={onClose} className="rounded-xl p-3 hover:bg-orange-100 disabled:opacity-40"><X className="size-5"/></button>}
    </div>
    <div className="space-y-5 p-6">
      {!c.view && <p className="text-sm text-slate-600">Đặt thẻ đối tác lên đầu đọc để đối chiếu với danh sách 600 thẻ đã gỡ.</p>}
      {c.view && <>
        {complete && <div role="status" className="rounded-2xl bg-emerald-50 p-4 font-bold text-emerald-800"><CheckCircle2 className="mb-2 size-8"/>Khôi phục thẻ thành công. Thẻ đã được gắn lại và thành viên đã bật.</div>}
        <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
          {[['Thành viên',c.view.fullName],['Điện thoại',c.view.phone],['Mã thẻ',c.view.memberCode],['Trạng thái',complete?'Đã khôi phục':c.view.isEnabled===false?'Đang tắt':c.view.isEnabled===true?'Đang bật':'Đang đối chiếu']].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold">{value}</dd></div>)}
        </dl>
        <section aria-label="Lịch sử thẻ"><h3 className="mb-3 text-sm font-extrabold">Lịch sử thẻ</h3><ol className="space-y-3 border-l-2 border-orange-200 pl-4">{c.view.history.map((event,index)=><li key={`${event.at}-${index}`} className="text-sm"><p className="font-semibold">{event.label}</p><p className="text-xs text-slate-500">{formatDateTime(event.at)}</p></li>)}</ol></section>
        {!complete && c.view.canConfirm && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Xác nhận sẽ bật lại đúng thành viên và gắn lại thẻ này. Số dư hiện có được giữ nguyên.</p>}
      </>}
      {c.error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{c.error}</p>}
      {(c.busy || c.active) && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-orange-700"><LoaderCircle className="size-5 animate-spin"/>{c.active?'Đang khôi phục và đồng bộ thông tin...':'Đang đọc và xác minh thẻ...'}</p>}
      {complete && c.view ? <button type="button" onClick={()=>onOpenMember(c.view!)} className="min-h-13 w-full rounded-2xl bg-[var(--color-accent)] px-4 font-extrabold text-white">Mở hồ sơ thành viên</button> : <div className="flex gap-3">
        {!c.active && <button type="button" disabled={c.busy} onClick={()=>void c.read()} className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-orange-300 px-4 font-bold text-orange-700 disabled:opacity-50"><Radio className="size-5"/>{c.view?'Đọc lại thẻ':'Đọc thẻ'}</button>}
        {c.view?.canConfirm && <button type="button" disabled={c.busy || c.active} onClick={()=>void c.confirm()} className="min-h-13 flex-1 rounded-2xl bg-[var(--color-accent)] px-4 font-extrabold text-white disabled:opacity-50">Xác nhận khôi phục thẻ</button>}
      </div>}
    </div>
  </dialog>;
}
