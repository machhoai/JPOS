import { HttpsError } from "firebase-functions/v2/https";
import { getJoyworldBaseUrl, getJoyworldManagerAccessToken } from "./joyworldCatalogService";
import { assertMemberEditAccess, assertMemberShopScope, memberRef } from "./memberProfileEditService";
import { db } from "../config/firebase";
import { MEMBER_SUBCOLLECTIONS } from "../config/collections";
import { hkCalendarDate, RENEWAL_CATEGORIES, validateRenewalInput, validateRenewalSearch } from "../member/renewalPolicy";

export interface RenewalRequest {
  shopId: number;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  bizCode?: string;
  paginated?: boolean;
}
export interface RenewalBatch {
  id: string;
  shopId: number;
  shopName: string;
  expiresAt: string;
  expired: boolean;
  permanent: boolean;
  amount: number;
  remark: string;
}
type RemoteRequest = (input: RenewalRequest) => Promise<unknown>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === "string" ? value.trim() : "";

async function requestCashier(input: RenewalRequest): Promise<unknown> {
  const url = new URL(`${getJoyworldBaseUrl()}${input.path}`);
  Object.entries(input.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const send = async (refresh = false) => fetch(url, {
    method: input.body ? "POST" : "GET",
    // The configured integration account's manager bearer is accepted by these
    // endpoints; no physical workplace login is needed by the POS backend.
    headers: { Authorization: `Bearer ${await getJoyworldManagerAccessToken(refresh)}`, "Content-Type": "application/json", "JJ-SHOPID": String(input.shopId), ...(input.bizCode ? { "JJ-BizCode": input.bizCode } : {}) },
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  let response: Response;
  try {
    response = await send();
    if (response.status === 401) response = await send(true);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    throw new HttpsError("unavailable", "Không thể xác nhận kết quả từ HK. Hãy tải lại và kiểm tra trạng thái với cùng mã thao tác.");
  }
  let payload: Record<string, unknown>;
  try { payload = record(await response.json()); }
  catch { throw new HttpsError("unavailable", "HK trả kết quả không đọc được. Hãy kiểm tra lại trạng thái gia hạn."); }
  if (payload.success === false) throw new HttpsError("failed-precondition", str(payload.msg) || "HK từ chối gia hạn giá trị lưu trữ.");
  if (payload.success !== true) throw new HttpsError("unavailable", "HK chưa xác nhận kết quả gia hạn.");
  return input.paginated ? { items: payload.data, totalRecords: payload.totals ?? payload.totalRecord } : payload.data;
}

export function mapRenewalBatches(data: unknown, category: number, now = new Date()): RenewalBatch[] {
  if (!Array.isArray(data)) throw new HttpsError("data-loss", "HK chưa trả danh sách khoản giá trị hợp lệ.");
  return data.map(value => {
    const row = record(value);
    const id = str(row.id);
    const expiresAt = str(row.limitTime);
    const normalizedTime = expiresAt.replace(" ", "T");
    const timestamp = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalizedTime) ? normalizedTime : `${normalizedTime}+07:00`);
    const expired = timestamp < now.getTime();
    const amount = Number(category === 109 && row.enableAmount !== undefined ? row.enableAmount : expired ? row.limitAmount : row.amount);
    if (!id || !/^[\w-]{1,128}$/.test(id) || !Number.isFinite(timestamp) || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(Number(row.shopId))) {
      throw new HttpsError("data-loss", "Khoản giá trị HK thiếu mã, số lượng hoặc hạn sử dụng hợp lệ.");
    }
    return { id, shopId: Number(row.shopId), shopName: str(row.shopName), expiresAt,
      expired, permanent: Number(expiresAt.slice(0, 4)) - Number(hkCalendarDate(now).slice(0, 4)) > 50,
      amount, remark: str(row.subBusinessName) || str(row.remark) };
  });
}

export async function loadRemoteRenewalBatches(input: { shopId: number; uid: string; category: number; metadataOnly?: boolean }, request: RemoteRequest = requestCashier) {
  const details = record(await request({ shopId: input.shopId, path: "/member/cashier/member/getdetails", query: { memberAcctId: input.uid, isFilterZeroValue: "false" } }));
  const memberId = str(details.memberId);
  if (!memberId || (details.memberAcctId && details.memberAcctId !== input.uid)) throw new HttpsError("data-loss", "HK chưa xác nhận đúng tài khoản thành viên.");
  if (details.isEnabled !== true) throw new HttpsError("failed-precondition", "Thành viên đang bị vô hiệu hóa trên HK.");
  const categories = Array.isArray(details.memberStoreInfo)
    ? [...new Set(details.memberStoreInfo.map(value => Number(record(value).storeCategory)).filter(category => RENEWAL_CATEGORIES.some(value => value === category)))]
    : [...RENEWAL_CATEGORIES];
  if (input.metadataOnly || !categories.includes(input.category)) return { batches: [], memberCode: str(details.memberCode), categories };
  const data = await request({ shopId: input.shopId,
    path: input.category === 109 ? "/member/cashier/memberstore/timecoinbatch" : "/member/cashier/memberstore/getenabledstores",
    query: { memberId, memberAcctId: input.uid, ...(input.category === 109 ? { page: "1", limit: "99999" } : { category: String(input.category) }) },
  });
  return { batches: mapRenewalBatches(data, input.category), memberCode: str(details.memberCode), categories };
}

export async function searchRemoteRenewalBatches(input: { shopId: number; uid: string; category: number; startDate: string; endDate: string; page: number; limit: number }, request: RemoteRequest = requestCashier) {
  const payload = await request({ shopId: input.shopId, path: "/member/cashier/memberstore/getdelaystores", paginated: true,
    query: { memberAcctId: input.uid, category: String(input.category), startTime: `${input.startDate} 00:00:00`, endTime: `${input.endDate} 23:59:59`, page: String(input.page), limit: String(input.limit) } });
  const envelope = record(payload);
  const rows = mapRenewalBatches(Array.isArray(payload) ? payload : envelope.items, input.category);
  const rawTotal = envelope.totalRecords;
  const paginated = typeof rawTotal === "number" && Number.isInteger(rawTotal) && rawTotal >= 0;
  // Current HK returns the complete array without totals and ignores page;
  // paginate that array here. Retain server pagination for versions with totals.
  const totalRecords = paginated ? rawTotal as number : rows.length;
  const batches = paginated ? rows : rows.slice((input.page - 1) * input.limit, input.page * input.limit);
  return { batches, page: input.page, hasMore: input.page * input.limit < totalRecords, totalRecords };
}

async function findRenewalBatch(input: { shopId: number; uid: string; category: number; delayId: string }, expiryDate: string) {
  for (let page = 1; page <= 10000; page += 1) {
    const result = await searchRemoteRenewalBatches({ ...input, startDate: expiryDate, endDate: expiryDate, page, limit: 50 });
    const batch = result.batches.find(item => item.id === input.delayId);
    if (batch || !result.hasMore) return batch;
  }
  throw new HttpsError("resource-exhausted", "Có quá nhiều khoản cùng ngày hết hạn để xác minh gia hạn.");
}

async function assertScope(userId: string, input: { shopId: number; warehouseId: string; uid: string }) {
  assertMemberShopScope(input.shopId);
  const session = await assertMemberEditAccess(userId, input.warehouseId, "pos.members.compensate");
  const local = (await memberRef(input.uid).get()).data();
  if (!local || local.shopId !== input.shopId || local.warehouseId !== input.warehouseId || local.hkImportUnassigned === true) {
    throw new HttpsError("permission-denied", "Hãy tra cứu và xác minh thành viên tại điểm bán này trước khi gia hạn.");
  }
  return session;
}

export async function listMemberRenewalBatchesForUser(userId: string, data: unknown, deviceId: string) {
  const input = validateRenewalSearch(data);
  await assertScope(userId, input);
  // Resolve enabled account types separately; searches use the newer renewal
  // endpoint, whose explicit expiry range can include records older than 90 days.
  const accounts = await loadRemoteRenewalBatches({ ...input, metadataOnly: true });
  const result = accounts.categories.includes(input.category) ? await searchRemoteRenewalBatches(input) : { batches: [], page: input.page, hasMore: false, totalRecords: 0 };
  const operations = await memberRef(input.uid).collection(MEMBER_SUBCOLLECTIONS.storedValueRenewals).where("status", "in", ["PROCESSING", "UNKNOWN"]).get();
  const pending = operations.docs.map(doc => doc.data()).find(op => op.userId === userId && op.deviceId === deviceId && op.category === input.category && op.warehouseId === input.warehouseId);
  return { ...result, categories: accounts.categories, fetchedAt: new Date().toISOString(), pending: pending ? {
    input: { uid: input.uid, shopId: input.shopId, warehouseId: input.warehouseId, category: input.category, operationId: pending.operationId, delayId: pending.delayId, delayDate: pending.delayDate, remark: pending.remark, originalExpiryDate: pending.previousExpiry.slice(0, 10) },
    batch: { id: pending.delayId, shopId: input.shopId, shopName: "", expiresAt: pending.previousExpiry, expired: true, permanent: false, amount: pending.amount, remark: "" },
  } : null };
}

export async function sendRemoteRenewal(input: { shopId: number; uid: string; delayId: string; delayDate: string; remark: string; operationId: string }, memberCode: string, request: RemoteRequest = requestCashier) {
  return request({ shopId: input.shopId, path: "/member/cashier/memberstore/delay", bizCode: input.operationId,
    body: { memberAcctId: input.uid, delayId: input.delayId, delayDate: input.delayDate, ...(memberCode ? { memberCode } : {}), remark: input.remark } });
}

export async function renewMemberStoredValueForUser(userId: string, data: unknown, deviceId: string) {
  const input = validateRenewalInput(data);
  await assertScope(userId, input);
  const parent = memberRef(input.uid);
  const operation = parent.collection(MEMBER_SUBCOLLECTIONS.storedValueRenewals).doc(input.operationId);
  const lock = parent.collection(MEMBER_SUBCOLLECTIONS.storedValueRenewalLocks).doc(input.delayId);
  const fingerprint = JSON.stringify([input.shopId, input.warehouseId, input.category, input.delayId, input.delayDate, input.remark, userId, deviceId]);
  const previous = (await operation.get()).data();
  if (previous && previous.fingerprint !== fingerprint) throw new HttpsError("failed-precondition", "Mã thao tác đã được dùng cho yêu cầu gia hạn khác.");
  if (previous?.status === "SUCCEEDED") return { operationId: input.operationId, completedAt: previous.completedAt, idempotentReplay: true };
  const { batches, memberCode } = await loadRemoteRenewalBatches({ ...input, metadataOnly: Boolean(input.originalExpiryDate) });
  const batch = (previous && previous.status !== "FAILED" ? await findRenewalBatch(input, input.delayDate) : undefined) ??
    (input.originalExpiryDate ? await findRenewalBatch(input, input.originalExpiryDate) : batches.find(item => item.id === input.delayId));
  if (!batch || batch.shopId !== input.shopId) throw new HttpsError("failed-precondition", "Khoản giá trị không còn phù hợp để gia hạn tại cửa hàng này.");
  // A lost response is reconciled by observing the requested absolute expiry;
  // never resend an unknown mutation or take over its lock automatically.
  if (previous && previous.status !== "FAILED" && batch.expiresAt.slice(0, 10) === input.delayDate) {
    const completedAt = new Date().toISOString();
    await db.runTransaction(async tx => {
      const currentLock = (await tx.get(lock)).data();
      tx.update(operation, { status: "SUCCEEDED", completedAt, reconciled: true });
      if (currentLock?.operationId === input.operationId) tx.set(lock, { status: "SUCCEEDED", delayDate: input.delayDate, operationId: input.operationId });
    });
    return { operationId: input.operationId, completedAt, idempotentReplay: true };
  }
  if (batch.permanent || batch.amount <= 0) throw new HttpsError("failed-precondition", "Khoản giá trị không còn phù hợp để gia hạn tại cửa hàng này.");
  if (input.delayDate < hkCalendarDate() || input.delayDate <= batch.expiresAt.slice(0, 10)) throw new HttpsError("invalid-argument", "Hạn mới phải sau hạn hiện tại và từ hôm nay trở đi.");
  await db.runTransaction(async tx => {
    const [opSnapshot, lockSnapshot] = await Promise.all([tx.get(operation), tx.get(lock)]);
    const current = opSnapshot.data();
    if (current?.fingerprint && current.fingerprint !== fingerprint) throw new HttpsError("failed-precondition", "Mã thao tác gia hạn đã thay đổi.");
    if (current?.status === "SUCCEEDED") throw new HttpsError("aborted", "Gia hạn đã hoàn tất. Hãy kiểm tra lại cùng mã thao tác.");
    const currentLock = lockSnapshot.data();
    if ((lockSnapshot.exists && currentLock?.status !== "SUCCEEDED") || (current && current.status !== "FAILED")) throw new HttpsError("aborted", "Khoản giá trị đang xử lý hoặc chưa rõ kết quả. Hãy kiểm tra lại cùng mã thao tác; không gửi yêu cầu mới.");
    if (currentLock?.delayDate && (input.delayDate <= currentLock.delayDate || batch.expiresAt.slice(0, 10) !== currentLock.delayDate)) throw new HttpsError("aborted", "Hạn sử dụng đã thay đổi trong lúc gia hạn. Hãy tải lại khoản giá trị.");
    tx.set(operation, { ...input, userId, deviceId, fingerprint, status: "PROCESSING", previousExpiry: batch.expiresAt, amount: batch.amount, createdAt: current?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() });
    tx.set(lock, { operationId: input.operationId, status: "PROCESSING", lastConfirmedExpiry: batch.expiresAt.slice(0, 10) });
  });
  try { await sendRemoteRenewal(input, memberCode); }
  catch (error) {
    const rejected = error instanceof HttpsError && error.code === "failed-precondition";
    await db.runTransaction(async tx => {
      const currentLock = (await tx.get(lock)).data();
      tx.update(operation, { status: rejected ? "FAILED" : "UNKNOWN", updatedAt: new Date().toISOString() });
      if (rejected && currentLock?.operationId === input.operationId) tx.set(lock, { status: "SUCCEEDED", delayDate: currentLock.lastConfirmedExpiry, operationId: input.operationId });
    });
    throw error;
  }
  const completedAt = new Date().toISOString();
  await db.runTransaction(async tx => {
    const currentLock = (await tx.get(lock)).data();
    tx.update(operation, { status: "SUCCEEDED", completedAt, updatedAt: completedAt });
    if (currentLock?.operationId === input.operationId) tx.set(lock, { status: "SUCCEEDED", delayDate: input.delayDate, operationId: input.operationId });
  });
  return { operationId: input.operationId, completedAt, idempotentReplay: false };
}
