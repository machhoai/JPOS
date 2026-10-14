import type { CardReturnOwner } from "../services/memberCardReturnRemote";
export type CardReturnState = "READY" | "SENDING" | "UNKNOWN" | "HK_CONFIRMED" | "LOCAL_PENDING" | "COMPLETED" | "ALREADY_FREE" | "NEEDS_REVIEW";
export interface CardReturnItem {
  operationId: string; owner: CardReturnOwner; state: CardReturnState;
  attempts: number; lastError: string | null; knownRejected?: boolean; mutationSent?: boolean; completedAt?: string;
}
export interface CardReturnJob {
  jobId: string; shopId: number; warehouseId: string; createdBy: string; deviceId: string;
  requestHash: string;
  status: "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "NEEDS_REVIEW";
  items: CardReturnItem[]; lease: {token:string;expiresAt:number} | null;
  createdAt: string; updatedAt: string;
}
