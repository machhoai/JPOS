export interface MemberPhoneSuggestion {
  uid: string;
  phone: string;
  fullName: string;
  state: "READY" | "PENDING" | "NEEDS_REVIEW";
}
export interface MemberPhoneSearchInput { shopId: number; warehouseId: string; prefix: string }
