import type {
  DocumentData,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { requestAuthSession } from "./posRequestContext";
import { SHARED_AUTH_COLLECTIONS } from "../config/collections";
import { db } from "../config/firebase";
import type {
  PosAuthSessionData,
  RoleRecord,
  SharedUserRecord,
  UserStatus,
  UserWarehouseRoleRecord,
  WarehouseInfo,
} from "../types/auth";
import {
  activeRoleAssignments,
  buildScopedPermissions,
  isSelectablePosWarehouse,
  isUsableLoginUser,
  normalizePhone,
  normalizeUsername,
} from "./posAuthPolicy";

export type PosAuthDomainErrorCode =
  | "USER_NOT_FOUND"
  | "USER_ACCOUNT_NOT_ACTIVE"
  | "USER_RECORD_INVALID";

export class PosAuthDomainError extends Error {
  constructor(public readonly code: PosAuthDomainErrorCode) {
    super(code);
    this.name = "PosAuthDomainError";
  }
}

function requiredString(data: DocumentData, field: string): string {
  const value = data[field];
  if (typeof value !== "string") {
    throw new PosAuthDomainError("USER_RECORD_INVALID");
  }
  return value;
}

function mapUser(snapshot: DocumentSnapshot): SharedUserRecord | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!data) return null;

  return {
    id: snapshot.id,
    username: requiredString(data, "username"),
    email: requiredString(data, "email"),
    full_name: requiredString(data, "full_name"),
    employee_id: requiredString(data, "employee_id"),
    status: requiredString(data, "status") as UserStatus,
    is_deleted: data.is_deleted === true,
    workplace_facility_id:
      typeof data.workplace_facility_id === "string" ||
      data.workplace_facility_id === null
        ? data.workplace_facility_id
        : undefined,
    mfa_enabled:
      typeof data.mfa_enabled === "boolean" ? data.mfa_enabled : undefined,
  };
}

function mapUserForLookup(snapshot: DocumentSnapshot): SharedUserRecord | null {
  try {
    return mapUser(snapshot);
  } catch (error: unknown) {
    if (error instanceof PosAuthDomainError) return null;
    throw error;
  }
}

function mapAssignment(
  snapshot: QueryDocumentSnapshot,
): UserWarehouseRoleRecord {
  const data = snapshot.data();
  const scopeOrigin = data.scope_origin;

  return {
    id: snapshot.id,
    user_id: typeof data.user_id === "string" ? data.user_id : "",
    warehouse_id:
      data.warehouse_id === null
        ? null
        : typeof data.warehouse_id === "string"
          ? data.warehouse_id
          : "",
    role_id: typeof data.role_id === "string" ? data.role_id : "",
    assigned_by: typeof data.assigned_by === "string" ? data.assigned_by : "",
    valid_from: typeof data.valid_from === "string" ? data.valid_from : "",
    valid_until:
      data.valid_until === null
        ? null
        : typeof data.valid_until === "string"
          ? data.valid_until
          : "",
    is_active: data.is_active === true,
    is_deleted: data.is_deleted === true,
    scope_origin:
      scopeOrigin === "DIRECT" || scopeOrigin === "LEGACY_DIRECT"
        ? scopeOrigin
        : undefined,
  };
}

function mapRole(snapshot: DocumentSnapshot): RoleRecord | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!data || data.is_deleted === true) return null;

  const permissions = data.permissions;
  return {
    id: snapshot.id,
    permissions:
      permissions && typeof permissions === "object" && !Array.isArray(permissions)
        ? (permissions as Record<string, unknown>)
        : {},
    is_deleted: false,
  };
}

function mapWarehouse(snapshot: DocumentSnapshot): WarehouseInfo {
  const data = snapshot.data() || {};

  return {
    id: snapshot.id,
    name: typeof data.name === "string" ? data.name : snapshot.id,
    code: typeof data.code === "string" ? data.code : "",
    type: "STORE",
    address: typeof data.address === "string" ? data.address : null,
  };
}

