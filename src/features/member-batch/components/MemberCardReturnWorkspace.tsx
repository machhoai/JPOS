"use client";
import {useEffect} from "react";
import {LoaderCircle,Radio,Trash2,Pause,RefreshCw,Unlink,Download} from "lucide-react";
import {useCardReturnController} from "../hooks/useCardReturnController";
import {formatDateTime} from "@/lib/utils/dateFormat";
import type {CardReturnState} from "../types/cardReturn";
const labels:Record<CardReturnState,string>={READY:"Sẵn sàng",SENDING:"Đang gỡ trên HK",UNKNOWN:"Đang đối chiếu",HK_CONFIRMED:"HK đã gỡ",LOCAL_PENDING:"Chờ lưu POS",COMPLETED:"Đã gỡ, có thể dùng lại",ALREADY_FREE:"Thẻ đã rảnh",NEEDS_REVIEW:"Cần kiểm tra"};
interface Props {shopId:number;warehouseId:string;userId:string;allowed:boolean;onBusyChange:(busy:boolean)=>void}
export default function MemberCardReturnWorkspace({shopId,warehouseId,userId,allowed,onBusyChange}:Props){
  const c=useCardReturnController(shopId,warehouseId,userId,allowed);
  useEffect(()=>{onBusyChange(c.active);return()=>onBusyChange(false);},[c.active,onBusyChange]);
  const rows=c.job?.items.map(item=>({memberCode:item.owner.memberCode,fullName:item.owner.fullName,phone:item.owner.phone,state:item.state,error:item.lastError,completedAt:item.completedAt}))??c.rows.map(item=>({memberCode:item.memberCode,fullName:item.owner?.fullName||"—",phone:item.owner?.phone||"—",state:item.state,error:item.error,completedAt:undefined}));
  const ready=c.rows.filter(row=>row.state==="READY").length;
  const exportResult=()=>{const escape=(v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;const csv=[["Mã thẻ","Thành viên","Điện thoại","Trạng thái","Chi tiết"],...rows.map(row=>[row.memberCode,row.fullName,row.phone,row.state==="INVALID"?"Không hợp lệ":labels[row.state],row.error||formatDateTime(row.completedAt)])].map(line=>line.map(escape).join(",")).join("\r\n");const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="ket-qua-go-lien-ket-the.csv";a.click();URL.revokeObjectURL(url);};
  return <section className="space-y-4">
    <div className="rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-extrabold">Đọc danh sách thẻ cần gỡ liên kết</h2>
      <p className="mt-2 text-sm text-slate-600">Đặt từng thẻ lên đầu đọc, giữ nguyên để xác minh rồi nhấc thẻ và đặt thẻ tiếp theo. Chỉ thẻ thành viên thông thường được xử lý; không hoàn cọc.</p>
      {!allowed&&<p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Bạn chưa có quyền gỡ liên kết thẻ tại điểm bán này.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!c.reading?<button type="button" disabled={!allowed||c.submitted||c.busy} onClick={()=>void c.start()} className="flex min-h-12 items-center gap-2 rounded-2xl bg-[var(--color-accent)] px-5 font-bold text-white disabled:opacity-50"><Radio className="size-5"/>Bắt đầu đọc thẻ</button>:<button type="button" onClick={c.stop} className="flex min-h-12 items-center gap-2 rounded-2xl bg-slate-800 px-5 font-bold text-white"><Pause className="size-5"/>Dừng đọc</button>}
        {c.reading&&<span className="flex items-center gap-2 text-sm font-semibold text-orange-700"><LoaderCircle className="size-4 animate-spin"/>Đang chờ thẻ mới...</span>}
        {!c.job&&<button type="button" disabled={!allowed||!ready||c.busy} onClick={()=>void c.submit()} className="flex min-h-12 items-center gap-2 rounded-2xl bg-red-600 px-5 font-bold text-white disabled:opacity-50">{c.busy?<LoaderCircle className="size-5 animate-spin"/>:<Unlink className="size-5"/>}{c.submitted?"Thử lại tiếp nhận lô":"Gỡ liên kết thành viên với thẻ"} ({ready})</button>}
        {c.job&&["QUEUED","RUNNING"].includes(c.job.status)&&<button type="button" disabled={c.busy} onClick={()=>void c.control("PAUSE")} className="min-h-12 rounded-2xl border px-4 font-bold">Dừng lô tại điểm an toàn</button>}
        {c.job&&["PAUSED","NEEDS_REVIEW"].includes(c.job.status)&&<button type="button" disabled={c.busy||!allowed} onClick={()=>void c.control("RETRY")} className="flex min-h-12 items-center gap-2 rounded-2xl border px-4 font-bold"><RefreshCw className="size-4"/>Kiểm tra lại và tiếp tục</button>}
        <button type="button" disabled={!rows.length} onClick={exportResult} className="flex min-h-12 items-center gap-2 rounded-2xl border px-4 font-bold disabled:opacity-50"><Download className="size-4"/>Xuất kết quả</button>
        {(!c.job||c.job.status==="COMPLETED")&&<button type="button" disabled={c.active} onClick={c.reset} className="min-h-12 rounded-2xl border px-4 font-bold disabled:opacity-50">Lô mới</button>}
      </div>
      {c.error&&<div className="mt-3 text-sm font-semibold text-red-700" role="alert">{c.error}<button type="button" onClick={()=>void c.refresh()} className="ml-3 underline">Tải lại tiến độ</button></div>}
      {c.job&&<p className="mt-3 text-sm font-semibold text-slate-600" aria-live="polite">Đã hoàn tất {c.job.items.filter(item=>item.state==="COMPLETED").length}/{c.job.items.length} thẻ. Cập nhật: {formatDateTime(c.job.updatedAt)}.</p>}
    </div>
    <div className="overflow-x-auto rounded-3xl border border-[var(--color-border)] bg-white shadow-sm"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-4">Mã thẻ</th><th>Thành viên</th><th>Điện thoại</th><th>Trạng thái</th><th>Chi tiết</th><th/></tr></thead><tbody>
      {rows.map(row=><tr key={row.memberCode} className="border-t border-slate-100"><td className="p-4 font-mono font-bold">{row.memberCode}</td><td>{row.fullName}</td><td>{row.phone}</td><td className={`font-semibold ${row.state==="COMPLETED"||row.state==="ALREADY_FREE"?"text-emerald-700":"text-orange-700"}`}>{row.state==="INVALID"?"Không hợp lệ":labels[row.state]}</td><td className="max-w-xs p-3 text-xs text-slate-600">{row.error||formatDateTime(row.completedAt)}</td><td>{!c.submitted&&<button type="button" aria-label={`Bỏ thẻ ${row.memberCode}`} onClick={()=>c.remove(row.memberCode)} className="p-3 text-red-600"><Trash2 className="size-4"/></button>}</td></tr>)}
      {!rows.length&&<tr><td colSpan={6} className="p-8 text-center text-slate-500">Chưa có thẻ. Bấm bắt đầu đọc và đặt thẻ lên đầu đọc.</td></tr>}
    </tbody></table></div>
  </section>;
}
