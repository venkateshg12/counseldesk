import { type Job, UnrecoverableError } from "bullmq";
import { z } from "zod";
import { orm } from "../../prisma/db.js";
import { STAFF_NOTIFY_EMAIL } from "../../constants/env.js";
import {
  getNewLeadEmail,
  getPasswordResetEmail,
  sendMail,
} from "../../utils/email/index.js";
import {
  RESET_TOKEN_TTL_MS,
  createPasswordResetToken,
} from "../../utils/auth/index.js";
import type {
  NewLeadPayload,
  PasswordResetPayload,
} from "../interfaces/jobPayload.js";

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

const passwordResetPayloadSchema = z.object({
  userId: z.uuid(),
  issuedAt: z.number().int().positive(),
});

export async function processPasswordReset(job: Job<PasswordResetPayload>) {
  const parsed = passwordResetPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError(
      `Malformed job payload: ${parsed.error.message}`,
    );
  }
  const { userId, issuedAt } = parsed.data;

  // A job that sat in the queue (a Redis outage, retries) past the link's life would mail a link
  // that is already dead.
  if (Date.now() - issuedAt > RESET_TOKEN_TTL_MS) {
    return { status: "skipped", reason: "expired" };
  }

  const user = await orm.User.where({ id: userId }).first();
  if (!user) {
    return { status: "skipped", reason: "user not found" };
  }

  // The link is rebuilt here from the user's current hash, so it never travelled through Redis.
  const token = createPasswordResetToken(user.id, user.passwordHash, issuedAt);
  const { error } = await sendMail({
    to: user.email,
    ...getPasswordResetEmail(user, token),
  });
  // Throwing is what makes BullMQ retry.
  if (error) {
    throw new Error(
      `Password reset email failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
    );
  }
  return { status: "sent" };
}
