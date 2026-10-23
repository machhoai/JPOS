import { assertMemberShopScope, seedMemberEditProfile, updateMemberProfileLocally } from "../services/memberProfileEditService";
import { withLiveMemberStatus } from "../services/memberLookupStatus";
import { createRegistrationIntent, processRegistration } from "../services/memberRegistrationService";
import { randomUUID } from "node:crypto";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { HttpsError } from "firebase-functions/v2/https";
import type { HKApiResponse } from "../services/hkApiService";
import {
  fetchRemoteMemberByCard,
  fetchRemoteMemberByCardSerial,
  fetchRemoteMemberByPhone,
  fetchRemoteMemberByUid,
  fetchRemoteMemberCards,
  fetchRemoteMemberPassTickets,
  fetchRemoteMemberStoredValueHistory,
} from "../services/hkApiService";
import {
  mapMemberCards,
  mapMemberLookup,
  mapMemberPassTickets,
  mapMemberStoredValueRecords,
  MemberMappingError,
} from "../services/memberMapper";
import { getPosAuthSession } from "../services/posAuthService";
import type {
  HKMemberStoredValueLogDto,
  HKMemberLookupDataDto,
  MemberBalances,
  MemberProfile,
  MemberStoredValueCategory,
  MemberStoredValueRecord,
  StoredMemberProfile,
} from "../types/member";
import {
  type MemberLookupInput,
  type MemberRegistrationInput,
  type MemberStoredValueHistoryInput,
  validateMemberLookupInput,
  validateMemberPassTicketInput,
  validateMemberRegistrationInput,
  validateMemberRemoteScopeInput,
  validateMemberStoredValueHistoryInput,
} from "./memberPolicy";

const STORED_VALUE_CATEGORIES = [1, 2, 4, 5, 6, 7] as const;
const REMOTE_HISTORY_PAGE_LIMIT = 100;

interface StoredValueHistoryPage {
  storedCategory: MemberStoredValueCategory;
  totalPage: number;
  totalRecord: number;
  records: MemberStoredValueRecord[];
}

function isUnavailableStoredValueCategoryError(error: unknown): boolean {
  if (!(error instanceof MemberRemoteApiError) ||
      error.action !== "member_getstored_log") {
    return false;
  }
  const message = error.message.toLocaleLowerCase("vi-VN");
  return message.includes("loại tài khoản được lưu trữ không thành công") ||
    message.includes("stored account type");
}

const EMPTY_BALANCES: MemberBalances = {
  principalVnd: 0,
  bonus: 0,
  totalAvailable: 0,
  turns: 0,
  integral: 0,
  points: 0,
  other: {},
};

export class MemberRemoteApiError extends Error {
  constructor(
    readonly action: string,
    readonly remoteCode: number | null,
    message: string,
    readonly isNotFound = false,
  ) {
    super(message);
    this.name = "MemberRemoteApiError";
  }
}

export class MemberLocalPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberLocalPersistenceError";
  }
}

export async function assertWarehouseAccess(
  userId: string,
  warehouseId: string,
): Promise<void> {
  const session = await getPosAuthSession(userId);
  if (!session.warehouses.some((warehouse) => warehouse.id === warehouseId)) {
    throw new HttpsError(
      "permission-denied",
      "Bạn không có quyền thao tác thành viên tại điểm bán này.",
    );
  }
}

function remoteReason<TData>(
  response: HKApiResponse<TData>,
  fallback: string,
): string {
  return response.msg?.trim() || response.desc?.trim() || fallback;
}

async function callRemote<TData>(
  action: string,
  request: () => Promise<HKApiResponse<TData>>,
): Promise<HKApiResponse<TData>> {
  try {
    return await request();
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "Không rõ nguyên nhân";
    throw new MemberRemoteApiError(
      action,
      null,
      `Không thể kết nối OpenAPI: ${reason}`,
    );
  }
}

function mergeLocalProfile(
  remote: MemberProfile,
  local: StoredMemberProfile | null,
): MemberProfile {
  if (!local) return remote;
  return {
    ...remote,
    mid: remote.mid ?? local.mid,
    memberCode: remote.memberCode ?? local.memberCode,
    ...(local.profileRevision !== undefined ? { profileRevision: local.profileRevision, remoteConfirmedRevision: local.remoteConfirmedRevision ?? 0, syncStatus: local.syncStatus ?? "SYNCED", nickName: local.nickName ?? local.fullName } : {}),
    phone: local.profileRevision !== undefined ? local.phone : remote.phone || local.phone,
    fullName: local.profileRevision !== undefined ? local.fullName : remote.fullName || local.fullName,
    gender: local.profileRevision !== undefined ? local.gender : remote.gender === "UNKNOWN" ? local.gender : remote.gender,
    birthDate: local.birthDate,
    email: local.email,
  };
}

