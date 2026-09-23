const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface OrderHistoryRange {
  startAt: string;
  endAt: string;
}

export function getCurrentVietnamDayRange(now = new Date()): OrderHistoryRange {
  const vietnamTime = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS);
  const startTime = Date.UTC(
    vietnamTime.getUTCFullYear(),
    vietnamTime.getUTCMonth(),
    vietnamTime.getUTCDate(),
  ) - VIETNAM_UTC_OFFSET_MS;

  return {
    startAt: new Date(startTime).toISOString(),
    endAt: new Date(startTime + 24 * 60 * 60 * 1000).toISOString(),
  };
}
