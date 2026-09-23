export interface OrderHistoryDayRange {
  startAt: string;
  endAt: string;
}

const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VIETNAM_UTC_OFFSET = "+07:00";

export function getVietnamDateInputValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VIETNAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Không thể xác định ngày hiện tại của điểm bán.");
  }
  return `${year}-${month}-${day}`;
}

export function getOrderHistoryDayRange(
  selectedDate: string,
): OrderHistoryDayRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    throw new Error("Ngày xem lịch sử đơn hàng không hợp lệ.");
  }

  const [year, month, day] = selectedDate.split("-").map(Number);
  const start = new Date(`${selectedDate}T00:00:00${VIETNAM_UTC_OFFSET}`);
  const vietnamDate = new Intl.DateTimeFormat("en-US", {
    timeZone: VIETNAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(start);
  const actualYear = Number(vietnamDate.find((part) => part.type === "year")?.value);
  const actualMonth = Number(vietnamDate.find((part) => part.type === "month")?.value);
  const actualDay = Number(vietnamDate.find((part) => part.type === "day")?.value);
  if (
    actualYear !== year ||
    actualMonth !== month ||
    actualDay !== day
  ) {
    throw new Error("Ngày xem lịch sử đơn hàng không tồn tại.");
  }

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

export function formatOrderHistoryDate(selectedDate: string): string {
  const { startAt } = getOrderHistoryDayRange(selectedDate);
  return new Date(startAt).toLocaleDateString("vi-VN", {
    timeZone: VIETNAM_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
