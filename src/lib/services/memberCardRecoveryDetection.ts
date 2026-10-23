import type { CardReadResult } from "./cardReaderService";
import { detectPartnerCardRecovery } from "./partnerCardRecoveryService";
import type { PartnerCardRecoveryMatch } from "@/lib/types/partnerCardRecovery";

export async function detectScannedPartnerCard(card: CardReadResult, shopId: number, warehouseId: string): Promise<PartnerCardRecoveryMatch | null> {
  if (!card.memberCode || !card.cardUuid) return null;
  const input = { shopId, warehouseId, memberCode: card.memberCode, cardUuid: card.cardUuid.toUpperCase() };
  const view = await detectPartnerCardRecovery(input);
  return view ? { input, view } : null;
}
