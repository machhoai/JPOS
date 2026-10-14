import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import { toMemberServiceError, type MemberRegistrationResult } from "@/lib/services/memberService";
import type { MemberPhoneSearchInput, MemberPhoneSuggestion } from "@/lib/types/memberPhoneSearch";
export async function fetchMemberPhoneSuggestions(input: MemberPhoneSearchInput): Promise<MemberPhoneSuggestion[]> {
  try {
    const callable = httpsCallable<unknown, { suggestions: MemberPhoneSuggestion[] }>(functions, "getPosAuthSession");
    const result = await callable(await withDeviceAuth({ action: "searchMemberPhones", payload: input }));
    return result.data.suggestions;
  } catch (error) { throw toMemberServiceError(error); }
}
export async function resumeMemberRegistration(input: { registrationId: string; shopId: number; warehouseId: string }) {
  try {
    const callable = httpsCallable<unknown, MemberRegistrationResult>(functions, "getPosAuthSession");
    const result = await callable(await withDeviceAuth({ action: "resumeMemberRegistration", payload: input }));
    return result.data;
  } catch (error) { throw toMemberServiceError(error); }
}
