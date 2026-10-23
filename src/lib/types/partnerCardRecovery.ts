export interface PartnerCardRecoveryView {
  id: string; memberCode: string; uid: string; phone: string; fullName: string;
  history: { label: string; at: string }[];
  state: "AVAILABLE" | "QUEUED" | "RUNNING" | "NEEDS_REVIEW" | "COMPLETED";
  error: string | null; completedAt: string | null;
  previewToken?: string; dynamicSerialNo?: string | null;
  isEnabled?: boolean; points?: number; canConfirm?: boolean;
}
export interface PartnerCardRecoveryInput {
  shopId: number; warehouseId: string; memberCode: string; cardUuid: string; previewToken?: string;
}
export interface PartnerCardRecoveryMatch { view: PartnerCardRecoveryView; input: PartnerCardRecoveryInput }