async function fetchAndMapMember(input: MemberLookupInput): Promise<MemberProfile> {
  const isPhone = input.mode === "PHONE";
  const isCardSerial = input.mode === "CARD" && input.cardLookupKind === "SERIAL_NUMBER";
  const action = isPhone
    ? "member_getmember_phone"
    : isCardSerial
      ? "member_getmember_serialnumber"
      : "member_getmember_membercode";
  const response = await callRemote<HKMemberLookupDataDto>(
    action,
    () => isPhone
      ? fetchRemoteMemberByPhone({ shopId: input.shopId, phone: input.query })
      : isCardSerial
        ? fetchRemoteMemberByCardSerial(input.query)
        : fetchRemoteMemberByCard(input.query),
  );

  if (!response.success || !response.data) {
    throw new MemberRemoteApiError(
      action,
      response.code,
      remoteReason(response, "Không tìm thấy thành viên."),
      true,
    );
  }

  try {
    return mapMemberLookup(response.data, {
      shopId: input.shopId,
      memberCode: isPhone || isCardSerial ? undefined : input.query,
    });
  } catch (error: unknown) {
    if (error instanceof MemberMappingError) throw error;
    throw new MemberMappingError("Không thể đọc response thành viên từ OpenAPI.");
  }
}

export async function lookupPosMemberForUser(
  userId: string,
  data: unknown,
) {
  const input = validateMemberLookupInput(data);
  assertMemberShopScope(input.shopId);
  await assertWarehouseAccess(userId, input.warehouseId);
  let remoteMember: MemberProfile;
  if (input.mode === "PHONE" && input.selectedUid) {
    const selected = await db.collection(POS_COLLECTIONS.members).doc(input.selectedUid).get();
    const profile = selected.data();
    if (!profile || profile.shopId !== input.shopId || profile.phone !== input.query) {
      throw new HttpsError("failed-precondition", "Gợi ý đã thay đổi hoặc không thuộc hệ thống thành viên. Vui lòng tìm lại.");
    }
    const response = await callRemote("member_getmember_uid", () => fetchRemoteMemberByUid(selected.id));
    if (!response.success || !response.data || response.data.uid !== selected.id) throw new HttpsError("unavailable", "Chưa thể đọc thành viên đã chọn trên HK.");
    remoteMember = mapMemberLookup(response.data, { shopId: input.shopId });
    if (profile.hkImportUnassigned) {
      const scoped = await callRemote("member_getmember_phone", () => fetchRemoteMemberByPhone({shopId: input.shopId, phone: remoteMember.phone}));
      if (!scoped.success || !scoped.data?.items?.some(item => Number(item.shopId) === input.shopId && item.uid === selected.id)) throw new HttpsError("permission-denied", "HK chưa xác nhận thành viên tại cửa hàng.");
      remoteMember.mid = scoped.data?.mid?.trim() || remoteMember.mid;
    }
    remoteMember = await withLiveMemberStatus(remoteMember, input.shopId);
    const local = await seedMemberEditProfile(remoteMember, input.warehouseId, userId);
    return { member: mergeLocalProfile(remoteMember, local), fetchedAt: new Date().toISOString() };
  }
  const localMatches = input.mode === "PHONE" ? await db.collection(POS_COLLECTIONS.members)
    .where("shopId", "==", input.shopId)
    .where("phone", "==", input.query).limit(2).get() : null;
  if (localMatches && localMatches.size > 1) throw new HttpsError("failed-precondition", "Có nhiều hồ sơ POS cùng số điện thoại. Cần quản trị viên đối chiếu.");
  if (localMatches && !localMatches.empty) {
    const response = await callRemote("member_getmember_uid", () => fetchRemoteMemberByUid(localMatches.docs[0].id));
    if (!response.success || !response.data || response.data.uid !== localMatches.docs[0].id) throw new HttpsError("unavailable", "Chưa thể đối chiếu thành viên trên HK.");
    remoteMember = mapMemberLookup(response.data, { shopId: input.shopId });
  } else {
    remoteMember = await fetchAndMapMember(input);
    // Validate account membership for the requested shop, including card lookups.
    const phoneResponse = await fetchRemoteMemberByPhone({ shopId: input.shopId, phone: remoteMember.phone });
    const shopMember = phoneResponse.data?.items?.find(item => Number(item.shopId) === input.shopId);
    if (!phoneResponse.success || (shopMember?.uid ?? phoneResponse.data?.uid) !== remoteMember.uid) {
      throw new HttpsError("permission-denied", "Tài khoản thẻ không thuộc cửa hàng được chọn.");
    }
    remoteMember = { ...remoteMember, mid: phoneResponse.data?.mid?.trim() || remoteMember.mid };
    const full = await callRemote("member_getmember_uid", () => fetchRemoteMemberByUid(remoteMember.uid));
    if (!full.success || !full.data || full.data.uid !== remoteMember.uid) throw new HttpsError("unavailable", "Chưa thể đọc đủ thông tin thành viên.");
    const details = mapMemberLookup(full.data, { shopId: input.shopId, memberCode: remoteMember.memberCode ?? undefined });
    remoteMember = { ...remoteMember, ...details, mid: remoteMember.mid, memberCode: remoteMember.memberCode, shopName: remoteMember.shopName };
  }
  remoteMember = await withLiveMemberStatus(remoteMember, input.shopId);
  const localMember = await seedMemberEditProfile(remoteMember, input.warehouseId, userId);
  return { member: mergeLocalProfile(remoteMember, localMember), fetchedAt: new Date().toISOString() };
}

