"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { readOrderNotificationTarget, type OrderNotificationTarget as NotificationTarget } from "@/features/payments/helpers/orderNotificationLink";

export default function OrderNotificationTarget({ onTarget }: { onTarget: (target: NotificationTarget) => void }) {
  const params = useSearchParams();
  const orderId = params.get("orderId");
  const date = params.get("date");
  const focus = params.get("focus");
  useEffect(() => {
    const target = readOrderNotificationTarget(new URLSearchParams({ orderId: orderId ?? "", date: date ?? "", focus: focus ?? "" }));
    if (target) onTarget(target);
  }, [orderId, date, focus, onTarget]);
  return null;
}
