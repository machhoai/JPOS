import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "./deviceEnrollmentService";
import { toMemberServiceError } from "./memberService";
import type { PartnerCardRecoveryInput, PartnerCardRecoveryView } from "@/lib/types/partnerCardRecovery";

export async function fetchPartnerCardRecovery(action: "previewPartnerCardRecovery" | "confirmPartnerCardRecovery" | "fetchPartnerCardRecovery", input: PartnerCardRecoveryInput): Promise<PartnerCardRecoveryView> {
  try {
    const call = httpsCallable<unknown, { recovery: PartnerCardRecoveryView }>(functions, "getPosAuthSession");
    return (await call(await withDeviceAuth({ action, payload: input }))).data.recovery;
  } catch (error) { throw toMemberServiceError(error); }
}
export async function detectPartnerCardRecovery(input: PartnerCardRecoveryInput): Promise<PartnerCardRecoveryView | null> {
  try {
    const call = httpsCallable<unknown, { recovery: PartnerCardRecoveryView | null }>(functions, "getPosAuthSession");
    return (await call(await withDeviceAuth({ action: "detectPartnerCardRecovery", payload: input }))).data.recovery;
  } catch (error) { throw toMemberServiceError(error); }
}
