/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../lib/config/firebase");
const auth = require("../lib/services/posAuthService");
const hk = require("../lib/services/hkApiService");
const service = require("../lib/services/memberProfileEditService");
const { synchronizeMemberProfile } = require("../lib/member/profileSyncWorker");
const { profilePayload, validateProfileEdit } = require("../lib/member/profileEditPolicy");
process.env.HK_API_SHOP_ID = "1";

// Atomic in-memory Firestore boundary: exercises the actual save/worker functions,
// including checkpoints and lease guards, without contacting Firebase or HK.
let documents, remote, calls;
class Reference {
  constructor(path) { this.path = path; this.id = path.split("/").pop(); }
  collection(name) { return new Query(`${this.path}/${name}`); }
  async get() { return snapshot(this.path); }
}
function snapshot(path) {
  return { id: path.split("/").pop(), ref: new Reference(path), exists: documents.has(path), data: () => structuredClone(documents.get(path)) };
}
class Query {
  constructor(path, filters = [], orders = [], max = Infinity) { Object.assign(this, { path, filters, orders, max }); }
  doc(id) { return new Reference(`${this.path}/${id}`); }
  where(field, operator, value) { return new Query(this.path, [...this.filters, [field, operator, value]], this.orders, this.max); }
  orderBy(field, direction = "asc") { return new Query(this.path, this.filters, [...this.orders, [field, direction]], this.max); }
  limit(max) { return new Query(this.path, this.filters, this.orders, max); }
  async get() {
    let matches = [...documents.keys()].filter(path => path.startsWith(`${this.path}/`) && path.split("/").length === this.path.split("/").length + 1).map(snapshot);
    matches = matches.filter(doc => this.filters.every(([key, operator, value]) => operator === "in" ? value.includes(doc.data()[key]) : operator === "<=" ? doc.data()[key] <= value : doc.data()[key] === value));
    for (const [key, direction] of this.orders.slice().reverse()) matches.sort((a, b) => (a.data()[key] > b.data()[key] ? 1 : -1) * (direction === "desc" ? -1 : 1));
    matches = matches.slice(0, this.max);
    return { docs: matches, empty: !matches.length, size: matches.length };
  }
}
db.collection = path => new Query(path);
db.runTransaction = async callback => {
  const writes = [];
  const tx = {
    get: ref => ref.get(),
    create: (ref, data) => { if (documents.has(ref.path)) throw Error("already exists"); writes.push(["set", ref, data]); },
    set: (ref, data) => writes.push(["set", ref, data]),
    update: (ref, data) => writes.push(["update", ref, data]),
  };
  const result = await callback(tx);
  for (const [kind, ref, data] of writes) documents.set(ref.path, structuredClone(kind === "set" ? data : { ...documents.get(ref.path), ...data }));
  return result;
};
auth.getPosAuthSession = async () => ({ warehouses: [{ id: "store" }], permissions: { global: { "*": true } }, user: { full_name: "Nhân viên thử" } });
const base = { fullName: "Tên gốc", phone: "0900000000", nickName: "Tên riêng", gender: "MALE", birthDate: "1995-01-01", email: "original@example.com" };
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const profilePath = "pos_members/account";
const changePath = id => `pos_member_profile_changes/${id}`;
function dto() { return { uid: "account", realName: remote.fullName, phone: remote.phone, nickName: remote.nickName, sex: remote.gender === "MALE" ? 1 : 2, birthday: remote.birthDate, email: remote.email, storedValues: [] }; }
function reset() {
  remote = { ...base }; calls = [];
  documents = new Map([[profilePath, {
    schemaVersion: 1, remoteUid: "account", mid: "member", memberCode: "CARD",
    ...base, shopId: 1, warehouseId: "store", createdBy: "user", updatedBy: "user", createdAt: "2026-01-01", updatedAt: "2026-01-01", lastRemoteSyncAt: "2026-01-01",
    profileRevision: 0, remoteConfirmedRevision: 0, remoteSnapshot: { ...base }, syncStatus: "SYNCED", syncLease: null,
  }]]);
  hk.fetchRemoteMemberByUid = async () => { calls.push("read"); return { success: true, data: dto() }; };
  hk.updateRemoteMemberPhone = async (uid, phone) => { calls.push("phone"); remote.phone = phone; return { success: true, data: { newPhone: phone } }; };
  hk.updateRemoteMemberProfile = async body => {
    calls.push("profile");
    Object.assign(remote, { fullName: body.realName, nickName: body.nickName, gender: body.sex === 1 ? "MALE" : "FEMALE", birthDate: body.birthday ?? remote.birthDate, email: body.email ?? remote.email });
    return { success: true, data: true };
  };
}
async function save(index, patch = {}, revision = index) {
  return service.updateMemberProfileLocally("user", { ...base, ...patch, uid: "account", operationId: ids[index], baseRevision: revision, warehouseId: "store", shopId: 1 }, "device");
}

