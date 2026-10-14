"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DateInput from "@/components/ui/DateInput";
import type { MemberProfile } from "@/lib/types/member";
import { fetchMemberRenewalBatches, renewalCategories, renewMemberStoredValue, type MemberRenewalBatch, type MemberRenewalInput } from "@/lib/services/memberRenewalService";
import { toMemberServiceError } from "@/lib/services/memberService";
import { formatDate } from "@/lib/utils/dateFormat";
import { showSuccess, showWarning } from "@/lib/utils/toast";

interface Props {
  member: MemberProfile;
  shopId: number;
  warehouseId: string;
  onBusyChange: (busy: boolean) => void;
  onSucceeded: () => Promise<void>;
}
const today = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const inputClass = "w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-3 text-sm disabled:opacity-50";

const MemberRenewalPanel: React.FC<Props> = ({ member, shopId, warehouseId, onBusyChange, onSucceeded }) => {
  const [category, setCategory] = useState(101);
  const [availableCategories, setAvailableCategories] = useState<number[] | null>(null);
  const [batches, setBatches] = useState<MemberRenewalBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [range, setRange] = useState({ startDate: "", endDate: "" });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalRecords, setTotalRecords] = useState<number | null>(null);
  const [selected, setSelected] = useState<MemberRenewalBatch | null>(null);
  const [delayDate, setDelayDate] = useState("");
  const [remark, setRemark] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<MemberRenewalInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const submitting = useRef(false);
  const scope = { uid: member.uid, shopId, warehouseId, category };
  const load = useCallback(async (requestedPage = 1) => {
    const version = ++requestVersion.current;
    setLoading(true); setError(null);
    try {
      const result = await fetchMemberRenewalBatches({ uid: member.uid, shopId, warehouseId, category, ...range, page: requestedPage });
      if (version === requestVersion.current) {
        setBatches(result.batches); setLoaded(true);
        // Older deployed Functions omit pagination fields. TypeScript types do
        // not validate callable responses at runtime, so normalize them here.
        setPage(typeof result.page === "number" && Number.isInteger(result.page) && result.page > 0 ? result.page : requestedPage);
        setHasMore(result.hasMore === true);
        setTotalRecords(typeof result.totalRecords === "number" && Number.isInteger(result.totalRecords) && result.totalRecords >= 0 ? result.totalRecords : null);
        setAvailableCategories(result.categories);
        if (!result.categories.includes(category) && result.categories.length > 0 && !result.pending) setCategory(result.categories[0]);
        if (result.pending) {
          setPending(result.pending.input); setSelected(result.pending.batch);
          setDelayDate(result.pending.input.delayDate); setRemark(result.pending.input.remark); setConfirming(true);
        }
      }
    } catch (error) {
      if (version === requestVersion.current) { setError(toMemberServiceError(error).message); setLoaded(false); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [member.uid, shopId, warehouseId, category, range]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; requestVersion.current += 1; };
  }, [load]);

  const submit = async () => {
    if (submitting.current || !selected) return;
    const input = pending ?? { ...scope, operationId: crypto.randomUUID(), delayId: selected.id, delayDate, remark: remark.trim(), originalExpiryDate: selected.expiresAt.slice(0, 10) };
    submitting.current = true; setBusy(true); onBusyChange(true); setError(null); setPending(input);
    try {
      await renewMemberStoredValue(input);
    } catch (error) {
      const parsed = toMemberServiceError(error);
      setError(parsed.message);
      if (["failed-precondition", "invalid-argument", "permission-denied"].some(code => parsed.code.endsWith(code))) {
        setPending(null); setConfirming(false);
      }
      // Keep the exact request (including biz code) for reconciliation/replay.
      submitting.current = false; setBusy(false); onBusyChange(false);
      return;
    }
    setPending(null); setSelected(null); setConfirming(false); setRemark("");
    showSuccess("Gia hạn giá trị lưu trữ thành công", `Hạn sử dụng mới: ${formatDate(input.delayDate)}.`);
    await load();
    try { await onSucceeded(); }
    catch (error) { showWarning("Đã gia hạn nhưng chưa tải lại được số dư", toMemberServiceError(error).message); }
    submitting.current = false; setBusy(false); onBusyChange(false);
  };
  const currentExpiry = selected?.expiresAt.slice(0, 10) ?? "";
  const valid = Boolean(selected && delayDate >= today() && delayDate > currentExpiry && remark.trim().length >= 5 && remark.trim().length <= 500);
  const label = renewalCategories.find(item => item.value === category)?.label;

  return <section className="space-y-4 rounded-3xl border border-[var(--color-border)] bg-white p-4 sm:p-5" aria-label="Gia hạn giá trị lưu trữ">
    <div>
      <h2 className="text-lg font-extrabold">Gia hạn giá trị lưu trữ</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Khôi phục hiệu lực giá trị còn lại của gói đã hết hạn bằng cách đặt hạn sử dụng mới.</p>
      <p className="mt-2 font-semibold">{member.fullName || "Khách thành viên"} · {member.phone || member.memberCode}</p>
    </div>
    <div className="space-y-3">
      <fieldset disabled={busy || Boolean(pending)}>
        <legend className="mb-2 text-sm font-bold">Loại giá trị</legend>
        {availableCategories?.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">Không có tài khoản lưu trữ</p> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {renewalCategories.filter(item => !availableCategories || availableCategories.includes(item.value)).map(item => <button
            key={item.value} type="button" aria-pressed={category === item.value}
            onClick={() => {
              if (category === item.value) return;
              requestVersion.current += 1; setCategory(item.value); setBatches([]); setLoaded(false); setSelected(null); setConfirming(false); setError(null);
            }}
            className={`min-h-14 touch-manipulation rounded-xl border px-3 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50 ${category === item.value ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-white text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"}`}
          >{item.label}</button>)}
        </div>}
      </fieldset>
      <div className="flex justify-end"><button type="button" disabled={loading || busy} onClick={() => void load(page)} className="min-h-12 rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm font-bold disabled:opacity-50">{loading ? "Đang tải…" : "Tải lại"}</button></div>
    </div>
    <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      if (busy || pending || (startDate && endDate && startDate > endDate)) return;
      setSelected(null); setConfirming(false); setRange({ startDate, endDate });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="member-renewal-from" className="mb-1 block text-sm font-bold">Hết hạn từ ngày</label>
          <DateInput id="member-renewal-from" value={startDate} onValueChange={setStartDate} min="2000-01-01" max="2100-12-31" disabled={busy || Boolean(pending)} className={inputClass} />
        </div>
        <div><label htmlFor="member-renewal-to" className="mb-1 block text-sm font-bold">Hết hạn đến ngày</label>
          <DateInput id="member-renewal-to" value={endDate} onValueChange={setEndDate} min="2000-01-01" max="2100-12-31" disabled={busy || Boolean(pending)} className={inputClass} />
        </div>
      </div>
      {startDate && endDate && startDate > endDate && <p role="alert" className="text-sm text-red-700">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={loading || busy || Boolean(pending) || Boolean(startDate && endDate && startDate > endDate)} className="rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Tìm kiếm</button>
        <button type="button" disabled={loading || busy || Boolean(pending)} onClick={() => { setStartDate(""); setEndDate(""); setSelected(null); setConfirming(false); setRange({ startDate: "", endDate: "" }); }} className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm font-bold disabled:opacity-50">Xóa bộ lọc</button>
      </div>
    </form>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div aria-busy={loading} className="space-y-2">
      {loading && <p role="status" className="py-4 text-sm">Đang tải các khoản giá trị…</p>}
      {!loading && loaded && batches.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm">Không có khoản giá trị thuộc loại này để gia hạn.</p>}
      {!loading && loaded && batches.map(batch => {
        const eligible = batch.shopId === shopId && !batch.permanent && batch.amount > 0;
        return <button key={batch.id} type="button" disabled={!eligible || busy || Boolean(pending)} aria-pressed={selected?.id === batch.id}
          onClick={() => { setSelected(batch); setDelayDate(""); setRemark(""); setConfirming(false); setError(null); }}
          className={`w-full rounded-2xl border p-3 text-left disabled:opacity-50 ${selected?.id === batch.id ? "border-orange-400 bg-orange-50" : "border-[var(--color-border)]"}`}>
          <span className="flex flex-wrap justify-between gap-2"><span className="font-bold">{batch.amount.toLocaleString("vi-VN")} {label?.toLowerCase()}</span><span className={`text-sm font-semibold ${batch.expired ? "text-red-600" : "text-green-700"}`}>{batch.permanent ? "Không giới hạn" : batch.expired ? "Đã hết hạn" : "Còn hiệu lực"}</span></span>
          <span className="mt-1 block text-sm">Hạn sử dụng: {batch.permanent ? "Không giới hạn" : formatDate(batch.expiresAt.slice(0, 10))} · {batch.shopName || `Cửa hàng ${batch.shopId}`}</span>
          {batch.remark && <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{batch.remark}</span>}
          {!eligible && <span className="mt-1 block text-xs">{batch.shopId !== shopId ? "Thuộc cửa hàng khác" : batch.permanent ? "Không cần gia hạn" : "Không còn giá trị để gia hạn"}</span>}
        </button>;
      })}
    </div>
    {loaded && <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p>Trang {page}{typeof totalRecords === "number" ? ` · ${totalRecords.toLocaleString("vi-VN")} khoản giá trị` : ""}</p>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1 || loading || busy || Boolean(pending)} onClick={() => { setSelected(null); setConfirming(false); void load(page - 1); }} className="rounded-xl border px-3 py-2 disabled:opacity-50">Trang trước</button>
        <button type="button" disabled={!hasMore || loading || busy || Boolean(pending)} onClick={() => { setSelected(null); setConfirming(false); void load(page + 1); }} className="rounded-xl border px-3 py-2 disabled:opacity-50">Trang sau</button>
      </div>
    </div>}
    {selected && <form className="space-y-3 border-t border-[var(--color-border)] pt-4" onSubmit={event => { event.preventDefault(); if (pending || confirming) void submit(); else if (valid) setConfirming(true); }}>
      <label className="block text-sm font-bold" htmlFor="member-renewal-date">Hạn sử dụng mới</label>
      <DateInput id="member-renewal-date" value={delayDate} min={today()} max="2100-12-31" onValueChange={value => { setDelayDate(value); setConfirming(false); }} required disabled={busy || Boolean(pending)} className={inputClass} />
      <label className="block text-sm font-bold" htmlFor="member-renewal-remark">Lý do gia hạn</label>
      <textarea id="member-renewal-remark" value={remark} onChange={event => { setRemark(event.target.value); setConfirming(false); }} minLength={5} maxLength={500} required disabled={busy || Boolean(pending)} className={inputClass} rows={2} />
      {delayDate && delayDate <= currentExpiry && <p role="alert" className="text-sm text-red-700">Hạn mới phải sau {formatDate(currentExpiry)}.</p>}
      {(confirming || pending) && <div className="rounded-xl bg-orange-50 p-3 text-sm">
        <p className="font-bold">{pending ? "Kiểm tra kết quả gia hạn" : "Xác nhận gia hạn"}</p>
        <p className="mt-1">{selected.amount.toLocaleString("vi-VN")} {label?.toLowerCase()} · từ {formatDate(currentExpiry)} đến {formatDate(delayDate)}.</p>
        {pending && <p className="mt-1">Yêu cầu đang giữ nguyên mã thao tác. Bấm kiểm tra kết quả để đối chiếu trên HK.</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || loading || (!pending && !valid)} className="rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Đang xử lý…" : pending ? "Kiểm tra kết quả / thử lại" : confirming ? "Xác nhận gia hạn" : "Tiếp tục"}</button>
        {confirming && !pending && <button type="button" disabled={busy} className="rounded-xl border px-4 py-3 text-sm" onClick={() => setConfirming(false)}>Quay lại</button>}
      </div>
    </form>}
  </section>;
};

export default MemberRenewalPanel;
