const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../lib/config/firebase");
const auth = require("../lib/services/posAuthService");
const catalog = require("../lib/services/joyworldCatalogService");
const { HttpsError } = require("firebase-functions/v2/https");
const { validateRenewalInput, validateRenewalSearch, hkCalendarDate } = require("../lib/member/renewalPolicy");
const service = require("../lib/services/memberRenewalService");

process.env.HK_API_SHOP_ID = "1";
const input = { uid: "account", shopId: 1, warehouseId: "store", category: 101, delayId: "batch-1", delayDate: "2099-10-31", remark: "Gia hạn theo yêu cầu", operationId: "11111111-1111-4111-8111-111111111111" };
let documents, requests, remoteExpiry, mode, permission, enabled, remoteShop;
class Ref {
  constructor(path) { this.path = path; }
  collection(name) { return new Query(`${this.path}/${name}`); }
  async get() { return snapshot(this.path); }
}
const snapshot = path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) });
class Query {
  constructor(path, filter = null) { this.path = path; this.filter = filter; }
  doc(id) { return new Ref(`${this.path}/${id}`); }
  where(field, op, values) { return new Query(this.path, row => op === "in" && values.includes(row[field])); }
  async get() { return { docs: [...documents.entries()].filter(([path, row]) => path.startsWith(`${this.path}/`) && (!this.filter || this.filter(row))).map(([path]) => snapshot(path)) }; }
}
db.collection = path => new Query(path);
db.runTransaction = async work => {
  const writes = [];
  const result = await work({ get: ref => ref.get(), set: (ref, value) => writes.push(() => documents.set(ref.path, structuredClone(value))),
    update: (ref, value) => writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...structuredClone(value) })), delete: ref => writes.push(() => documents.delete(ref.path)) });
  writes.forEach(write => write()); return result;
};
auth.getPosAuthSession = async () => ({ warehouses: [{ id: "store" }], permissions: { store: { "pos.members.compensate": permission } } });
catalog.getJoyworldManagerAccessToken = async () => "test-token";
catalog.getJoyworldBaseUrl = () => "https://hk.invalid";
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const path = new URL(url).pathname; requests.push({ path, options, url: String(url) });
  let data;
  if (path.endsWith("getdetails")) data = { memberId: "member", memberAcctId: "account", memberCode: "CARD", isEnabled: enabled };
  else if (path.endsWith("getenabledstores") || path.endsWith("timecoinbatch") || path.endsWith("getdelaystores")) {
    const q = new URL(url).searchParams;
    data = path.endsWith("getdelaystores") && (remoteExpiry < q.get("startTime").slice(0, 10) || remoteExpiry > q.get("endTime").slice(0, 10)) ? [] : [{ id: "batch-1", shopId: remoteShop, limitTime: `${remoteExpiry} 23:59:59.999`, amount: 0, limitAmount: 25, enableAmount: 25 }];
  }
  else if (path.endsWith("/delay")) {
    if (mode === "rejected") return new Response(JSON.stringify({ success: false, msg: "Không có quyền trên HK" }), { status: 200 });
    if (mode === "lost-after-success") { remoteExpiry = input.delayDate; throw new Error("connection lost"); }
    if (mode === "lost-before-success") throw new Error("connection lost");
    remoteExpiry = JSON.parse(options.body).delayDate; data = true;
  } else throw new Error(`Unexpected endpoint ${path}`);
  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
};
test.after(() => { global.fetch = originalFetch; });
function reset() {
  documents = new Map([["pos_members/account", { shopId: 1, warehouseId: "store" }]]);
  requests = []; remoteExpiry = "2026-01-01"; mode = "success"; permission = true; enabled = true; remoteShop = 1;
}
const mutations = () => requests.filter(item => item.path.endsWith("/delay"));
const opPath = "pos_members/account/stored_value_renewals/" + input.operationId;

