import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { assertWarehouseAccess } from "../member/functions";
import { assertMemberShopScope } from "./memberProfileEditService";

export async function searchMemberPhonesForUser(userId: string, data: unknown) {
  const input = data as { shopId?: unknown; warehouseId?: unknown; prefix?: unknown } | null;
  const shopId = Number(input?.shopId);
  const warehouseId = typeof input?.warehouseId === "string" ? input.warehouseId : "";
  const prefix = typeof input?.prefix === "string" ? input.prefix.trim() : "";
  if (!warehouseId || !/^\d{3,15}$/.test(prefix)) throw new HttpsError("invalid-argument", "Nhập ít nhất 3 chữ số để tìm số điện thoại.");
  assertMemberShopScope(shopId);
  await assertWarehouseAccess(userId, warehouseId);
  // Members are shared across POS stores; warehouseId records their origin.
  const [members, pending] = await Promise.all([
    db.collection(POS_COLLECTIONS.members).where("shopId", "==", shopId)
      .orderBy("phone").startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10)
      .select("phone", "fullName", "remoteUid", "hkSnapshot.isEnabled").get(),
    db.collection(POS_COLLECTIONS.memberRegistrations).where("shopId", "==", shopId)
      .where("warehouseId", "==", warehouseId).where("state", "in", ["PREPARED", "HK_IN_FLIGHT", "HK_CONFIRMED", "NEEDS_REVIEW"])
      .orderBy("phone").startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10)
      .select("phone", "fullName", "state").get(),
  ]);
  const suggestions = members.docs.map(doc => {
    const value = doc.data();
    return { uid: doc.id, phone: String(value.phone), fullName: String(value.fullName ?? ""), state: "READY",
      isEnabled: typeof value.hkSnapshot?.isEnabled === "boolean" ? value.hkSnapshot.isEnabled as boolean : null };
  });
  for (const doc of pending.docs) {
    const value = doc.data();
    if (!suggestions.some(item => item.phone === value.phone)) suggestions.push({ uid: doc.id, phone: String(value.phone), fullName: String(value.fullName ?? ""), state: value.state === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "PENDING", isEnabled: null });
  }
  return { suggestions: suggestions.sort((a,b) => a.phone.localeCompare(b.phone) || a.uid.localeCompare(b.uid)).slice(0,10) };
}
