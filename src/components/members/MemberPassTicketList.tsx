import { formatDateTime } from "@/lib/utils/dateFormat";
import { LoaderCircle, RefreshCw, TicketCheck } from "lucide-react";
import type { MemberPassTicket, RemoteRequestStatus } from "@/lib/types/member";

const numberFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

const categoryLabel = (category: number): string =>
  ({ 1: "Vé theo lượt", 2: "Vé giới hạn thời gian", 3: "Vé tính giờ" })[category] || "Vé thành viên";

interface MemberPassTicketListProps {
  status: RemoteRequestStatus;
  tickets: MemberPassTicket[];
  error: string | null;
  onReload: () => void;
}

const MemberPassTicketList: React.FC<MemberPassTicketListProps> = ({ status, tickets, error, onReload }) => {
  const loading = status === "WAITING_API";
  return <section className="min-h-72 rounded-3xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
    <header className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-extrabold">Vé và gói đã mua</h3><p className="text-xs text-[var(--color-text-muted)]">Số lượng mua, còn lại và thời hạn từ OpenAPI.</p></div><button type="button" onClick={onReload} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 text-sm font-bold disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Làm mới</button></header>
    {loading ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm font-bold text-[var(--color-text-muted)]"><LoaderCircle className="size-6 animate-spin text-[var(--color-accent)]" />Đang tải vé và gói...</div> : null}
    {!loading && status === "FAILED" ? <div className="flex min-h-56 flex-col items-center justify-center text-center"><p className="font-extrabold text-red-700">Không thể tải vé và gói</p><p className="mt-2 max-w-md text-sm text-red-600">{error}</p><button type="button" onClick={onReload} className="mt-4 min-h-11 rounded-xl bg-red-700 px-4 text-sm font-bold text-white">Thử lại</button></div> : null}
    {!loading && status !== "FAILED" && tickets.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center text-center"><TicketCheck className="size-10 text-orange-300" /><p className="mt-3 font-extrabold">Chưa có vé hoặc gói khả dụng</p></div> : null}
    {!loading && status !== "FAILED" && tickets.length > 0 ? <div className="grid gap-3 xl:grid-cols-2">{tickets.map((ticket) => <article key={ticket.passticketId} className="rounded-2xl border border-[var(--color-border)] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-extrabold">{ticket.name}</p><p className="mt-1 text-xs font-bold text-[var(--color-accent)]">{categoryLabel(ticket.category)}</p></div><span className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">Còn {numberFormatter.format(ticket.enabledAmount)}/{numberFormatter.format(ticket.buyAmount)}</span></div><dl className="mt-4 grid gap-2 text-xs text-[var(--color-text-muted)]"><div className="flex justify-between gap-3"><dt>Ngày mua</dt><dd className="font-bold text-[var(--color-text-secondary)]">{formatDateTime(ticket.buyTime) || "Chưa có"}</dd></div><div className="flex justify-between gap-3"><dt>Hiệu lực</dt><dd className="text-right font-bold text-[var(--color-text-secondary)]">{formatDateTime(ticket.startTime) || "—"} → {formatDateTime(ticket.endTime) || "—"}</dd></div></dl></article>)}</div> : null}
  </section>;
};

export default MemberPassTicketList;
