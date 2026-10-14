"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {readMemberCard,cancelMemberCardRead} from "@/lib/services/cardReaderService";
import {previewMemberCardReturn,createMemberCardReturnJob,fetchMemberCardReturnJob,controlMemberCardReturnJob} from "@/lib/services/memberCardReturnService";
import {showPromise,showWarning,showError,showSuccess} from "@/lib/utils/toast";
import {useCardReturnStore} from "../store/useCardReturnStore";
export function useCardReturnController(shopId:number,warehouseId:string,userId:string,allowed:boolean){
  const state=useCardReturnStore();const [reading,setReading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const readingRef=useRef(false),generation=useRef(0),inflight=useRef(false),refreshing=useRef(false);const scopeKey=`${userId}:${shopId}:${warehouseId}`;
  const ready=state.scopeKey===scopeKey;const scope={shopId,warehouseId};
  useEffect(()=>{readingRef.current=false;generation.current++;setReading(false);useCardReturnStore.getState().bind(scopeKey);},[scopeKey]);
  const refresh=useCallback(async()=>{const current=useCardReturnStore.getState();if(current.scopeKey!==scopeKey||!current.jobId||refreshing.current)return;refreshing.current=true;
    try{const result=await fetchMemberCardReturnJob({shopId,warehouseId,jobId:current.jobId});if(useCardReturnStore.getState().scopeKey!==scopeKey)return;useCardReturnStore.getState().setJob(result.job);setError(null);}
    catch(err){console.error("[Gỡ thẻ] Không tải được lô:",err);if(useCardReturnStore.getState().scopeKey===scopeKey)setError(err instanceof Error?err.message:"Không tải được tiến độ.");}finally{refreshing.current=false;}
  },[shopId,warehouseId,scopeKey]);
  const jobStatus=state.job?.status;
  useEffect(()=>{if(!ready||!state.jobId||!allowed)return;void refresh();
    if(jobStatus&&!["QUEUED","RUNNING"].includes(jobStatus))return;
    const timer=setInterval(()=>void refresh(),4000);return()=>clearInterval(timer);
  },[ready,state.jobId,jobStatus,allowed,refresh]);
  const stop=useCallback(()=>{readingRef.current=false;generation.current++;setReading(false);void cancelMemberCardRead().catch(err=>console.error("[Gỡ thẻ] Không hủy được reader:",err));},[]);
  useEffect(()=>()=>{readingRef.current=false;generation.current++;void cancelMemberCardRead().catch(()=>{});},[scopeKey]);
  const start=async()=>{
    if(!allowed||!warehouseId||!ready||readingRef.current||state.submitted)return;
    readingRef.current=true;const attempt=++generation.current;setReading(true);setError(null);
    while(readingRef.current&&generation.current===attempt){
      try{const card=await readMemberCard(20_000);if(generation.current!==attempt)break;
        if(!card.memberCode||!card.cardUuid)throw Error("Đầu đọc chưa trả đủ mã thẻ và chip.");
        const prior=useCardReturnStore.getState().rows;
        if(prior.some(row=>row.memberCode===card.memberCode||row.cardUuid.toUpperCase()===card.cardUuid!.toUpperCase())){await new Promise(resolve=>setTimeout(resolve,600));continue;}
        if(prior.length>=100){stop();showWarning("Đã đủ 100 thẻ","Hãy xử lý lô này trước khi đọc thêm.");break;}
        const confirmed=await readMemberCard(20_000);if(generation.current!==attempt)break;
        if(card.memberCode!==confirmed.memberCode||card.cardUuid.toUpperCase()!==confirmed.cardUuid?.toUpperCase())throw Error("Thẻ đã đổi giữa hai lần đọc. Hãy giữ nguyên thẻ.");
        try{const result=await previewMemberCardReturn({...scope,memberCode:card.memberCode,cardUuid:card.cardUuid});if(generation.current!==attempt||useCardReturnStore.getState().scopeKey!==scopeKey)break;
          useCardReturnStore.getState().add({memberCode:card.memberCode,cardUuid:card.cardUuid.toUpperCase(),...result,error:null});}
        catch(err){if(generation.current!==attempt)break;useCardReturnStore.getState().add({memberCode:card.memberCode,cardUuid:card.cardUuid.toUpperCase(),owner:null,state:"INVALID",error:err instanceof Error?err.message:"Không xác minh được thẻ."});}
      }catch(err){if(generation.current!==attempt)break;console.error("[Gỡ thẻ] Không đọc được thẻ:",err);setError(err instanceof Error?err.message:"Không đọc được thẻ.");stop();break;}
    }
  };
  const submit=async function submitJob(){
    if(inflight.current||!allowed||!ready)return;stop();const current=useCardReturnStore.getState();const cards=current.rows.filter(row=>row.state==="READY").map(({memberCode,cardUuid,previewToken})=>({memberCode,cardUuid,previewToken}));
    if(!cards.length)return;if(!current.submitted&&!window.confirm(`Gỡ liên kết ${cards.length} thẻ đã chọn? Thành viên được giữ lại, không hoàn cọc.`))return;
    const id=current.freeze();inflight.current=true;setBusy(true);
    try{await showPromise(createMemberCardReturnJob({...scope,jobId:id,cards}),{loading:"Đang lưu lô gỡ thẻ...",success:"Đã tiếp nhận lô gỡ thẻ",error:"Chưa tiếp nhận được lô",successDescription:"Theo dõi kết quả từng thẻ ở danh sách.",errorDescription:(err:unknown)=>err instanceof Error?err.message:"Vui lòng thử lại.",onRetry:()=>void submitJob()});await refresh();}
    catch(err){console.error("[Gỡ thẻ] Không lưu được lô:",err);setError(err instanceof Error?err.message:"Không lưu được lô.");const code=String((err as {code?:string})?.code||"");if(/(invalid-argument|failed-precondition|permission-denied)$/.test(code))useCardReturnStore.setState({submitted:false,jobId:null});}finally{inflight.current=false;setBusy(false);}
  };
  const control=async(action:"PAUSE"|"RETRY")=>{if(inflight.current||!state.jobId)return;inflight.current=true;setBusy(true);try{await controlMemberCardReturnJob({...scope,jobId:state.jobId,action});await refresh();showSuccess(action==="PAUSE"?"Đã yêu cầu dừng lô":"Đã yêu cầu tiếp tục","Worker sẽ kiểm tra lại trạng thái HK trước khi xử lý.");}catch(err){console.error("[Gỡ thẻ] Không điều khiển được lô:",err);showError("Không thể cập nhật lô",err instanceof Error?err.message:"Vui lòng thử lại.");}finally{inflight.current=false;setBusy(false);}};
  return {rows:ready?state.rows:[],job:ready?state.job:null,submitted:ready&&state.submitted,reading,busy,error,active:reading||busy||(ready&&!!state.job&&["QUEUED","RUNNING"].includes(state.job.status)),start,stop,submit,control,refresh,
    remove:state.remove,reset:()=>{if(!reading&&!busy&&(!state.job||state.job.status==="COMPLETED"))state.reset();}};
}
