export interface MemberPhoneSuggestion {
  uid: string;
  phone: string;
  fullName: string;
  state: "READY" | "PENDING" | "NEEDS_REVIEW";
  isEnabled?: boolean | null;
}
export interface MemberPhoneSearchInput { shopId: number; warehouseId: string; prefix: string }
