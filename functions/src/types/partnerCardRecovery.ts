export interface PartnerCardRecovery {
  schemaVersion: 1; shopId: number; memberCode: string; cardUuid: string;
  uid: string; mid: string; phone: string; fullName: string; creationWarehouseId: string;
  history: { label: string; at: string }[];
  state: "AVAILABLE" | "QUEUED" | "RUNNING" | "NEEDS_REVIEW" | "COMPLETED";
  requestedBy?: string; warehouseId?: string; deviceId?: string;
  lease?: { token: string; expiresAt: number } | null;
  requests?: Record<string, { hash: string; state: "SENDING" | "DONE"; response?: Record<string, unknown> }>;
  error?: string | null; completedAt?: string; updatedAt?: string;
  balanceBefore?: Record<string, unknown>; enableSent?: boolean;
}
export interface PartnerCardRecoveryView {
  id: string; memberCode: string; uid: string; phone: string; fullName: string;
  history: { label: string; at: string }[]; state: PartnerCardRecovery["state"];
  error: string | null; completedAt: string | null;
  previewToken?: string; dynamicSerialNo?: string | null;
  isEnabled?: boolean; points?: number; canConfirm?: boolean;
}
