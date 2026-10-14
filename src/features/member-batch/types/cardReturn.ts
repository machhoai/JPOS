export interface CardReturnOwner {uid:string;mid:string;memberCode:string;cardUuid:string;memberCardId:string;fullName:string;phone:string;memberLevelType:number;shopId:number}
export type CardReturnState="READY"|"SENDING"|"UNKNOWN"|"HK_CONFIRMED"|"LOCAL_PENDING"|"COMPLETED"|"ALREADY_FREE"|"NEEDS_REVIEW";
export interface CardReturnRow {operationId:string;owner:CardReturnOwner;state:CardReturnState;attempts:number;lastError:string|null;completedAt?:string}
export interface CardReturnDraft {memberCode:string;cardUuid:string;previewToken?:string;owner:CardReturnOwner|null;state:"READY"|"ALREADY_FREE"|"INVALID";error:string|null}
export interface CardReturnJob {jobId:string;shopId:number;warehouseId:string;status:"QUEUED"|"RUNNING"|"PAUSED"|"COMPLETED"|"NEEDS_REVIEW";items:CardReturnRow[];updatedAt:string}