async function getAccessibleWarehouses(
  assignments: UserWarehouseRoleRecord[],
): Promise<WarehouseInfo[]> {
  const canAccessAll = assignments.some(
    (assignment) => assignment.warehouse_id === null,
  );
  const allowedWarehouseIds = new Set(
    assignments
      .map((assignment) => assignment.warehouse_id)
      .filter((warehouseId): warehouseId is string => Boolean(warehouseId)),
  );
  if (!canAccessAll && allowedWarehouseIds.size === 0) return [];

  const warehousesCollection = db.collection(
    SHARED_AUTH_COLLECTIONS.warehouses,
  );
  const warehouseSnapshots: DocumentSnapshot[] = canAccessAll
    ? (await warehousesCollection.where("status", "==", "ACTIVE").get()).docs
    : await Promise.all(
        Array.from(allowedWarehouseIds).map((warehouseId) =>
          warehousesCollection.doc(warehouseId).get(),
        ),
      );

  return warehouseSnapshots
    .filter((snapshot) => {
      const data = snapshot.data();
      return (
        snapshot.exists &&
        isSelectablePosWarehouse(data) &&
        (canAccessAll || allowedWarehouseIds.has(snapshot.id))
      );
    })
    .map(mapWarehouse)
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

async function getUserById(userId: string): Promise<SharedUserRecord | null> {
  const snapshot = await db
    .collection(SHARED_AUTH_COLLECTIONS.users)
    .doc(userId)
    .get();
  return mapUser(snapshot);
}

function getUsableEmail(user: SharedUserRecord | null): string | null {
  return isUsableLoginUser(user) && user.email.trim() ? user.email : null;
}

/** Mirrors bduck-system's email / username / employee-phone resolution. */
export async function resolvePosLoginEmail(
  rawIdentifier: string,
): Promise<string | null> {
  const identifier = rawIdentifier.trim();
  if (!identifier) return null;
  if (identifier.includes("@")) return identifier;

  const usersSnapshot = await db
    .collection(SHARED_AUTH_COLLECTIONS.users)
    .where("is_deleted", "==", false)
    .get();
  const users = usersSnapshot.docs
    .map(mapUserForLookup)
    .filter((user) => user !== null);
  const normalizedIdentifier = normalizeUsername(identifier);
  const usernameUser = users.find(
    (user) => normalizeUsername(user.username) === normalizedIdentifier,
  );
  const usernameEmail = getUsableEmail(usernameUser || null);
  if (usernameEmail) return usernameEmail;

  const normalizedPhone = normalizePhone(identifier);
  if (!normalizedPhone) return null;

  const profilesSnapshot = await db
    .collection(SHARED_AUTH_COLLECTIONS.employeeProfiles)
    .where("is_deleted", "==", false)
    .get();
  const linkedUserIds = Array.from(
    new Set(
      profilesSnapshot.docs
        .filter((profile) => {
          const phone = profile.data().phone;
          return typeof phone === "string" && normalizePhone(phone) === normalizedPhone;
        })
        .map((profile) => profile.data().user_id)
        .filter((userId): userId is string =>
          typeof userId === "string" && userId.length > 0,
        ),
    ),
  );

  if (linkedUserIds.length !== 1) return null;
  return getUsableEmail(await getUserById(linkedUserIds[0]));
}

async function loadPosAuthSession(
  userId: string,
  deviceWarehouseId?: string,
): Promise<PosAuthSessionData> {
  const user = await getUserById(userId);
  if (!user) throw new PosAuthDomainError("USER_NOT_FOUND");
  if (!isUsableLoginUser(user)) {
    throw new PosAuthDomainError("USER_ACCOUNT_NOT_ACTIVE");
  }

  const assignmentsSnapshot = await db
    .collection(SHARED_AUTH_COLLECTIONS.userWarehouseRoles)
    .where("user_id", "==", userId)
    .get();
  const assignments = activeRoleAssignments(
    assignmentsSnapshot.docs.map(mapAssignment),
  );
  const roleIds = Array.from(
    new Set(assignments.map((assignment) => assignment.role_id).filter(Boolean)),
  );
  const [roleSnapshots, warehouses] = await Promise.all([
    Promise.all(
      roleIds.map((roleId) =>
        db.collection(SHARED_AUTH_COLLECTIONS.roles).doc(roleId).get(),
      ),
    ),
    getAccessibleWarehouses(assignments),
  ]);
  const rolesById = new Map(
    roleSnapshots
      .map(mapRole)
      .filter((role): role is RoleRecord => role !== null)
      .map((role) => [role.id, role]),
  );

  const permissions = buildScopedPermissions(assignments, rolesById);
  const hasPosLogin = (warehouseId: string) =>
    permissions.global?.["*"] === true ||
    permissions.global?.["pos.login"] === true ||
    permissions[warehouseId]?.["*"] === true ||
    permissions[warehouseId]?.["pos.login"] === true;
  const accessibleWarehouses = warehouses.filter(
    (warehouse) =>
      (!deviceWarehouseId || warehouse.id === deviceWarehouseId) &&
      hasPosLogin(warehouse.id),
  );

  return {
    user,
    roles: assignments,
    permissions,
    warehouses: accessibleWarehouses,
  };
}

export function getPosAuthSession(userId: string, deviceWarehouseId?: string): Promise<PosAuthSessionData> {
  return requestAuthSession(
    JSON.stringify([userId, deviceWarehouseId ?? null]),
    () => loadPosAuthSession(userId, deviceWarehouseId),
  );
}
