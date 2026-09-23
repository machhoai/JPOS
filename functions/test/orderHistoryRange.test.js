/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getCurrentVietnamDayRange,
} = require("../lib/order/orderHistoryRange");

test("uses the Asia/Ho_Chi_Minh calendar day for legacy order-history clients", () => {
  assert.deepEqual(
    getCurrentVietnamDayRange(new Date("2026-09-23T17:30:00.000Z")),
    {
      startAt: "2026-09-23T17:00:00.000Z",
      endAt: "2026-09-24T17:00:00.000Z",
    },
  );
});
