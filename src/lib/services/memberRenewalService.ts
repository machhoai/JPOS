import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";
import { toMemberServiceError } from "@/lib/services/memberService";

export const renewalCategories = [
  { value: 101, label: "Tiền" }, { value: 102, label: "Tiền tặng" },
  { value: 106, label: "Lượt" }, { value: 104, label: "Điểm chơi" },
  { value: 105, label: "Điểm tích lũy" }, { value: 107, label: "Vé xanh" },
  { value: 108, label: "Thời gian chơi" }, { value: 109, label: "Xu giới hạn thời gian" },
  { value: 110, label: "Tiền gửi" }, { value: 111, label: "Giá trị giới thiệu" },
  { value: 112, label: "Giá trị tăng trưởng" }, { value: 115, label: "Tiền mặt trong thẻ" },
  { value: 116, label: "Tiền gửi gốc" }, { value: 117, label: "Tiền gửi tặng" },
  { value: 120, label: "Giá trị tùy chỉnh 1" }, { value: 121, label: "Giá trị tùy chỉnh 2" },
] as const;
export interface MemberRenewalScope { uid: string; warehouseId: string; shopId: number; category: number }
export interface MemberRenewalSearch extends MemberRenewalScope { startDate?: string; endDate?: string; page?: number }
export interface MemberRenewalBatch {
  id: string; shopId: number; shopName: string; expiresAt: string;
  expired: boolean; permanent: boolean; amount: number; remark: string;
}
export interface MemberRenewalInput extends MemberRenewalScope {
  operationId: string; delayId: string; delayDate: string; remark: string;
  originalExpiryDate?: string;
}
async function callRenewal<T>(action: "getMemberRenewalBatches" | "renewMemberStoredValue", payload: MemberRenewalSearch | MemberRenewalInput): Promise<T> {
  try {
    const callable = httpsCallable<unknown, T>(functions, "getPosAuthSession");
    return (await callable(await withDeviceAuth({ action, payload }))).data;
  } catch (error) { throw toMemberServiceError(error); }
}
export const fetchMemberRenewalBatches = (input: MemberRenewalSearch) => callRenewal<{ batches: MemberRenewalBatch[]; categories: number[]; page?: number; hasMore?: boolean; totalRecords?: number | null; fetchedAt: string; pending: { input: MemberRenewalInput; batch: MemberRenewalBatch } | null }>("getMemberRenewalBatches", input);
export const renewMemberStoredValue = (input: MemberRenewalInput) => callRenewal<{ operationId: string; completedAt: string; idempotentReplay: boolean }>("renewMemberStoredValue", input);
