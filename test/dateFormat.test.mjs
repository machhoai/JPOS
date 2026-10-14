import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatDateInputValue, parseDateInputValue } from "../src/lib/utils/dateFormat.ts";

test("calendar dates preserve their day regardless of display time zone", () => {
    assert.equal(formatDate("1990-05-20", { timeZone: "America/Los_Angeles" }), "20/05/1990");
    assert.equal(formatDate("2026-01-02"), "02/01/2026");
});

test("timestamps retain feature time zones and use 24-hour time", () => {
    const value = "2026-10-13T17:05:09Z";
    assert.equal(formatDateTime(value, { timeZone: "Asia/Ho_Chi_Minh" }), "14/10/2026 00:05");
    assert.equal(formatDateTime(value, { timeZone: "UTC", second: "2-digit" }), "13/10/2026 17:05:09");
});

test("missing or invalid dates do not produce invalid display text", () => {
    for (const value of [null, undefined, "", "invalid", "2026-02-30"]) {
        assert.equal(formatDate(value), "");
        assert.equal(formatDateTime(value), "");
    }
});

test("visible input maps to ISO without interpreting month before day", () => {
    assert.equal(parseDateInputValue("02/01/2026"), "2026-01-02");
    assert.equal(parseDateInputValue("29/02/2024"), "2024-02-29");
    for (const value of ["29/02/2025", "31/04/2026", "10/14/2026", "00/01/2026", "01/00/2026", "01/01/0000"]) {
        assert.equal(parseDateInputValue(value), null);
    }
});

test("datetime inputs round-trip date and time and reject impossible times", () => {
    assert.equal(formatDateInputValue("2026-10-14T08:09"), "14/10/2026 08:09");
    assert.equal(parseDateInputValue("14/10/2026 08:09", true), "2026-10-14T08:09");
    assert.equal(parseDateInputValue("14/10/2026 24:00", true), null);
    assert.equal(parseDateInputValue("14/10/2026 08:60", true), null);
    assert.equal(formatDateInputValue(""), "");
});
