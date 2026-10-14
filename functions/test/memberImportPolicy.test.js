/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeImportRow, importHash, importShard, memberImportPatch } = require("../lib/member/memberImportPolicy");
const { encodeFields, decodeFields } = require("../lib/services/memberImportFirestore");
const row = { memberAcctId: "acct-001", memberId: "member-001", shopId: 20692, realName: "Khách HK", phone: "0900000000", sex: 1, birthday: "1995-01-01 00:00:00.000", nickName: "Khách", address: "Địa chỉ HK", nativeCoin1: 50, memberCardList: [{ memberCode: "CARD-001", serialNo: "001234" }] };
test("rejects wrong-shop, missing and unsafe account IDs", () => {
  for (const patch of [{ shopId: 1 }, { memberAcctId: "a/b" }, { memberAcctId: undefined }]) assert.throws(() => normalizeImportRow({ ...row, ...patch }, 20692));
});
test("hash is deterministic across object key order but detects balances and card changes", () => {
  assert.equal(importHash(row), importHash(Object.fromEntries(Object.entries(row).reverse())));
  assert.notEqual(importHash(row), importHash({ ...row, nativeCoin1: 51 }));
  assert.notEqual(importHash(row), importHash({ ...row, memberCardList: [] }));
  assert.ok(importShard(row.memberAcctId) >= 0 && importShard(row.memberAcctId) < 16);
});
test("new members retain every list field and do not invent email", () => {
  const patch = memberImportPatch(row, null, "warehouse-1", "2026-10-13");
  assert.equal(patch.remoteUid, "acct-001"); assert.equal(patch.mid, "member-001");
  assert.equal(patch.phone, "0900000000"); assert.equal(patch.memberCode, "CARD-001");
  assert.equal(patch.email, null); assert.deepEqual(patch.hkSnapshot, row);
  assert.equal(patch.profileRevision, undefined);
});

test("card reordering does not change hash or mutate the raw source; card edits do", () => {
  const cards = [{ memberCode: "B", serialNo: "2" }, { memberCode: "A", serialNo: "1" }];
  const source = { ...row, memberCardList: cards };
  const before = JSON.stringify(source);
  const reversed = { ...row, memberCardList: [...cards].reverse() };
  assert.equal(importHash(source), importHash(reversed));
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(memberImportPatch(source, null, "warehouse-1", "2026-10-14").hkSnapshot.memberCardList, cards);
  assert.notEqual(importHash(source), importHash({ ...source, memberCardList: [cards[0], { ...cards[1], serialNo: "3" }] }));
});
test("existing pending profile, email, revisions and leases are never replaced", () => {
  const existing = { remoteUid: "acct-001", shopId: 20692, warehouseId: "warehouse-1", fullName: "Tên vừa sửa", phone: "0900000001", email: "local@example.com", profileRevision: 4, remoteConfirmedRevision: 2, syncStatus: "PENDING", syncLease: { token: "worker" } };
  const patch = memberImportPatch(row, existing, "warehouse-1", "2026-10-13");
  for (const key of ["fullName", "phone", "email", "profileRevision", "remoteConfirmedRevision", "syncStatus", "syncLease", "updatedAt", "memberCode"]) assert.equal(key in patch, false);
});
test("matching hash alone is insufficient: a missing or altered snapshot must be repaired", () => {
  const existing = { remoteUid: "acct-001", shopId: 20692, warehouseId: "warehouse-1", hkImportHash: importHash(row), hkSnapshot: row };
  assert.equal(memberImportPatch(row, existing, "warehouse-1", "2026-10-13"), null);
  assert.ok(memberImportPatch(row, { ...existing, hkSnapshot: null }, "warehouse-1", "2026-10-13"));
  assert.ok(memberImportPatch(row, { ...existing, hkSnapshot: { ...row, address: "Khác" } }, "warehouse-1", "2026-10-13"));
});
test("existing warehouse ownership is preserved while a different HK shop is rejected", () => {
  assert.throws(() => memberImportPatch(row, { remoteUid: "acct-001", shopId: 1, warehouseId: "other" }, "warehouse-1", "2026-10-13"));
});
test("Firestore encoding preserves zero, null, Vietnamese text, arrays and source nesting", () => {
  const data = { snapshot: row, count: 0, empty: null, value: 0.5, enabled: false };
  assert.deepEqual(decodeFields(encodeFields(data)), data);
});
