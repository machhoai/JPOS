import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { importHash, importShard, type HKImportRow } from "./memberImportPolicy";

// Other member writers may still use older deployments that replace documents.
// Invalidate the cache if they remove/change the imported snapshot without a
// matching hash, or delete the member. Never restore over the employee's fields.
export const onMemberImportCacheChanged = onDocumentWritten({
  document: `${POS_COLLECTIONS.members}/{memberUid}`, region: "asia-southeast1", timeoutSeconds: 60,
}, async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before?.hkImportHash && !after?.hkImportHash) return;
  if (after?.hkSnapshot && after.hkImportHash === importHash(after.hkSnapshot as HKImportRow)) return;
  const shopId = Number(before?.shopId ?? after?.shopId);
  if (!Number.isInteger(shopId)) return;
  const uid = event.params.memberUid;
  const ref = db.collection(POS_COLLECTIONS.memberImportState).doc(`${shopId}-shard-${importShard(uid)}`);
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const hash = current.data()?.hashes?.[uid];
    // Do not let a delayed invalidation event remove a newer import's hash.
    if (!hash || hash !== before?.hkImportHash) return;
    tx.update(ref, new FieldPath("hashes", uid), FieldValue.delete());
  });
});

