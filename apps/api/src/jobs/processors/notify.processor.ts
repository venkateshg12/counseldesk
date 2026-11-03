import { type Job, UnrecoverableError } from "bullmq";
import { z } from "zod";
import { orm } from "../../prisma/db.js";
import { STAFF_NOTIFY_EMAIL } from "../../constants/env.js";
import { pool } from "../../prisma/db.js";
import { JWT_SECRET } from "../../constants/env.js";
import {
  buildIcs,
  getAppointmentCancelledEmail,
  getAppointmentConfirmationEmail,
  getAppointmentReminderEmail,
  getAttorneyAppointmentEmail,
  getLeadAckEmail,
  getNewLeadEmail,
  getPasswordResetEmail,
  manageUrl,
  sendMail,
} from "../../utils/email/index.js";
import { createManageToken } from "../../utils/booking/manageToken.js";
import {
  RESET_TOKEN_TTL_MS,
  createPasswordResetToken,
} from "../../utils/auth/index.js";
import type {
  AppointmentPayload,
  AppointmentReminderPayload,
  LeadAckPayload,
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
  // The assigned attorney gets the lead, with the intake mailbox copied. With nobody assigned it goes
  // to the intake mailbox alone, as before.
  const attorney = lead.assignedAttorneyId
    ? (
        await pool.query<{ email: string }>(
          `SELECT email FROM "Attorney" WHERE id = $1`,
          [lead.assignedAttorneyId],
        )
      ).rows[0]
    : undefined;
  const { error } = await sendMail({
    to: attorney?.email ?? STAFF_NOTIFY_EMAIL,
    cc: attorney ? [STAFF_NOTIFY_EMAIL] : undefined,
    ...email,
  });
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

const idPayloadSchema = z.object({ leadId: z.uuid() });
const appointmentPayloadSchema = z.object({
  appointmentId: z.uuid(),
  linkVersion: z.number().int().positive().optional(),
});

export async function processLeadAck(job: Job<LeadAckPayload>) {
  const parsed = idPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError(
      `Malformed job payload: ${parsed.error.message}`,
    );
  }
  const { rows } = await pool.query<{
    name: string;
    email: string | null;
    attorneyName: string | null;
  }>(
    `SELECT l.name, l.email, a.name AS "attorneyName"
       FROM "Lead" l LEFT JOIN "Attorney" a ON a.id = l."assignedAttorneyId"
      WHERE l.id = $1`,
    [parsed.data.leadId],
  );
  const lead = rows[0];
  // A visitor who only gave a phone number has nowhere to send this.
  if (!lead?.email) return { status: "skipped", reason: "no email" };

  const { error } = await sendMail({
    to: lead.email,
    ...getLeadAckEmail({ name: lead.name, attorneyName: lead.attorneyName }),
  });
  if (error) {
    throw new Error(
      `Lead acknowledgement failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { status: "sent" };
}

type AppointmentRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  caseType: string;
  summary: string | null;
  mode: "video" | "in_person";
  status: string;
  startsAt: Date;
  endsAt: Date;
  linkVersion: number;
  confirmedAt: Date | null;
  attorneyName: string;
  attorneyEmail: string;
};

const loadAppointment = async (job: Job<AppointmentPayload>) => {
  const parsed = appointmentPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError(
      `Malformed job payload: ${parsed.error.message}`,
    );
  }
  const { rows } = await pool.query<AppointmentRow>(
    `SELECT ap.id, ap.name, ap.email, ap.phone, ap."caseType", ap.summary, ap.mode, ap.status,
            ap."startsAt", ap."endsAt", ap."linkVersion", ap."confirmedAt",
            a.name AS "attorneyName", a.email AS "attorneyEmail"
       FROM "Appointment" ap JOIN "Attorney" a ON a.id = ap."attorneyId"
      WHERE ap.id = $1`,
    [parsed.data.appointmentId],
  );
  return { appt: rows[0], payload: parsed.data };
};

const emailInput = (appt: AppointmentRow) => ({
  name: appt.name,
  startsAt: appt.startsAt.toISOString(),
  mode: appt.mode,
  caseType: appt.caseType,
  attorneyName: appt.attorneyName,
});

const throwOnError = (label: string, error: unknown) => {
  if (error) {
    throw new Error(
      `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export async function processAppointmentConfirmation(
  job: Job<AppointmentPayload>,
) {
  const { appt } = await loadAppointment(job);
  if (!appt) return { status: "skipped", reason: "appointment not found" };
  if (appt.status !== "booked")
    return { status: "skipped", reason: "not booked" };
  if (!appt.email) return { status: "skipped", reason: "no email" };
  // Idempotency: a retried job after a successful send does nothing.
  if (appt.confirmedAt) return { status: "skipped", reason: "already sent" };

  const link = manageUrl(
    appt.id,
    createManageToken(JWT_SECRET, appt.id, appt.linkVersion),
  );
  const rescheduled = appt.linkVersion > 1;
  const { error } = await sendMail({
    to: appt.email,
    ...getAppointmentConfirmationEmail(emailInput(appt), link, rescheduled),
    attachments: [
      {
        filename: "consultation.ics",
        contentType: 'text/calendar; method=REQUEST; charset="UTF-8"',
        content: buildIcs({
          uid: appt.id,
          // A higher sequence replaces the earlier invite in the visitor's calendar.
          sequence: appt.linkVersion - 1,
          startsAt: appt.startsAt.toISOString(),
          endsAt: appt.endsAt.toISOString(),
          summary: `Free consultation with ${appt.attorneyName}`,
          description: "Free 30-minute consultation with Harbor & Vale Law.",
          location: appt.mode === "video" ? "Video call" : "Harbor & Vale Law",
          organizer: { email: appt.attorneyEmail, name: appt.attorneyName },
          attendee: { email: appt.email, name: appt.name },
          method: "REQUEST",
        }),
      },
    ],
  });
  throwOnError("Appointment confirmation", error);

  await pool.query(
    `UPDATE "Appointment" SET "confirmedAt" = now() WHERE id = $1`,
    [appt.id],
  );
  return { status: "sent" };
}

export async function processAppointmentAttorneyNotice(
  job: Job<AppointmentPayload>,
) {
  const { appt } = await loadAppointment(job);
  if (!appt) return { status: "skipped", reason: "appointment not found" };
  if (appt.status !== "booked")
    return { status: "skipped", reason: "not booked" };

  const { error } = await sendMail({
    to: appt.attorneyEmail,
    cc: [STAFF_NOTIFY_EMAIL],
    ...getAttorneyAppointmentEmail(
      {
        ...emailInput(appt),
        id: appt.id,
        email: appt.email,
        phone: appt.phone,
        summary: appt.summary,
      },
      appt.linkVersion > 1,
    ),
  });
  throwOnError("Attorney appointment notice", error);
  return { status: "sent" };
}

export async function processAppointmentReminder(
  job: Job<AppointmentReminderPayload>,
) {
  const { appt, payload } = await loadAppointment(job);
  if (!appt) return { status: "skipped", reason: "appointment not found" };
  // A reminder for a time that has since been cancelled or moved is stale.
  if (appt.status !== "booked" || appt.linkVersion !== payload.linkVersion)
    return { status: "skipped", reason: "stale" };
  if (!appt.email) return { status: "skipped", reason: "no email" };

  const link = manageUrl(
    appt.id,
    createManageToken(JWT_SECRET, appt.id, appt.linkVersion),
  );
  const { error } = await sendMail({
    to: appt.email,
    ...getAppointmentReminderEmail(emailInput(appt), link),
  });
  throwOnError("Appointment reminder", error);
  return { status: "sent" };
}

export async function processAppointmentCancelled(
  job: Job<AppointmentPayload>,
) {
  const { appt } = await loadAppointment(job);
  if (!appt) return { status: "skipped", reason: "appointment not found" };
  if (appt.status !== "cancelled")
    return { status: "skipped", reason: "not cancelled" };

  const input = emailInput(appt);
  if (appt.email) {
    const { error } = await sendMail({
      to: appt.email,
      ...getAppointmentCancelledEmail(input, "visitor"),
      attachments: [
        {
          filename: "consultation.ics",
          contentType: 'text/calendar; method=CANCEL; charset="UTF-8"',
          content: buildIcs({
            uid: appt.id,
            // Cancelling bumped the version past the last invite, so this replaces it.
            sequence: appt.linkVersion - 1,
            startsAt: appt.startsAt.toISOString(),
            endsAt: appt.endsAt.toISOString(),
            summary: `Free consultation with ${appt.attorneyName}`,
            organizer: { email: appt.attorneyEmail, name: appt.attorneyName },
            attendee: { email: appt.email, name: appt.name },
            method: "CANCEL",
          }),
        },
      ],
    });
    throwOnError("Cancellation email", error);
  }
  const { error } = await sendMail({
    to: appt.attorneyEmail,
    ...getAppointmentCancelledEmail(input, "attorney"),
  });
  throwOnError("Cancellation notice", error);
  return { status: "sent" };
}
