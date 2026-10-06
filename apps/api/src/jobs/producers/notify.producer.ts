import { JOB_NAMES } from "../../constants/queue.js";
import type { NewLeadPayload } from "../interfaces/jobPayload.js";
import { notifyQueue } from "../queues/notify.queue.js";

export const enqueueNewLeadEmail = (payload: NewLeadPayload) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.NEW_LEAD, payload, {
    // Deduplicates: a second call for the same lead queues nothing.
    jobId: `lead:${payload.leadId}:email`,
  });
