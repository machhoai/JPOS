/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const hk = require("../lib/services/hkApiService");
const { ImportFirestore, ImportFirestoreError, decodeFields } = require("../lib/services/memberImportFirestore");
const { runMemberImport } = require("../lib/services/memberImportService");
const { importShard } = require("../lib/member/memberImportPolicy");
let docs, rows, version, injectConflict, memberScans, committedNames;
const clone = value => value ? structuredClone(value) : null;
ImportFirestore.prototype.get = async function(collection, id) { this.reads++; return clone(docs.get(`${collection}/${id}`)); };
ImportFirestore.prototype.members = async function(collection, shopId) {
  memberScans++;
  const result = [...docs.values()].filter(doc => doc.path.startsWith(`${collection}/`) && doc.data.shopId === shopId);
  this.reads += Math.max(1, result.length); return result.map(clone);
};
ImportFirestore.prototype.commit = async function(writes) {
  if (injectConflict && writes.some(write => write.update.name.endsWith("/pos_members/acct-1"))) {
    injectConflict = false;
    const member = docs.get("pos_members/acct-1"); member.data.fullName = "Nhân viên vừa sửa"; member.updateTime = String(++version);
  }
  const plans = writes.map(write => {
    const path = write.update.name.split("/documents/")[1];
    const existing = docs.get(path);
    if ((write.currentDocument.exists === false && existing) || (write.currentDocument.updateTime && existing?.updateTime !== write.currentDocument.updateTime)) throw new ImportFirestoreError(409, "PRECONDITION");
    return { write, path, existing };
  });
  const times = plans.map(({ write, path, existing }) => {
    const updateTime = String(++version);
    docs.set(path, { id: path.split("/").pop(), path, updateTime, data: { ...(write.updateMask ? existing?.data : {}), ...decodeFields(write.update.fields) } });
    committedNames.push(path); return updateTime;
  });
  this.writes += writes.length; return times;
};
function reset() {
  version = 0; injectConflict = false; memberScans = 0; committedNames = [];
  rows = [1, 2, 3].map(index => ({ memberAcctId: `acct-${index}`, memberId: `member-${index}`, shopId: 1, realName: `HK ${index}`, phone: `090000000${index}`, sex: 1, nativeCoin1: index }));
  docs = new Map([1, 2].map(index => [`pos_members/acct-${index}`, { id: `acct-${index}`, path: `pos_members/acct-${index}`, updateTime: String(++version), data: {
    remoteUid: `acct-${index}`, fullName: `POS ${index}`, phone: `090000000${index}`, shopId: 1, warehouseId: index === 1 ? "warehouse-a" : "warehouse-b", email: "supplement@example.com", syncStatus: "PENDING", profileRevision: 3,
  } }]));
  hk.fetchRemoteMemberList = async () => ({ success: true, data: clone(rows), totalRecord: rows.length, totalPage: 1 });
}
const options = { project: "demo-import", shopId: 1, getToken: async () => { throw Error("No live requests allowed"); } };
test("dry-run verifies IDs and proposals without any writes", async () => {
  reset(); const report = await runMemberImport(options);
  assert.equal(report.created, 1); assert.equal(report.updated, 2); assert.equal(report.warehouseGroups, 2);
  assert.equal(report.firestoreWrites, 0); assert.equal(committedNames.length, 0);
});
test("apply imports all snapshots while preserving existing ownership, edits and email", async () => {
  reset(); const result = await runMemberImport({ ...options, apply: true });
  assert.equal(result.created, 1); assert.equal(result.updated, 2);
  assert.equal(docs.get("pos_members/acct-1").data.fullName, "POS 1");
  assert.equal(docs.get("pos_members/acct-2").data.warehouseId, "warehouse-b");
  assert.equal(docs.get("pos_members/acct-1").data.email, "supplement@example.com");
  assert.equal(docs.get("pos_members/acct-3").data.hkImportUnassigned, true);
  assert.equal(docs.get("pos_member_import_state/1-control").data.initialized, true);
});
test("unchanged repeat reads only control and 16 manifests, with zero member writes", async () => {
  reset(); await runMemberImport({ ...options, apply: true }); memberScans = 0; committedNames = [];
  const repeat = await runMemberImport({ ...options, apply: true });
  assert.equal(memberScans, 0); assert.equal(repeat.firestoreReads, 17);
  assert.equal(repeat.updated + repeat.created, 0);
  assert.equal(committedNames.filter(path => path.startsWith("pos_members/")).length, 0);
});
test("precondition race rereads only the conflicting batch and never overwrites the latest POS edit", async () => {
  reset(); injectConflict = true;
  const result = await runMemberImport({ ...options, apply: true });
  assert.equal(result.conflicts, 1);
  assert.equal(docs.get("pos_members/acct-1").data.fullName, "Nhân viên vừa sửa");
  assert.deepEqual(docs.get("pos_members/acct-1").data.hkSnapshot, rows[0]);
});
test("manifest invalidation repairs a removed member on the next run", async () => {
  reset(); await runMemberImport({ ...options, apply: true });
  docs.delete("pos_members/acct-1");
  delete docs.get(`pos_member_import_state/1-shard-${importShard("acct-1")}`).data.hashes["acct-1"];
  const next = await runMemberImport({ ...options, apply: true });
  assert.equal(next.created, 1); assert.ok(docs.get("pos_members/acct-1"));
});
test("audit ignores cached local scans, catches corrupted snapshot, and does not delete local-only records", async () => {
  reset(); let cache; await runMemberImport({ ...options, apply: true, backup: value => { cache = value; } });
  docs.get("pos_members/acct-1").data.hkSnapshot.realName = "Corrupt";
  docs.set("pos_members/local-only", { id: "local-only", path: "pos_members/local-only", updateTime: String(++version), data: { shopId: 1, warehouseId: "warehouse-a" } });
  const audit = await runMemberImport({ ...options, audit: true, cache });
  assert.equal(audit.localScanned, 4); assert.equal(audit.candidates, 1); assert.equal(audit.localOnly, 1);
  assert.ok(docs.get("pos_members/local-only"));
});
test("incomplete or duplicate HK pages abort before writes", async () => {
  reset(); hk.fetchRemoteMemberList = async () => ({ success: true, data: rows, totalRecord: 4, totalPage: 1 });
  await assert.rejects(runMemberImport({ ...options, apply: true }), /không khớp/);
  assert.equal(committedNames.length, 0);
  hk.fetchRemoteMemberList = async () => ({ success: true, data: rows, totalRecord: 6, totalPage: 2 });
  await assert.rejects(runMemberImport({ ...options, apply: true }), /trùng UID/);
  assert.equal(committedNames.length, 0);
});
