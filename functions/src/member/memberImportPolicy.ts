import { createHash } from "node:crypto";
import type { MemberGender } from "../types/member";

export type HKImportRow = Record<string, unknown> & { memberAcctId: string; shopId: number };
export const MEMBER_IMPORT_SHARDS = 16;
export function normalizeImportRow(value: unknown, shopId: number): HKImportRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("HK trả hồ sơ không hợp lệ.");
  const row = value as Record<string, unknown>;
  if (typeof row.memberAcctId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.memberAcctId) || Number(row.shopId) !== shopId) {
    throw Error("UID hoặc cửa hàng trong danh sách HK không hợp lệ.");
  }
  // Preserve all source fields. Canonical key order makes object-key reordering immaterial.
  return canonical({ ...row, shopId }) as HKImportRow;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  if (typeof value === "number" && !Number.isFinite(value)) throw Error("HK trả giá trị số không hợp lệ.");
  return value;
}
export function importHash(row: HKImportRow): string {
  const normalized = canonical(row) as HKImportRow;
  // HK varies card-list order between reads. Card order has no profile meaning;
  // normalize only this list for hashing while preserving the raw snapshot.
  if (Array.isArray(normalized.memberCardList)) {
    normalized.memberCardList.sort((left, right) => {
      const a = JSON.stringify(left), b = JSON.stringify(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
export function importShard(uid: string): number {
  return createHash("sha256").update(uid).digest()[0] % MEMBER_IMPORT_SHARDS;
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function gender(value: unknown): MemberGender {
  if ([1, "1", "Nam", "male"].includes(value as string | number)) return "MALE";
  if ([2, "2", "Nữ", "female"].includes(value as string | number)) return "FEMALE";
  return "UNKNOWN";
}
export function memberImportPatch(row: HKImportRow, existing: Record<string, unknown> | null, warehouseId: string, now: string) {
  const hash = importHash(row);
  if (existing?.hkImportHash === hash && existing.hkSnapshot && importHash(existing.hkSnapshot as HKImportRow) === hash) return null;
  if (existing && (existing.remoteUid !== row.memberAcctId || Number(existing.shopId) !== row.shopId)) throw Error("Hồ sơ local có scope/UID khác nguồn nhập.");
  const source = {
    fullName: text(row.realName), phone: text(row.phone), nickName: text(row.nickName), gender: gender(row.sex),
    birthDate: text(row.birthday).slice(0, 10) || null,
  };
  const base = existing ? {} : {
    schemaVersion: 1, remoteUid: row.memberAcctId, mid: text(row.memberId) || null,
    memberCode: Array.isArray(row.memberCardList) ? text((row.memberCardList[0] as Record<string, unknown> | undefined)?.memberCode) || null : null,
    ...source, fullName: source.fullName || "Khách chưa cung cấp họ tên", email: typeof row.email === "string" ? text(row.email).toLowerCase() || null : null,
    shopId: row.shopId, warehouseId, hkImportUnassigned: true, createdBy: "hk-member-import", updatedBy: "hk-member-import",
    createdAt: now, updatedAt: now, lastRemoteSyncAt: now,
    // No profileRevision yet: UID lookup must establish complete edit baseline incl. email.
  };
  // Never replace employee drafts, profile revisions, lease, links, or supplemental fields.
  // Source list fields are mirrored separately; existing profile edits remain authoritative.
  return { ...base, hkSnapshot: row, hkImportHash: hash, hkImportedAt: now, hkImportCompleteness: "member_list", hkImportMissingFields: Object.prototype.hasOwnProperty.call(row, "email") ? [] : ["email"] };
}
