import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { cashierRequest } from "./joyworldMemberCardService";
import type { MemberProfile } from "../types/member";

/** OpenAPI UID/phone lookups omit enabled status, including disabled members. */
export async function withLiveMemberStatus(member: MemberProfile, shopId: number): Promise<MemberProfile> {
  let response;
  try {
    response = await cashierRequest({ shopId, path: "/member/cashier/member/getdetails",
      query: { memberAcctId: member.uid, isFilterZeroValue: "false" } });
  } catch {
    // A status outage must not hide an otherwise verified member profile.
    logger.warn("[Member lookup] Cannot load current enabled status");
    return { ...member, isEnabled: null };
  }
  const details = response.data as { shopId?: unknown; isEnabled?: unknown } | null;
  if (details?.shopId !== undefined && Number(details.shopId) !== shopId) {
    throw new HttpsError("permission-denied", "Trạng thái thành viên không thuộc cửa hàng được chọn.");
  }
  return { ...member, isEnabled: typeof details?.isEnabled === "boolean" ? details.isEnabled : null };
}
