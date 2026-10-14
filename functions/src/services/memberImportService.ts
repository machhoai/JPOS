import { randomUUID } from "node:crypto";
import { POS_COLLECTIONS } from "../config/collections";
import { fetchRemoteMemberList } from "./hkApiService";
import { ImportFirestore, ImportFirestoreError, type ImportDocument } from "./memberImportFirestore";
import { importHash, importShard, memberImportPatch, normalizeImportRow, MEMBER_IMPORT_SHARDS, type HKImportRow } from "../member/memberImportPolicy";

export interface MemberImportCache { rows: HKImportRow[]; local: ImportDocument[]; project: string; shopId: number; warehouseId: string; capturedAt: string }
export interface MemberImportOptions {
  project: string; shopId: number; getToken: () => Promise<string>; apply?: boolean; audit?: boolean;
  cache?: MemberImportCache; backup?: (cache: MemberImportCache) => void;
  log?: (event: string, metrics: Record<string, unknown>) => void;
}
export async function fetchMemberImportSource(shopId: number, log?: MemberImportOptions["log"]): Promise<HKImportRow[]> {
  const rows: HKImportRow[] = [];
  const seen = new Set<string>();
  let expected = -1, pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await fetchRemoteMemberList({ page, limit: 1000 });
    if (!response.success || !Array.isArray(response.data) || !Number.isInteger(response.totalRecord) || !Number.isInteger(response.totalPage)) throw Error("HK chưa trả đủ metadata danh sách thành viên.");
    if (expected < 0) { expected = response.totalRecord!; pages = response.totalPage!; }
    if (expected < 1 || pages < 1 || pages > 1000 || response.totalRecord !== expected || response.totalPage !== pages) throw Error("Tổng thành viên HK thay đổi hoặc phân trang không ổn định. Không được áp dụng snapshot này.");
    for (const value of response.data) {
      const row = normalizeImportRow(value, shopId);
      if (seen.has(row.memberAcctId)) throw Error("Danh sách HK trùng UID giữa các trang. Cần tải lại.");
      seen.add(row.memberAcctId); rows.push(row);
    }
    log?.("Đã đọc trang HK", { page, pages, rows: response.data.length, expected });
  }
  if (rows.length !== expected) throw Error("Số UID thực nhận không khớp totalRecord HK. Không ghi dữ liệu.");
  return rows;
}
export async function runMemberImport(options: MemberImportOptions) {
  const store = new ImportFirestore(options.project, options.getToken);
  const started = new Date().toISOString();
  const rows = await fetchMemberImportSource(options.shopId, options.log);
  const controlId = `${options.shopId}-control`;
  let control = await store.get(POS_COLLECTIONS.memberImportState, controlId);
  if (control?.data.leaseExpiresAt && String(control.data.leaseExpiresAt) > started) throw Error("Một tiến trình nhập thành viên khác đang chạy.");
  const shards = await Promise.all(Array.from({ length: MEMBER_IMPORT_SHARDS }, (_, index) => store.get(POS_COLLECTIONS.memberImportState, `${options.shopId}-shard-${index}`)));
  const hashMaps = shards.map(doc => ({ ...(doc?.data.hashes as Record<string, string> ?? {}) }));
  const cacheUsable = options.cache?.project === options.project && options.cache.shopId === options.shopId &&
    Date.now() - Date.parse(options.cache.capturedAt) < 15 * 60_000;
  const fullScan = options.audit || !control?.data.initialized;
  const local = fullScan ? cacheUsable && !options.audit ? options.cache!.local : await store.members(POS_COLLECTIONS.members, options.shopId) : [];
  const localMap = new Map(local.map(doc => [doc.id, doc]));
  const warehouses = new Set(local.map(doc => doc.data.warehouseId).filter(value => typeof value === "string" && value));
  const warehouseId = String(control?.data.warehouseId || (cacheUsable ? options.cache!.warehouseId : "") || (warehouses.size === 1 ? [...warehouses][0] : `hk-shop-${options.shopId}`));
  if (!warehouseId) throw Error("Không xác định được scope nhập.");
  const cache = { rows, local, project: options.project, shopId: options.shopId, warehouseId, capturedAt: started };
  options.backup?.(cache);
  const candidates = rows.filter(row => fullScan ? localMap.get(row.memberAcctId)?.data.hkImportHash !== importHash(row) ||
    !localMap.get(row.memberAcctId)?.data.hkSnapshot || importHash(localMap.get(row.memberAcctId)!.data.hkSnapshot as HKImportRow) !== importHash(row)
    : hashMaps[importShard(row.memberAcctId)][row.memberAcctId] !== importHash(row));
  const remoteIds = new Set(rows.map(row => row.memberAcctId));
  const localOnly = fullScan ? local.filter(doc => !remoteIds.has(doc.id)).length : null;
  const report = {
    project: options.project, shopId: options.shopId, warehouseId, startedAt: started, mode: options.apply ? "apply" : "dry-run",
    sourceTotal: rows.length, warehouseGroups: warehouses.size, localScanned: local.length, candidates: candidates.length, localOnly,
    created: 0, updated: 0, unchanged: rows.length - candidates.length, conflicts: 0,
    firestoreReads: 0, firestoreWrites: 0, completedAt: "", missingEmailInSource: rows.filter(row => !Object.prototype.hasOwnProperty.call(row, "email")).length,
  };
  // Plan a first run from the one local scan, with no document gets for known-missing IDs.
  if (!options.apply) {
    report.created = fullScan ? candidates.filter(row => !localMap.has(row.memberAcctId)).length : 0;
    report.updated = fullScan ? candidates.length - report.created : 0;
    report.firestoreReads = store.reads; report.completedAt = new Date().toISOString();
    return report;
  }
  const token = randomUUID();
  const runId = `${options.shopId}-${token}`;
  const claim = { shopId: options.shopId, warehouseId, token, leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(), initialized: control?.data.initialized === true };
  const [claimedAt] = await store.commit([store.write(POS_COLLECTIONS.memberImportState, controlId, claim, control)]);
  control = { id: controlId, updateTime: claimedAt, data: claim };
  let failed = false;
  try {
    const chunks: HKImportRow[][] = [];
    for (let shard = 0; shard < MEMBER_IMPORT_SHARDS; shard++) {
      const bucket = candidates.filter(row => importShard(row.memberAcctId) === shard);
      let current: HKImportRow[] = [], bytes = 0;
      for (const row of bucket) {
        const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8") * 4 + 1500;
        if (rowBytes > 750000) throw Error("Một hồ sơ HK quá lớn. Cần kiểm tra trước khi nhập.");
        if (current.length >= 350 || bytes + rowBytes > 6 * 1024 * 1024) { chunks.push(current); current = []; bytes = 0; }
        current.push(row); bytes += rowBytes;
      }
      if (current.length) chunks.push(current);
    }
    let processed = 0;
    for (const batch of chunks) {
      if (Date.now() - Date.parse(started) > 15 * 60_000) throw Error("Job quá thời gian cho phép. Dừng để tránh mất lease.");
      if (!fullScan) await Promise.all(batch.map(async row => { localMap.set(row.memberAcctId, await store.get(POS_COLLECTIONS.members, row.memberAcctId) as ImportDocument); }));
      let committed = false;
      for (let attempt = 0; attempt < 3 && !committed; attempt++) {
        const plans = batch.map(row => ({ row, previous: localMap.get(row.memberAcctId) ?? null, patch: memberImportPatch(row, localMap.get(row.memberAcctId)?.data ?? null, warehouseId, new Date().toISOString()) }));
        const writes = plans.filter(plan => plan.patch).map(plan => store.write(POS_COLLECTIONS.members, plan.row.memberAcctId, plan.patch!, plan.previous));
        const touched = [...new Set(batch.map(row => importShard(row.memberAcctId)))];
        const nextHashes = touched.map(index => ({ ...hashMaps[index] }));
        for (const row of batch) nextHashes[touched.indexOf(importShard(row.memberAcctId))][row.memberAcctId] = importHash(row);
        for (let index = 0; index < touched.length; index++) writes.push(store.write(POS_COLLECTIONS.memberImportState, `${options.shopId}-shard-${touched[index]}`, { shopId: options.shopId, hashes: nextHashes[index], schemaVersion: 1 }, shards[touched[index]]));
        // Fence ownership in the same atomic commit, without rereading the lease for each batch.
        writes.push(store.write(POS_COLLECTIONS.memberImportState, controlId, { lastChunkAt: new Date().toISOString(), token }, control));
        try {
          const times = await store.commit(writes);
          const patched = plans.filter(plan => plan.patch);
          report.created += patched.filter(plan => !plan.previous).length;
          report.updated += patched.filter(plan => plan.previous).length;
          report.unchanged += plans.length - patched.length;
          for (let index = 0; index < touched.length; index++) {
            const shard = touched[index]; hashMaps[shard] = nextHashes[index];
            shards[shard] = { id: `${options.shopId}-shard-${shard}`, data: { hashes: nextHashes[index] }, updateTime: times[patched.length + index] };
          }
          control.updateTime = times[times.length - 1]; committed = true;
        } catch (error) {
          if (!(error instanceof ImportFirestoreError) || ![400, 409, 412].includes(error.status)) throw error;
          report.conflicts++;
          const actualControl = await store.get(POS_COLLECTIONS.memberImportState, controlId);
          if (actualControl?.data.token !== token) throw Error("Lease nhập đã bị thay đổi. Dừng ghi.");
          control = actualControl;
          await Promise.all(batch.map(async row => { localMap.set(row.memberAcctId, await store.get(POS_COLLECTIONS.members, row.memberAcctId) as ImportDocument); }));
          for (const index of touched) { shards[index] = await store.get(POS_COLLECTIONS.memberImportState, `${options.shopId}-shard-${index}`); hashMaps[index] = { ...(shards[index]?.data.hashes as Record<string, string> ?? {}) }; }
        }
      }
      if (!committed) throw Error("Không thể áp dụng lô sau ba lần đối chiếu phiên bản.");
      processed += batch.length;
      options.log?.("Đã ghi lô Firestore", { processed, total: candidates.length, created: report.created, updated: report.updated });
    }
  } catch (error) { failed = true; throw error; }
  finally {
    report.completedAt = new Date().toISOString(); report.firestoreReads = store.reads;
    report.firestoreWrites = store.writes + 2;
    // If a request's outcome is ambiguous, stale updateTime prevents claiming completion.
    await store.commit([
      store.write(POS_COLLECTIONS.memberImportState, controlId, { initialized: !failed, token: null, leaseExpiresAt: "", completedAt: report.completedAt, sourceTotal: rows.length }, control),
      store.write(POS_COLLECTIONS.memberImportRuns, runId, { ...report, status: failed ? "FAILED" : "COMPLETED" }, null),
    ]);
  }
  return report;
}
