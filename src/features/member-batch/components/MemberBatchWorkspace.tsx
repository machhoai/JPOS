"use client";
import {useState} from "react";
import {LoaderCircle,UsersRound} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import StoreSelector from "@/components/pos/StoreSelector";
import {useAuth} from "@/lib/contexts/AuthContext";
import {useMemberBatchStore} from "../store/useMemberBatchStore";
import MemberBatchCreateWorkspace from "./MemberBatchCreateWorkspace";
import MemberCardReturnWorkspace from "./MemberCardReturnWorkspace";
export default function MemberBatchWorkspace(){
  const auth=useAuth();const [mode,setMode]=useState<"ISSUE"|"RETURN">("ISSUE"),[returnBusy,setReturnBusy]=useState(false);
  const issueStatus=useMemberBatchStore(state=>state.job?.status);
  const busy=returnBusy||issueStatus==="RUNNING"||issueStatus==="PAUSE_REQUESTED";
  if(auth.isLoading||!auth.user||!auth.userDoc)return <div className="flex h-screen items-center justify-center"><LoaderCircle className="size-8 animate-spin text-[var(--color-accent)]"/></div>;
  if(auth.needsWarehouseSelection)return <StoreSelector userName={auth.userDoc.full_name||"Nhân viên"} warehouses={auth.availableWarehouses} onSelectWarehouse={auth.selectWarehouse} onLogout={auth.logout}/>;
  const warehouseId=auth.effectiveWarehouseId||"";const shopId=Number(process.env.NEXT_PUBLIC_SHOP_ID)||1;
  return <div className="flex h-screen bg-[var(--color-background)]"><Sidebar onLogout={auth.logout}/><main className="flex min-w-0 flex-1 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-3"><div className="flex items-center gap-3"><UsersRound className="size-7 text-[var(--color-accent)]"/><div><h1 className="text-xl font-extrabold">Thẻ thành viên hàng loạt</h1><p className="text-xs font-semibold text-slate-500">{auth.effectiveWarehouseName||warehouseId}</p></div></div>
      <nav aria-label="Chế độ xử lý thẻ" className="flex rounded-2xl bg-slate-100 p-1">{([{value:"ISSUE",label:"Tạo / cấp thẻ"},{value:"RETURN",label:"Gỡ liên kết thẻ"}] as const).map(tab=><button type="button" key={tab.value} disabled={busy&&mode!==tab.value} aria-pressed={mode===tab.value} onClick={()=>setMode(tab.value)} className={`min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${mode===tab.value?"bg-[var(--color-accent)] text-white":"text-slate-600"}`}>{tab.label}</button>)}</nav>
    </header><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-[1500px]">
      {mode==="ISSUE"?<MemberBatchCreateWorkspace/>:<MemberCardReturnWorkspace shopId={shopId} warehouseId={warehouseId} userId={auth.user.uid} allowed={auth.hasPermission("pos.members.return_card",warehouseId)} onBusyChange={setReturnBusy}/>}
    </div></div>
  </main></div>;
}
