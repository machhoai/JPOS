"use client";

import { useEffect, useState } from "react";
import { getVietnamDateInputValue } from "@/lib/utils/orderHistoryDate";

/** Refresh the business date while the app remains open across midnight. */
export function useVietnamToday(): string {
  const [today, setToday] = useState(getVietnamDateInputValue);
  useEffect(() => {
    const refresh = () => setToday(getVietnamDateInputValue());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return today;
}