test("required fields reject blanks at the backend", () => {
  for (const patch of [{ fullName: "   " }, { phone: "" }, { nickName: " " }]) {
    assert.throws(() => validateProfileEdit({ ...base, ...patch, uid: "account", operationId: ids[0], baseRevision: 0, warehouseId: "store", shopId: 1 }));
  }
});
test("save writes local profile and immutable history without calling HK; repeat is idempotent", async () => {
  reset();
  await save(0, { fullName: "Tên mới" });
  await save(0, { fullName: "Tên mới" });
  assert.deepEqual(calls, []);
  assert.equal(documents.get(profilePath).profileRevision, 1);
  assert.equal(documents.get(changePath(ids[0])).before.fullName, base.fullName);
  assert.equal(documents.get(changePath(ids[0])).status, "PENDING");
  await assert.rejects(save(0, { fullName: "Nội dung khác" }), /Mã thao tác/);
});
test("revision conflict rejects a stale second cashier and leaves state intact", async () => {
  reset(); await save(0, { fullName: "Bản đầu" });
  await assert.rejects(save(1, { fullName: "Bản cũ" }, 0), /Hồ sơ đã được thay đổi/);
  assert.equal(documents.get(profilePath).fullName, "Bản đầu");
  assert.equal(documents.has(changePath(ids[1])), false);
});
test("FIFO keeps latest local revision while worker completes older snapshots", async () => {
  reset(); await save(0, { fullName: "B" }); await save(1, { fullName: "C" });
  await synchronizeMemberProfile("account");
  assert.equal(remote.fullName, "B");
  assert.equal(documents.get(profilePath).fullName, "C");
  assert.equal(documents.get(profilePath).syncStatus, "PENDING");
  assert.equal(documents.get(changePath(ids[1])).status, "PENDING");
  await synchronizeMemberProfile("account");
  assert.equal(remote.fullName, "C");
  assert.equal(documents.get(profilePath).remoteConfirmedRevision, 2);
  assert.equal(documents.get(profilePath).syncStatus, "SYNCED");
  assert.equal(remote.nickName, base.nickName);
  assert.equal(remote.gender, "MALE");
});
test("business failure blocks newer changes until an explicit correction supersedes them", async () => {
  reset(); await save(0, { phone: "0900000001" }); await save(1, { fullName: "C", phone: "0900000001" });
  hk.updateRemoteMemberPhone = async () => { calls.push("phone-failed"); return { success: false, msg: "Số điện thoại bị trùng" }; };
  await synchronizeMemberProfile("account"); await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).status, "NEEDS_ACTION");
  assert.equal(documents.get(changePath(ids[1])).status, "PENDING");
  assert.equal(calls.filter(value => value === "phone-failed").length, 1);
  await service.updateMemberProfileLocally("user", { ...base, fullName: "C", phone: "0900000002", uid: "account", operationId: ids[2], baseRevision: 2, warehouseId: "store", shopId: 1, resolveOperationId: ids[0] }, "device");
  assert.equal(documents.get(changePath(ids[0])).status, "SUPERSEDED");
  assert.equal(documents.get(changePath(ids[1])).status, "SUPERSEDED");
  assert.deepEqual(new Set(documents.get(changePath(ids[2])).changedFields), new Set(["phone", "fullName"]));
});
test("timeout after phone mutation is reconciled before remaining profile step; phone is not repeated", async () => {
  reset(); await save(0, { phone: "0900000001", fullName: "B" });
  hk.updateRemoteMemberPhone = async (uid, phone) => { calls.push("phone-timeout"); remote.phone = phone; throw Error("timeout"); };
  await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).status, "UNKNOWN");
  documents.get(changePath(ids[0])).nextAttemptAt = "2000-01-01";
  await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).status, "SYNCED");
  assert.equal(remote.fullName, "B");
  assert.equal(calls.filter(value => value === "phone-timeout").length, 1);
});
test("unresolved timeout remains UNKNOWN and is never resent or superseded", async () => {
  reset(); await save(0, { phone: "0900000001" });
  hk.updateRemoteMemberPhone = async () => { calls.push("timeout"); throw Error("timeout"); };
  await synchronizeMemberProfile("account");
  documents.get(changePath(ids[0])).nextAttemptAt = "2000-01-01";
  await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).status, "UNKNOWN");
  assert.equal(calls.filter(value => value === "timeout").length, 1);
  await assert.rejects(service.updateMemberProfileLocally("user", { ...base, fullName: "B", uid: "account", operationId: ids[1], baseRevision: 1, warehouseId: "store", shopId: 1, resolveOperationId: ids[0] }, "device"), /Chỉ được thay thế/);
});
test("a duplicate worker observes the lease and does not contact HK", async () => {
  reset(); await save(0, { fullName: "B" });
  const originalRead = hk.fetchRemoteMemberByUid;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  hk.fetchRemoteMemberByUid = async () => { entered(); await new Promise(resolve => { release = resolve; }); hk.fetchRemoteMemberByUid = originalRead; return originalRead(); };
  const first = synchronizeMemberProfile("account"); await started;
  await synchronizeMemberProfile("account");
  assert.deepEqual(calls, []);
  release(); await first;
  assert.equal(calls.filter(value => value === "profile").length, 1);
});
test("payload includes sex and preserves unrelated remote fields", () => {
  const change = { memberUid: "account", memberMid: "member", changedFields: ["fullName"], after: { ...base, fullName: "B" } };
  const { body } = profilePayload(change, { ...base, nickName: "Tên riêng ở HK", email: "new@example.com" });
  assert.equal(body.sex, 1); assert.equal(body.nickName, "Tên riêng ở HK"); assert.equal(body.email, "new@example.com");
});