async function fetchStoredValueHistoryPage(
  input: MemberStoredValueHistoryInput,
  storedCategory: MemberStoredValueCategory,
  page: number,
  limit: number,
): Promise<StoredValueHistoryPage> {
  const response = await callRemote<HKMemberStoredValueLogDto[]>(
    "member_getstored_log",
    () => fetchRemoteMemberStoredValueHistory({
      uid: input.uid,
      storedCategory,
      startTime: input.startTime,
      endTime: input.endTime,
      page,
      limit,
    }),
  );
  if (!response.success || !Array.isArray(response.data)) {
    throw new MemberRemoteApiError(
      "member_getstored_log",
      response.code,
      remoteReason(response, "OpenAPI không thể tải lịch sử sử dụng."),
    );
  }

  const records = mapMemberStoredValueRecords(response.data, storedCategory);
  const totalRecord = response.totalRecord ?? records.length;
  return {
    storedCategory,
    totalPage: response.totalPage ?? Math.ceil(totalRecord / limit),
    totalRecord,
    records,
  };
}

async function fetchAllStoredValueHistory(
  input: MemberStoredValueHistoryInput,
): Promise<{
  totalPage: number;
  totalRecord: number;
  records: MemberStoredValueRecord[];
}> {
  const requestedRecordCount = input.page * input.limit;
  const remotePageLimit = Math.min(
    requestedRecordCount,
    REMOTE_HISTORY_PAGE_LIMIT,
  );
  const requestedRemotePages = Math.ceil(
    requestedRecordCount / remotePageLimit,
  );
  const firstPageResults = await Promise.all(
    STORED_VALUE_CATEGORIES.map((storedCategory) =>
      fetchStoredValueHistoryPage(
        input,
        storedCategory,
        1,
        remotePageLimit,
      ).catch((error: unknown) => {
        if (isUnavailableStoredValueCategoryError(error)) return null;
        throw error;
      }),
    ),
  );
  const firstPages = firstPageResults.filter(
    (historyPage): historyPage is StoredValueHistoryPage => historyPage !== null,
  );
  const remainingPages = await Promise.all(
    firstPages.flatMap((firstPage) => {
      const finalPage = Math.min(firstPage.totalPage, requestedRemotePages);
      return Array.from(
        { length: Math.max(0, finalPage - 1) },
        (_, index) => fetchStoredValueHistoryPage(
          input,
          firstPage.storedCategory,
          index + 2,
          remotePageLimit,
        ),
      );
    }),
  );
  const totalRecord = firstPages.reduce(
    (total, historyPage) => total + historyPage.totalRecord,
    0,
  );
  const records = [...firstPages, ...remainingPages]
    .flatMap((historyPage) => historyPage.records)
    .sort((left, right) => right.createTime.localeCompare(left.createTime));
  const startIndex = (input.page - 1) * input.limit;

  return {
    totalPage: Math.ceil(totalRecord / input.limit),
    totalRecord,
    records: records.slice(startIndex, startIndex + input.limit),
  };
}

