import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import { MemberServiceError, toMemberServiceError } from "@/lib/services/memberService";
import type { MemberPointPackage } from "@/lib/types/member";
import type { OrderStatus } from "@/lib/types/order";
import type { OrderMemberSnapshot } from "@/lib/types/order";

export interface MemberPackageScope {
  shopId: number;
  warehouseId: string;
  uid: string;
}

export interface MemberPackageSaleInput extends MemberPackageScope {
  localOrderId: string;
  goodsId: string;
  quotedPrice?: number;
  member: OrderMemberSnapshot;
}

export interface MemberPackageCatalogResult {
  packages: MemberPointPackage[];
  fetchedAt: string;
}

export interface PreparedMemberPackageOrder {
  localOrderId: string;
  status: OrderStatus;
  totalAmount: number;
  selectedPackage: MemberPointPackage;
}

export interface CompletedMemberPackageSale {
  localOrderId: string;
  remoteOrderNumber: string | null;
  status: "SYNC_SUCCESS";
  completedAt: string | null;
}

async function callMemberPackageAction<TPayload, TResult>(
  action:
    | "getMemberPackages"
    | "prepareMemberPackageOrder"
    | "sellMemberPackageCash"
    | "finalizeMemberPackageSale",
  payload: TPayload,
): Promise<TResult> {
  const callable = httpsCallable<
    { action: typeof action; payload: TPayload },
    TResult
  >(functions, "getPosAuthSession");
  try {
    const result = await callable(await withDeviceAuth({ action, payload }));
    return result.data;
  } catch (error: unknown) {
    if (error instanceof Error && (error as { details?: { action?: string } }).details?.action === "MEMBER_PACKAGE_QUOTE_CHANGED") {
      throw new MemberServiceError(error.message, "MEMBER_PACKAGE_QUOTE_CHANGED");
    }
    throw toMemberServiceError(error);
  }
}

export const fetchMemberPackages = (input: MemberPackageScope) =>
  callMemberPackageAction<MemberPackageScope, MemberPackageCatalogResult>(
    "getMemberPackages",
    input,
  );

export const prepareMemberPackageOrder = (input: MemberPackageSaleInput) =>
  callMemberPackageAction<MemberPackageSaleInput, PreparedMemberPackageOrder>(
    "prepareMemberPackageOrder",
    input,
  );

export const sellMemberPackageForCash = (input: MemberPackageSaleInput) =>
  callMemberPackageAction<MemberPackageSaleInput, CompletedMemberPackageSale>(
    "sellMemberPackageCash",
    input,
  );

export const finalizeMemberPackageSale = (localOrderId: string) =>
  callMemberPackageAction<{ localOrderId: string }, CompletedMemberPackageSale>(
    "finalizeMemberPackageSale",
    { localOrderId },
  );
