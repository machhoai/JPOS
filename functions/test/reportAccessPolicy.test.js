const test = require("node:test");
const assert = require("node:assert/strict");
const { canReadOrder, canReadOrderRange, canAccessCloseout, isWithinToday } = require("../lib/order/reportAccessPolicy");

const now = new Date("2026-10-29T03:00:00.000Z");
const today = { startAt: "2026-10-28T17:00:00.000Z", endAt: "2026-10-29T17:00:00.000Z" };
const yesterday = { startAt: "2026-10-27T17:00:00.000Z", endAt: today.startAt };
const permissions = (...keys) => ({ store: Object.fromEntries(keys.map((key) => [key, true])) });

test("own orders: only current Vietnam day, authenticated creator, authorized store", () => {
  const grants = permissions("pos.orders.read_own_today");
  assert.equal(canReadOrderRange(grants, "store", today, now), true);
  assert.equal(canReadOrderRange(grants, "store", yesterday, now), false);
  assert.equal(canReadOrderRange(grants, "other", today, now), false);
  for (const [createdBy, createdAt, expected] of [
    ["me", today.startAt, true], ["other", today.startAt, false],
    ["me", yesterday.startAt, false], ["me", today.endAt, false],
    [undefined, today.startAt, false], ["me", "invalid", false],
  ]) assert.equal(canReadOrder(grants, "store", "me", { createdBy, createdAt }, now), expected);
  assert.equal(canReadOrder({}, "store", "me", { createdBy: "me", createdAt: today.startAt }, now), false);
});

test("full order grants include other creators and dates, respecting scoped/global wildcard grants", () => {
  for (const grants of [permissions("pos.orders.read"), permissions("*"), { global: { "pos.orders.read": true } }, { global: { "*": true } }]) {
    assert.equal(canReadOrder(grants, "store", "me", { createdBy: "other", createdAt: yesterday.startAt }, now), true);
    assert.equal(canReadOrderRange(grants, "store", yesterday, now), true);
  }
});

test("own day validation rejects cross-midnight, future, empty and invalid ranges", () => {
  assert.equal(isWithinToday(today, now), true);
  for (const range of [yesterday, { ...today, startAt: yesterday.startAt },
    { startAt: today.startAt, endAt: today.startAt }, { ...today, endAt: "invalid" },
    { ...today, endAt: "2026-10-29T17:00:00.001Z" }]) {
    assert.equal(isWithinToday(range, now), false);
  }
  assert.equal(isWithinToday(today, new Date(today.endAt)), false);
});

test("closeout: full matrix of view/print scopes; printing never expands view access", () => {
  const readKeys = [null, "pos.shift.read_own_today", "pos.shift.close"];
  const printKeys = [null, "pos.shift.print_own_today", "pos.shift.print"];
  const ranges = [
    { ...today, scope: "CURRENT_USER", ownToday: true },
    { ...today, scope: "ALL_USERS", ownToday: false },
    { ...yesterday, scope: "CURRENT_USER", ownToday: false },
    { ...yesterday, scope: "ALL_USERS", ownToday: false },
  ];
  for (const read of readKeys) for (const print of printKeys) for (const range of ranges) {
    const grants = permissions(...[read, print].filter(Boolean));
    const viewAllowed = read === "pos.shift.close" || (read === "pos.shift.read_own_today" && range.ownToday);
    const printAllowed = print === "pos.shift.print" || (print === "pos.shift.print_own_today" && range.ownToday);
    const label = JSON.stringify({ read, print, range });
    assert.equal(canAccessCloseout(grants, "store", range, "VIEW", now), viewAllowed, label);
    assert.equal(canAccessCloseout(grants, "store", range, "PRINT", now), viewAllowed && printAllowed, label);
    assert.equal(canAccessCloseout(grants, "other", range, "VIEW", now), false, label);
  }
});

test("closeout wildcard and global grants retain administrative scope", () => {
  const range = { ...yesterday, scope: "ALL_USERS" };
  assert.equal(canAccessCloseout({ global: { "*": true } }, "store", range, "PRINT", now), true);
  assert.equal(canAccessCloseout(permissions("*"), "store", range, "PRINT", now), true);
  assert.equal(canAccessCloseout({ global: { "pos.shift.close": true, "pos.shift.print": true } }, "store", range, "PRINT", now), true);
  assert.equal(canAccessCloseout(permissions("pos.shift.close"), "store", range, "PRINT", now), false);
});
