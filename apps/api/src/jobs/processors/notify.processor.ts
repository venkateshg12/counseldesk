import { type Job, UnrecoverableError } from "bullmq";
import { z } from "zod";
import { orm } from "../../prisma/db.js";
import { STAFF_NOTIFY_EMAIL } from "../../constants/env.js";
import { getNewLeadEmail, sendMail } from "../../utils/email/index.js";
import type { NewLeadPayload } from "../interfaces/jobPayload.js";

const payloadSchema = z.object({ leadId: z.uuid() });

export async function processNewLead(job: Job<NewLeadPayload>) {
  const parsed = payloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError(
      `Malformed job payload: ${parsed.error.message}`,
    );
  }

  const lead = await orm.Lead.where({ id: parsed.data.leadId }).first();
  if (!lead) {
    return { status: "skipped", reason: "lead not found" };
  }
  // Idempotency: a retried or duplicated job after a successful send does nothing.
  if (lead.notifiedAt) {
    return { status: "skipped", reason: "already notified" };
  }

  const email = getNewLeadEmail(lead);
  const { error } = await sendMail({ to: STAFF_NOTIFY_EMAIL, ...email });
  // sendMail returns errors instead of throwing; throwing here is what makes BullMQ retry.
  if (error) {
    throw new Error(
      `Lead email failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await orm.Lead.where({ id: lead.id }).update({
    notifiedAt: new Date().toISOString(),
  });
  return { status: "sent" };
}
