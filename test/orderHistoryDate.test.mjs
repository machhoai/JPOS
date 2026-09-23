import test from "node:test";
import assert from "node:assert/strict";
import {
  getVietnamDateInputValue,
  getOrderHistoryDayRange,
} from "../src/lib/utils/orderHistoryDate.ts";

test("formats the Vietnam date for the native date input", () => {
  assert.equal(
    getVietnamDateInputValue(new Date("2026-09-23T17:30:00.000Z")),
    "2026-09-24",
  );
});

test("builds an exclusive one-day range in Vietnam time", () => {
  const range = getOrderHistoryDayRange("2026-09-23");
  assert.deepEqual(range, {
    startAt: "2026-09-22T17:00:00.000Z",
    endAt: "2026-09-23T17:00:00.000Z",
  });
});

test("rejects impossible calendar dates", () => {
  assert.throws(
    () => getOrderHistoryDayRange("2026-02-30"),
    /không tồn tại/,
  );
});
