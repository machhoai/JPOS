import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFunctions } from "firebase-admin/functions";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import { processRegistration } from "../services/memberRegistrationService";

export const onMemberRegistrationCreated = onDocumentCreated({
  document: `${POS_COLLECTIONS.memberRegistrations}/{registrationId}`,
  region: "asia-southeast1", retry: true, timeoutSeconds: 60,
}, async event => {
  const ref = db.collection(POS_COLLECTIONS.memberRegistrations).doc(event.params.registrationId);
  const data = (await ref.get()).data();
  if (!data || data.state === "COMPLETED" || data.state === "NEEDS_REVIEW") return;
  // Event retries may enqueue duplicates; transaction lease/state guards make
  // duplicate delivery safe. Delay gives the foreground call time to finish.
  await getFunctions().taskQueue("locations/asia-southeast1/functions/recoverMemberRegistration")
    .enqueue({ registrationId: event.params.registrationId }, { scheduleDelaySeconds: 120, dispatchDeadlineSeconds: 300 });
});

export const recoverMemberRegistration = onTaskDispatched({
  region: "asia-southeast1", timeoutSeconds: 300,
  retryConfig: { maxAttempts: 6, minBackoffSeconds: 60, maxBackoffSeconds: 600, maxDoublings: 3 },
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
}, async request => {
  const id = request.data?.registrationId;
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return;
  const current = await db.collection(POS_COLLECTIONS.memberRegistrations).doc(id).get();
  if (!current.exists || ["COMPLETED", "NEEDS_REVIEW"].includes(current.data()?.state)) return;
  try { await processRegistration(id, true); }
  catch (error) {
    if (error instanceof HttpsError && error.code === "failed-precondition") return;
    throw error;
  }
});
