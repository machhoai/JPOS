"use client";
import { lazy, Suspense } from "react";
import type { PartnerCardRecoveryMatch, PartnerCardRecoveryView } from "@/lib/types/partnerCardRecovery";
const Modal = lazy(() => import("./PartnerCardRecoveryModal"));
interface Props { match: PartnerCardRecoveryMatch; onClose: () => void; onOpenMember: (view: PartnerCardRecoveryView) => void }
export default function PartnerCardRecoveryDialog({ match, onClose, onOpenMember }: Props) {
  return <Suspense fallback={<p role="status">Đang đối chiếu thẻ đối tác...</p>}><Modal shopId={match.input.shopId} warehouseId={match.input.warehouseId} initial={match} onClose={onClose} onOpenMember={onOpenMember}/></Suspense>;
}
