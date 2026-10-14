/** POS display contract: dd/mm/yyyy in every language. Storage remains ISO. */
export type DisplayDateValue = string | number | Date | null | undefined;

export function formatDate(value: DisplayDateValue, options: Intl.DateTimeFormatOptions = {}): string {
    if (value == null || value === "") return "";
    // A calendar date is not an instant: never shift birthdays across time zones.
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-");
        if (!parseDateInputValue(`${day}/${month}/${year}`)) return "";
        return `${day}/${month}/${year}`;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-GB", {
        ...options, day: "2-digit", month: "2-digit", year: "numeric",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
    return `${part("day")}/${part("month")}/${part("year")}`;
}

export function formatDateTime(value: DisplayDateValue, options: Intl.DateTimeFormatOptions = {}): string {
    const date = formatDate(value, options);
    if (!date || value == null) return date;
    const instant = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00`)
        : new Date(value);
    const time = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", second: options.second,
        timeZone: options.timeZone, hour12: false,
    }).format(instant);
    return `${date} ${time}`;
}

export function formatDateInputValue(value: string): string {
    const [date, time] = value.split("T");
    return `${formatDate(date)}${time ? ` ${time.slice(0, 5)}` : ""}`;
}

/** Strictly parse visible input, including leap days, without locale guessing. */
export function parseDateInputValue(value: string, withTime = false): string | null {
    const match = (withTime
        ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/
        : /^(\d{2})\/(\d{2})\/(\d{4})$/).exec(value.trim());
    if (!match) return null;
    const [, day, month, year, hour, minute] = match;
    const iso = `${year}-${month}-${day}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number(year) < 1 || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
    if (withTime && (Number(hour) > 23 || Number(minute) > 59)) return null;
    return withTime ? `${iso}T${hour}:${minute}` : iso;
}
