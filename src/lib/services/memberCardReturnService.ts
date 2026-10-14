import {httpsCallable} from "firebase/functions";
import {functions} from "@/lib/firebase/client";
import {withDeviceAuth} from "./deviceEnrollmentService";
import {toMemberServiceError} from "./memberService";
import type {CardReturnOwner,CardReturnJob} from "@/features/member-batch/types/cardReturn";
interface Scope {shopId:number;warehouseId:string}
async function call<T>(action:string,payload:object):Promise<T>{try{const fn=httpsCallable<unknown,T>(functions,"getPosAuthSession");return (await fn(await withDeviceAuth({action,payload}))).data;}catch(error){throw toMemberServiceError(error);}}
export function previewMemberCardReturn(input:Scope&{memberCode:string;cardUuid:string}){return call<{owner:CardReturnOwner|null;state:"READY"|"ALREADY_FREE";previewToken?:string}>("previewMemberCardReturn",input);}
export function createMemberCardReturnJob(input:Scope&{jobId:string;cards:{memberCode:string;cardUuid:string;previewToken?:string}[]}){return call<{jobId:string}>("createMemberCardReturnJob",input);}
export function fetchMemberCardReturnJob(input:Scope&{jobId:string}){return call<{job:CardReturnJob}>("fetchMemberCardReturnJob",input);}
export function controlMemberCardReturnJob(input:Scope&{jobId:string;action:"PAUSE"|"RETRY"}){return call<{jobId:string}>("controlMemberCardReturnJob",input);}