export async function listPosMemberStoredValueHistoryForUser(
  userId: string,
  data: unknown,
) {
  const input = validateMemberStoredValueHistoryInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);
  const history = input.storedCategory === "ALL"
    ? await fetchAllStoredValueHistory(input)
    : await fetchStoredValueHistoryPage(
      input,
      input.storedCategory,
      input.page,
      input.limit,
    );

  return {
    page: input.page,
    limit: input.limit,
    totalPage: history.totalPage,
    totalRecord: history.totalRecord,
    records: history.records,
    fetchedAt: new Date().toISOString(),
  };
}

export async function listPosMemberCardsForUser(
  userId: string,
  data: unknown,
) {
  const input = validateMemberRemoteScopeInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);
  const response = await callRemote(
    "member_getmembercode",
    () => fetchRemoteMemberCards(input.uid),
  );
  if (!response.success || !Array.isArray(response.data)) {
    throw new MemberRemoteApiError(
      "member_getmembercode",
      response.code,
      remoteReason(response, "OpenAPI không thể tải danh sách thẻ."),
    );
  }
  return {
    cards: mapMemberCards(response.data),
    fetchedAt: new Date().toISOString(),
  };
}

export async function listPosMemberPassTicketsForUser(
  userId: string,
  data: unknown,
) {
  const input = validateMemberPassTicketInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);
  const response = await callRemote(
    "member_passticket_list",
    () => fetchRemoteMemberPassTickets({
      uid: input.uid,
      category: input.category,
    }),
  );
  if (!response.success || !Array.isArray(response.data)) {
    throw new MemberRemoteApiError(
      "member_passticket_list",
      response.code,
      remoteReason(response, "OpenAPI không thể tải vé và gói đã mua."),
    );
  }
  return {
    tickets: mapMemberPassTickets(response.data),
    fetchedAt: new Date().toISOString(),
  };
}

function registrationProfile(
  input: MemberRegistrationInput,
  remoteUid: string,
  mid: string | null,
): MemberProfile {
  return {
    uid: remoteUid,
    mid,
    memberCode: input.memberCode,
    phone: input.phone,
    fullName: input.fullName,
    gender: input.gender,
    birthDate: input.birthDate,
    email: input.email,
    levelName: "",
    shopId: input.shopId,
    shopName: null,
    balances: EMPTY_BALANCES,
  };
}

export async function registerPosMemberForUser(
  userId: string,
  data: unknown,
  deviceId = "",
) {
  const input = validateMemberRegistrationInput(data);
  assertMemberShopScope(input.shopId);
  await assertWarehouseAccess(userId, input.warehouseId);
  const raw = data as Record<string, unknown>;
  const operationId = typeof raw.operationId === "string" ? raw.operationId : randomUUID();
  const id = await createRegistrationIntent(input, userId, deviceId, operationId);
  const { profile: stored } = await processRegistration(id);
  return {
    member: registrationProfile({ ...input, ...stored }, stored.remoteUid, stored.mid),
    remoteMessage: null,
    createdAt: stored.createdAt,
    registrationId: id,
  };
}

export async function updatePosMemberProfileForUser(userId: string, data: unknown, deviceId = "") {
  if (!deviceId) throw new HttpsError("permission-denied", "Cần xác minh thiết bị POS trước khi chỉnh sửa.");
  return updateMemberProfileLocally(userId, data, deviceId);
}

export async function resumePosMemberRegistrationForUser(userId: string, data: unknown) {
  const input = data as { registrationId?: unknown; shopId?: unknown; warehouseId?: unknown } | null;
  const id = typeof input?.registrationId === "string" ? input.registrationId : "";
  const warehouseId = typeof input?.warehouseId === "string" ? input.warehouseId : "";
  const shopId = Number(input?.shopId);
  if (!/^[a-f0-9]{64}$/.test(id) || !warehouseId) throw new HttpsError("invalid-argument", "Yêu cầu phục hồi không hợp lệ.");
  assertMemberShopScope(shopId);
  await assertWarehouseAccess(userId, warehouseId);
  const intent = (await db.collection(POS_COLLECTIONS.memberRegistrations).doc(id).get()).data();
  if (!intent || intent.warehouseId !== warehouseId || intent.shopId !== shopId) throw new HttpsError("permission-denied", "Yêu cầu đăng ký không thuộc điểm bán.");
  const { profile: stored } = await processRegistration(id);
  return { member: registrationProfile(stored, stored.remoteUid, stored.mid), remoteMessage: null, createdAt: stored.createdAt, registrationId: id };
}
