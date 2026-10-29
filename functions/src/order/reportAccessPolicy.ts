import { getCurrentVietnamDayRange } from "./orderHistoryRange";

type Permissions = Record<string, Record<string, unknown>>;
type Range = { startAt: string; endAt: string };

export function hasReportPermission(permissions: Permissions, key: string, warehouseId: string): boolean {
  return permissions.global?.["*"] === true || permissions.global?.[key] === true ||
    permissions[warehouseId]?.["*"] === true || permissions[warehouseId]?.[key] === true;
}

export function isWithinToday(range: Range, now = new Date()): boolean {
  const today = getCurrentVietnamDayRange(now);
  return Date.parse(range.startAt) >= Date.parse(today.startAt) &&
    Date.parse(range.endAt) <= Date.parse(today.endAt) &&
    Date.parse(range.startAt) < Date.parse(range.endAt);
}

export function canReadOrder(permissions: Permissions, warehouseId: string, userId: string,
  order: { createdBy?: string; createdAt: string }, now = new Date()): boolean {
  if (hasReportPermission(permissions, "pos.orders.read", warehouseId)) return true;
  return hasReportPermission(permissions, "pos.orders.read_own_today", warehouseId) &&
    isOwnOrderToday(userId, order, now);
}

export function isOwnOrderToday(userId: string, order: { createdBy?: string; createdAt: string }, now = new Date()): boolean {
  const today = getCurrentVietnamDayRange(now);
  return order.createdBy === userId && Date.parse(order.createdAt) >= Date.parse(today.startAt) &&
    Date.parse(order.createdAt) < Date.parse(today.endAt);
}

export function canReadOrderRange(permissions: Permissions, warehouseId: string, range: Range,
  now = new Date()): boolean {
  return hasReportPermission(permissions, "pos.orders.read", warehouseId) ||
    (hasReportPermission(permissions, "pos.orders.read_own_today", warehouseId) && isWithinToday(range, now));
}

export function canAccessCloseout(permissions: Permissions, warehouseId: string,
  range: Range & { scope: "CURRENT_USER" | "ALL_USERS" }, purpose: "VIEW" | "PRINT",
  now = new Date()): boolean {
  const ownToday = range.scope === "CURRENT_USER" && isWithinToday(range, now);
  const has = (key: string) => hasReportPermission(permissions, key, warehouseId);
  const canView = has("pos.shift.close") || (ownToday && has("pos.shift.read_own_today"));
  return canView && (purpose === "VIEW" || has("pos.shift.print") ||
    (ownToday && has("pos.shift.print_own_today")));
}