test("partial profile failure resumes after the confirmed phone step", async () => {
  reset(); await save(0, { phone: "0900000001", fullName: "B" });
  const original = hk.updateRemoteMemberProfile;
  hk.updateRemoteMemberProfile = async () => ({ success: false, msg: "HK từ chối hồ sơ" });
  await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).phoneStep, "DONE");
  assert.equal(documents.get(changePath(ids[0])).profileStep, "PENDING");
  hk.updateRemoteMemberProfile = original;
  await service.updateMemberProfileSyncRetryForUser("user", { uid: "account", operationId: ids[0], warehouseId: "store", shopId: 1 });
  await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).status, "SYNCED");
  assert.equal(calls.filter(value => value === "phone").length, 1);
});
test("HK edits outside the patch are preserved and reflected after sync", async () => {
  reset(); await save(0, { fullName: "B" }); remote.email = "external@example.com";
  await synchronizeMemberProfile("account");
  assert.equal(remote.email, "external@example.com");
  assert.equal(documents.get(profilePath).email, "external@example.com");
});
test("conflicting external edits to the same field stop the worker", async () => {
  reset(); await save(0, { fullName: "B" }); remote.fullName = "Bản sửa ngoài POS";
  await synchronizeMemberProfile("account");
  assert.equal(documents.get(changePath(ids[0])).status, "NEEDS_ACTION");
  assert.equal(calls.includes("profile"), false);
});
test("a different shop account sharing MID cannot send while the first worker owns the shared lease", async () => {
  reset(); await save(0, { fullName: "B" });
  documents.set("pos_members/other", { ...documents.get(profilePath), remoteUid: "other" });
  documents.set(changePath(ids[1]), { ...documents.get(changePath(ids[0])), memberUid: "other", operationId: ids[1] });
  const originalRead = hk.fetchRemoteMemberByUid;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  hk.fetchRemoteMemberByUid = async () => { entered(); await new Promise(resolve => { release = resolve; }); hk.fetchRemoteMemberByUid = originalRead; return originalRead(); };
  const first = synchronizeMemberProfile("account"); await started;
  await synchronizeMemberProfile("other");
  assert.deepEqual(calls, []);
  release(); await first;
  assert.equal(documents.get(changePath(ids[1])).status, "PENDING");
});
test("shared reads seed a legacy profile without replacing its creation store", async () => {
  reset();
  const stored=documents.get(profilePath);delete stored.profileRevision;
  documents.set(profilePath,{...stored,warehouseId:'creation-store'});
  const remote={uid:'account',mid:'member',memberCode:'CARD',...base,shopId:1,balances:{}};
  const seeded=await service.seedMemberEditProfile(remote,'store','user');
  assert.equal(seeded.warehouseId,'creation-store');
  assert.equal(documents.get(profilePath).warehouseId,'creation-store');
});
test("profile history can be read from an authorized store different from the creation store", async () => {
  reset();await save(0,{fullName:'Tên đã sửa'});
  documents.set(profilePath,{...documents.get(profilePath),warehouseId:'creation-store'});
  const result=await service.fetchMemberProfileHistoryForUser('user',{uid:'account',shopId:1,warehouseId:'store'});
  assert.equal(result.profile.warehouseId,'creation-store');
  assert.equal(result.changes.length,1);
});
test("a forged warehouse or member scope cannot write a local change", async () => {
  reset();
  await assert.rejects(service.updateMemberProfileLocally("user", { ...base, fullName: "B", uid: "account", operationId: ids[0], baseRevision: 0, warehouseId: "other-store", shopId: 1 }, "device"), /không có quyền/);
  await assert.rejects(service.updateMemberProfileLocally("user", { ...base, fullName: "B", uid: "account", operationId: ids[0], baseRevision: 0, warehouseId: "store", shopId: 2 }, "device"), /Cửa hàng HK/);
  assert.equal(documents.get(profilePath).fullName, base.fullName);
  assert.equal(documents.has(changePath(ids[0])), false);
});
