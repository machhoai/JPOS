/* Explicit project required; defaults to a read-only preview. No PayOS calls. */
const projectId = process.argv.find((arg) => arg.startsWith('--project='))?.slice(10);
if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId)) {
  throw Error('Usage: node scripts/backfill-payos-reconciliation.cjs --project=PROJECT_ID [--apply]');
}
process.env.GCLOUD_PROJECT = projectId;
const apply = process.argv.includes('--apply');
const { db } = require('../functions/lib/config/firebase');
const { POS_COLLECTIONS } = require('../functions/lib/config/collections');
const { confirmedPayOSAttempt, needsPayOSReconciliation, payOSReconciliationDueAt } = require('../functions/lib/payment/payosReconciliationPolicy');
const { markPayOSPaymentPaid } = require('../functions/lib/payment/payosFunctions');

async function main() {
  let cursor;
  const counts = { mode: apply ? 'apply' : 'preview', projectId, inspected: 0, repaired: 0, initialized: 0, skipped: 0 };
  while (true) {
    let query = db.collection(POS_COLLECTIONS.orders).where('paymentVerificationStatus', '==', 'UNVERIFIED').orderBy('__name__').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      const order = doc.data();
      counts.inspected++;
      if (!needsPayOSReconciliation(order)) { counts.skipped++; continue; }
      const attempt = confirmedPayOSAttempt(order);
      if (attempt) {
        counts.repaired++;
        if (apply) await markPayOSPaymentPaid(doc.ref, attempt.orderCode, {
          code: '00', orderCode: attempt.orderCode, amount: attempt.paidAmount,
          currency: attempt.currency ?? 'VND', paymentLinkId: attempt.paymentLinkId,
          confirmationSource: attempt.confirmationSource, reference: attempt.reference,
          transactionDateTime: attempt.transactionDateTime,
        });
      } else if (!order.payosReconciliation) {
        counts.initialized++;
        if (apply) await db.runTransaction(async (transaction) => {
          const current = (await transaction.get(doc.ref)).data();
          if (!needsPayOSReconciliation(current) || current.payosReconciliation) return;
          const dueAt = payOSReconciliationDueAt(current) ?? new Date().toISOString();
          transaction.update(doc.ref, { payosReconciliation: { dueAt, nextCheckAt: dueAt } });
        });
      }
    }
    cursor = page.docs.at(-1);
  }
  console.log(JSON.stringify(counts, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