test("rejects impossible dates, OpenAPI category values, unsafe identifiers and empty reasons", () => {
  for (const patch of [{ delayDate: "2027-02-29" }, { delayDate: "31/10/2026" }, { category: 1 }, { delayId: "../batch" }, { remark: " " }, { operationId: "new" }]) assert.throws(() => validateRenewalInput({ ...input, ...patch }));
  assert.equal(validateRenewalInput({ ...input, delayDate: "2028-02-29" }).delayDate, "2028-02-29");
  assert.equal(hkCalendarDate(new Date("2026-10-14T17:30:00Z")), "2026-10-15");
});
test("expired balances use limitAmount and unlimited values are not renewable", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  const rows = service.mapRenewalBatches([{ id: "old", shopId: 1, limitTime: "2026-10-13 23:59:59.999", amount: 0, limitAmount: 42 }, { id: "unlimited", shopId: 1, limitTime: "2150-01-01 23:59:59", amount: 10 }], 101, now);
  assert.equal(rows[0].amount, 42); assert.equal(rows[0].expired, true); assert.equal(rows[1].permanent, true);
  assert.throws(() => service.mapRenewalBatches([{ id: "bad", shopId: 1, limitTime: "unknown", amount: 10 }], 101, now));
});
test("successful renewal sends absolute expiry, keeps amount, and replays without a second write", async () => {
  reset(); await service.renewMemberStoredValueForUser("user", input, "device");
  assert.equal(mutations().length, 1);
  assert.deepEqual(JSON.parse(mutations()[0].options.body), { memberAcctId: "account", delayId: "batch-1", delayDate: input.delayDate, memberCode: "CARD", remark: input.remark });
  assert.equal(mutations()[0].options.headers["JJ-BizCode"], input.operationId);
  assert.equal(documents.get(opPath).status, "SUCCEEDED");
  assert.equal((await service.renewMemberStoredValueForUser("user", input, "device")).idempotentReplay, true);
  assert.equal(mutations().length, 1);
  await assert.rejects(service.renewMemberStoredValueForUser("user", { ...input, remark: "Khác nội dung" }, "device"), /Mã thao tác/);
});
test("lost response after HK success is reconciled by expiry without retransmission", async () => {
  reset(); mode = "lost-after-success";
  await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), HttpsError);
  assert.equal(documents.get(opPath).status, "UNKNOWN");
  const pending = await service.listMemberRenewalBatchesForUser("user", input, "device");
  assert.equal(pending.pending.input.operationId, input.operationId);
  await service.renewMemberStoredValueForUser("user", input, "device");
  assert.equal(mutations().length, 1); assert.equal(documents.get(opPath).status, "SUCCEEDED");
});
test("unknown result blocks both replay and a different operation until reconciled", async () => {
  reset(); mode = "lost-before-success";
  await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"));
  await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /chưa rõ kết quả/);
  await assert.rejects(service.renewMemberStoredValueForUser("user", { ...input, operationId: "22222222-2222-4222-8222-222222222222" }, "device"), /chưa rõ kết quả/);
  assert.equal(mutations().length, 1);
});
test("explicit HK rejection permits a safe retry and releases the batch lock", async () => {
  reset(); mode = "rejected";
  await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /Không có quyền/);
  assert.equal(documents.get(opPath).status, "FAILED");
  mode = "success"; await service.renewMemberStoredValueForUser("user", input, "device");
  assert.equal(mutations().length, 2);
});
test("RBAC, local scope, remote shop and disabled accounts prevent mutation", async () => {
  reset(); permission = false; await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /quyền/); assert.equal(requests.length, 0);
  reset(); documents.get("pos_members/account").warehouseId = "elsewhere"; await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /xác minh/); assert.equal(requests.length, 0);
  reset(); remoteShop = 2; await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /không còn phù hợp/); assert.equal(mutations().length, 0);
  reset(); enabled = false; await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /vô hiệu hóa/); assert.equal(mutations().length, 0);
});
test("completed batch lock rejects a stale preflight that would overwrite a newer expiry", async () => {
  reset();
  documents.set("pos_members/account/stored_value_renewal_locks/batch-1", { status: "SUCCEEDED", delayDate: "2099-11-30", operationId: "other" });
  await assert.rejects(service.renewMemberStoredValueForUser("user", input, "device"), /Hạn sử dụng đã thay đổi/);
  assert.equal(mutations().length, 0);
});
test("search validates dates without imposing a 90-day window", () => {
  assert.deepEqual(validateRenewalSearch({ ...input, startDate: "2015-01-01", endDate: "2015-12-31", page: 2 }), { uid: "account", shopId: 1, warehouseId: "store", category: 101, startDate: "2015-01-01", endDate: "2015-12-31", page: 2, limit: 50 });
  assert.equal(validateRenewalSearch(input).startDate, "2000-01-01");
  for (const patch of [{ startDate: "2026-02-30" }, { startDate: "2026-10-15", endDate: "2026-10-14" }, { page: 0 }, { page: 1.5 }]) assert.throws(() => validateRenewalSearch({ ...input, ...patch }));
});
test("search sends native expiry range and pagination to getdelaystores", async () => {
  const calls = [];
  const result = await service.searchRemoteRenewalBatches({ uid: "account", shopId: 1, category: 101, startDate: "2015-01-01", endDate: "2015-12-31", page: 2, limit: 50 }, async request => {
    calls.push(request); return { items: [], totalRecords: 75 };
  });
  assert.equal(calls[0].path, "/member/cashier/memberstore/getdelaystores");
  assert.deepEqual(calls[0].query, { memberAcctId: "account", category: "101", startTime: "2015-01-01 00:00:00", endTime: "2015-12-31 23:59:59", page: "2", limit: "50" });
  assert.equal(result.totalRecords, 75); assert.equal(result.hasMore, false);
});
test("a historical search result is revalidated by original expiry and reconciles by new expiry", async () => {
  reset(); mode = "lost-after-success";
  const historical = { ...input, originalExpiryDate: "2026-01-01" };
  await assert.rejects(service.renewMemberStoredValueForUser("user", historical, "device"));
  await service.renewMemberStoredValueForUser("user", historical, "device");
  assert.equal(mutations().length, 1);
  assert.equal(requests.some(item => item.path.endsWith("getenabledstores")), false);
  assert.equal(documents.get(opPath).status, "SUCCEEDED");
});
test("HK's unpaginated array is paginated locally when the server omits totals", async () => {
  const rows = Array.from({ length: 75 }, (_, index) => ({ id: `batch-${index}`, shopId: 1, limitTime: "2015-06-01 23:59:59", amount: 0, limitAmount: 10 }));
  const result = await service.searchRemoteRenewalBatches({ uid: "account", shopId: 1, category: 101, startDate: "2015-01-01", endDate: "2015-12-31", page: 2, limit: 50 }, async () => ({ items: rows }));
  assert.equal(result.batches.length, 25); assert.equal(result.batches[0].id, "batch-50");
  assert.equal(result.totalRecords, 75); assert.equal(result.hasMore, false);
});
