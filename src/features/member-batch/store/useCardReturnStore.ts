import {create} from "zustand";
import {persist,createJSONStorage} from "zustand/middleware";
import type {CardReturnDraft,CardReturnJob} from "../types/cardReturn";
interface State {scopeKey:string;rows:CardReturnDraft[];jobId:string|null;job:CardReturnJob|null;submitted:boolean;
  bind:(key:string)=>void;add:(row:CardReturnDraft)=>void;remove:(code:string)=>void;freeze:()=>string;setJob:(job:CardReturnJob)=>void;reset:()=>void;}
export const useCardReturnStore=create<State>()(persist((set,get)=>({scopeKey:"",rows:[],jobId:null,job:null,submitted:false,
  bind:scopeKey=>{if(get().scopeKey!==scopeKey)set({scopeKey,rows:[],jobId:null,job:null,submitted:false});},
  add:row=>{if(get().submitted)return;const rows=get().rows;if(rows.some(r=>r.memberCode===row.memberCode||r.cardUuid===row.cardUuid))return;set({rows:[...rows,row],jobId:null});},
  remove:code=>{if(!get().submitted)set({rows:get().rows.filter(r=>r.memberCode!==code),jobId:null});},
  freeze:()=>{const id=get().jobId||crypto.randomUUID();set({jobId:id,submitted:true});return id;},
  setJob:job=>set({job,jobId:job.jobId,submitted:true}),reset:()=>set({rows:[],jobId:null,job:null,submitted:false}),
}),{name:"jpos-member-card-return",storage:createJSONStorage(()=>localStorage),partialize:state=>({scopeKey:state.scopeKey,rows:state.rows,jobId:state.jobId,job:state.job,submitted:state.submitted})}));
