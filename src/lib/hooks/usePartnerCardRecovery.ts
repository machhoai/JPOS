"use client";
import { useEffect, useRef, useState } from "react";
import { cancelMemberCardRead, readMemberCard } from "@/lib/services/cardReaderService";
import { fetchPartnerCardRecovery } from "@/lib/services/partnerCardRecoveryService";
import type { PartnerCardRecoveryInput, PartnerCardRecoveryView } from "@/lib/types/partnerCardRecovery";

export function usePartnerCardRecovery(shopId: number, warehouseId: string, initial?: { view: PartnerCardRecoveryView; input: PartnerCardRecoveryInput }) {
  const [view, setView] = useState<PartnerCardRecoveryView | null>(initial?.view ?? null);
  const [input, setInput] = useState<PartnerCardRecoveryInput | null>(initial?.input ?? null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const scope = `${shopId}:${warehouseId}`;
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  const active = view?.state === "QUEUED" || view?.state === "RUNNING";
  useEffect(() => () => { attempt.current++; void cancelMemberCardRead(); }, [scope]);
  useEffect(() => {
    if (!active || !input) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await fetchPartnerCardRecovery("fetchPartnerCardRecovery", input);
        if (!stopped) { setView(result); setError(null); }
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : "Chưa tải được tiến độ. Hệ thống vẫn tiếp tục xử lý."); }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, input]);
  async function read() {
    const current = ++attempt.current, capturedScope = scope;
    setBusy(true); setError(null); setView(null); setInput(null);
    try {
      const card = await readMemberCard(20000);
      if (!card.memberCode || !card.cardUuid) throw new Error("Đầu đọc chưa trả đủ mã thẻ và chip.");
      const request = { shopId, warehouseId, memberCode: card.memberCode, cardUuid: card.cardUuid.toUpperCase() };
      const result = await fetchPartnerCardRecovery("previewPartnerCardRecovery", request);
      if (current !== attempt.current || capturedScope !== scopeRef.current) return;
      setInput(request); setView(result);
    } catch (e) { if (current === attempt.current) setError(e instanceof Error ? e.message : "Không đọc được thẻ."); }
    finally { if (current === attempt.current) setBusy(false); }
  }
  async function confirm() {
    if (!input || !view?.previewToken || busy || active) return;
    const current = ++attempt.current; setBusy(true); setError(null);
    try {
      // Re-read the same physical card immediately before sending confirmation.
      const card = await readMemberCard(20000, view.dynamicSerialNo ?? undefined);
      if (card.memberCode !== input.memberCode || card.cardUuid?.toUpperCase() !== input.cardUuid) throw new Error("Thẻ đã thay đổi. Hãy giữ đúng thẻ đối tác trên đầu đọc.");
      const result = await fetchPartnerCardRecovery("confirmPartnerCardRecovery", { ...input, previewToken: view.previewToken });
      if (current === attempt.current) setView(result);
    } catch (e) {
      if (current === attempt.current) {
        setError(e instanceof Error ? e.message : "Chưa nhận được xác nhận.");
        // The request may have reached the server: reconcile instead of replaying a mutation.
        try { const result = await fetchPartnerCardRecovery("fetchPartnerCardRecovery", input); if (current === attempt.current) setView(result); } catch { /* Allow a fresh read to reconcile later. */ }
      }
    } finally { if (current === attempt.current) setBusy(false); }
  }
  return { view, busy, active, error: error ?? view?.error ?? null, read, confirm };
}
