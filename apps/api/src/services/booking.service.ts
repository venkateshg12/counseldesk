import crypto from "node:crypto";
import type {
  AppointmentMode,
  AppointmentView,
  CaseType,
  CreateAppointmentInput,
  CreatedAppointment,
  Slot,
  SlotsResponse,
} from "@repo/types";
import { pool } from "../prisma/db.js";
import { redisConnection } from "../jobs/redis/connection.js";
import { JWT_SECRET } from "../constants/env.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import {
  BAD_REQUEST,
  CONFLICT,
  FORBIDDEN,
  NOT_FOUND,
} from "../constants/http.js";
import { AppError, appAssert } from "../utils/errors/index.js";
import { isUniqueViolation } from "../utils/db.js";
import { logger } from "../utils/logger.js";
import {
  FIRM_TIME_ZONE,
  generateSlots,
  isBookableStart,
  SLOT_MINUTES,
  type WeeklyRule,
} from "../utils/booking/slots.js";
import {
  appointmentIdFromToken,
  createManageToken,
  verifyManageToken,
} from "../utils/booking/manageToken.js";
import {
  enqueueAppointmentAttorneyNotice,
  enqueueAppointmentCancelled,
  enqueueAppointmentConfirmation,
  enqueueAppointmentReminder,
  removeAppointmentReminder,
} from "../jobs/producers/notify.producer.js";
import { pickAttorney } from "./assignment.service.js";

const HOLD_TTL_MS = 5 * 60 * 1000;
const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000;

/* ---------- Availability ---------- */

const holdKey = (attorneyId: string, startsAtIso: string) =>
  `slot-hold:${attorneyId}:${startsAtIso}`;

const normalize = (iso: string) => new Date(iso).toISOString();

export const loadRules = async (attorneyId: string): Promise<WeeklyRule[]> => {
  const { rows } = await pool.query<WeeklyRule>(
    `SELECT weekday, "startMinute", "endMinute" FROM "AvailabilityRule" WHERE "attorneyId" = $1`,
    [attorneyId],
  );
  return rows;
};

// Starts that can't be offered: already booked, or held by someone filling in the form right now.
const loadUnavailable = async (attorneyId: string): Promise<Set<string>> => {
  const [booked, held] = await Promise.all([
    pool.query<{ startsAt: Date }>(
      `SELECT "startsAt" FROM "Appointment" WHERE "attorneyId" = $1 AND status = 'booked' AND "startsAt" > now()`,
      [attorneyId],
    ),
    scanHeld(attorneyId),
  ]);
  return new Set([
    ...booked.rows.map((r) => r.startsAt.toISOString()),
    ...held,
  ]);
};

const scanHeld = async (attorneyId: string): Promise<string[]> => {
  const prefix = holdKey(attorneyId, "");
  const starts: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redisConnection.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      100,
    );
    cursor = next;
    starts.push(...keys.map((key) => key.slice(prefix.length)));
  } while (cursor !== "0");
  return starts;
};

export const listSlotsForAttorney = async (
  attorneyId: string,
  now = new Date(),
): Promise<Slot[]> => {
  const [rules, unavailable] = await Promise.all([
    loadRules(attorneyId),
    loadUnavailable(attorneyId),
  ]);
  return generateSlots({ rules, now, unavailable });
};

export const listSlots = async (
  caseType: CaseType,
  attorneyId?: string,
): Promise<SlotsResponse> => {
  let attorney: { id: string; name: string; slug: string } | null = null;
  if (attorneyId) {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      slug: string;
    }>(`SELECT id, name, slug FROM "Attorney" WHERE id = $1 AND active`, [
      attorneyId,
    ]);
    attorney = rows[0] ?? null;
  } else {
    attorney = await pickAttorney(caseType);
  }
  appAssert(
    attorney,
    NOT_FOUND,
    "No attorney is available for that type of case right now",
    appErrorCode.NoAttorneyAvailable,
  );
  return {
    attorney: { id: attorney.id, name: attorney.name, slug: attorney.slug },
    timeZone: FIRM_TIME_ZONE,
    slots: await listSlotsForAttorney(attorney.id),
  };
};

/* ---------- Holds ---------- */

/*
  A hold keeps a slot for five minutes while the visitor fills in the form, so two people can't both
  type their details into the same slot. It is a Redis key set only if absent (SET NX): the first
  caller gets a random token, everyone else is told the slot is taken. The hold is a convenience;
  the real guarantee against double-booking is the unique index on Appointment.slotKey.
 */
export const createHold = async (attorneyId: string, startsAt: string) => {
  const start = normalize(startsAt);
  const [rules, unavailableBooked] = await Promise.all([
    loadRules(attorneyId),
    loadBookedStarts(attorneyId),
  ]);
  appAssert(
    isBookableStart(rules, start, new Date(), unavailableBooked),
    CONFLICT,
    "That time is no longer available",
    appErrorCode.SlotUnavailable,
  );

  const holdToken = crypto.randomBytes(18).toString("base64url");
  const stored = await redisConnection.set(
    holdKey(attorneyId, start),
    holdToken,
    "PX",
    HOLD_TTL_MS,
    "NX",
  );
  appAssert(
    stored === "OK",
    CONFLICT,
    "Someone else is booking that time. Please pick another.",
    appErrorCode.SlotTaken,
  );
  return {
    holdToken,
    expiresAt: new Date(Date.now() + HOLD_TTL_MS).toISOString(),
  };
};

const loadBookedStarts = async (attorneyId: string) => {
  const { rows } = await pool.query<{ startsAt: Date }>(
    `SELECT "startsAt" FROM "Appointment" WHERE "attorneyId" = $1 AND status = 'booked' AND "startsAt" > now()`,
    [attorneyId],
  );
  return new Set(rows.map((r) => r.startsAt.toISOString()));
};

const holdIsValid = async (
  attorneyId: string,
  startsAt: string,
  holdToken: string,
) => (await redisConnection.get(holdKey(attorneyId, startsAt))) === holdToken;

const releaseHold = (attorneyId: string, startsAt: string) =>
  redisConnection.del(holdKey(attorneyId, startsAt)).catch(() => undefined);

/* ---------- Appointments ---------- */

type AppointmentRow = {
  id: string;
  attorneyId: string;
  status: AppointmentView["status"];
  startsAt: Date;
  endsAt: Date;
  mode: AppointmentMode;
  caseType: CaseType;
  linkVersion: number;
  attorneyName: string;
  attorneySlug: string;
};

const SELECT_VIEW = `
  SELECT ap.id, ap."attorneyId", ap.status, ap."startsAt", ap."endsAt", ap.mode, ap."caseType",
         ap."linkVersion", a.name AS "attorneyName", a.slug AS "attorneySlug"
    FROM "Appointment" ap JOIN "Attorney" a ON a.id = ap."attorneyId"`;

const toView = (row: AppointmentRow): AppointmentView => ({
  id: row.id,
  status: row.status,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  mode: row.mode,
  caseType: row.caseType,
  attorney: {
    id: row.attorneyId,
    name: row.attorneyName,
    slug: row.attorneySlug,
  },
});

const fetchView = async (id: string) => {
  const { rows } = await pool.query<AppointmentRow>(
    `${SELECT_VIEW} WHERE ap.id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

const queueAppointmentEmails = async (
  appointmentId: string,
  version: number,
  startsAt: Date,
) => {
  try {
    const reminderDelay = startsAt.getTime() - REMINDER_BEFORE_MS - Date.now();
    await Promise.all([
      enqueueAppointmentConfirmation({ appointmentId }, version),
      enqueueAppointmentAttorneyNotice({ appointmentId }, version),
      // Booked less than a day ahead: the confirmation is reminder enough.
      reminderDelay > 0
        ? enqueueAppointmentReminder(
            { appointmentId, linkVersion: version },
            reminderDelay,
          )
        : undefined,
    ]);
  } catch (error) {
    // The appointment is saved; it is visible in the staff portal even if the emails are late.
    logger.error("failed to queue appointment emails", {
      error,
      appointmentId,
    });
  }
};

type BookInput = {
  attorneyId: string;
  startsAt: string;
  name: string;
  email: string | null;
  phone?: string | null;
  caseType: CaseType;
  summary?: string | null;
  mode: AppointmentMode;
  leadId?: string | null;
  conversationId?: string | null;
};

/*
  Inserts the appointment. The start must be one of the attorney's real slots, and the unique
  slotKey makes Postgres refuse a second booking of it even if two requests race past every check.
 */
const bookSlot = async (input: BookInput): Promise<CreatedAppointment> => {
  const startsAt = normalize(input.startsAt);
  const { rows: attorneys } = await pool.query<{ id: string }>(
    `SELECT id FROM "Attorney" WHERE id = $1 AND active`,
    [input.attorneyId],
  );
  appAssert(attorneys[0], NOT_FOUND, "Attorney not found");

  const [rules, booked] = await Promise.all([
    loadRules(input.attorneyId),
    loadBookedStarts(input.attorneyId),
  ]);
  appAssert(
    isBookableStart(rules, startsAt, new Date(), booked),
    CONFLICT,
    "That time is no longer available",
    appErrorCode.SlotUnavailable,
  );

  const endsAt = new Date(
    new Date(startsAt).getTime() + SLOT_MINUTES * 60_000,
  ).toISOString();

  let row: { id: string; linkVersion: number };
  try {
    const result = await pool.query<{ id: string; linkVersion: number }>(
      `INSERT INTO "Appointment"
         (id, "attorneyId", "leadId", "conversationId", name, email, phone, "caseType", summary, mode,
          "startsAt", "endsAt", "slotKey")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, "linkVersion"`,
      [
        input.attorneyId,
        input.leadId ?? null,
        input.conversationId ?? null,
        input.name,
        input.email,
        input.phone ?? null,
        input.caseType,
        input.summary ?? null,
        input.mode,
        startsAt,
        endsAt,
        `${input.attorneyId}|${startsAt}`,
      ],
    );
    row = result.rows[0]!;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        CONFLICT,
        "Someone just booked that time. Please pick another.",
        appErrorCode.SlotTaken,
      );
    }
    throw error;
  }

  await queueAppointmentEmails(row.id, row.linkVersion, new Date(startsAt));
  const view = toView((await fetchView(row.id))!);
  return {
    ...view,
    manageToken: createManageToken(JWT_SECRET, row.id, row.linkVersion),
  };
};

export const createAppointment = async (
  input: CreateAppointmentInput,
): Promise<CreatedAppointment> => {
  const startsAt = normalize(input.startsAt);
  appAssert(
    await holdIsValid(input.attorneyId, startsAt, input.holdToken),
    CONFLICT,
    "Your reservation expired. Please pick a time again.",
    appErrorCode.SlotUnavailable,
  );
  const created = await bookSlot({
    ...input,
    startsAt,
    email: input.email,
    phone: input.phone ?? null,
    summary: input.summary ?? null,
  });
  await releaseHold(input.attorneyId, startsAt);
  return created;
};

/*
  Books the slot a visitor tapped in the chat. Nothing about the person comes from the request: the
  name and contact details are the ones the assistant already saved on the lead, and the attorney is
  the one assigned to it. The model never handles booking data.
 */
export const bookFromChat = async ({
  conversationId,
  visitorId,
  startsAt,
  mode,
}: {
  conversationId: string;
  visitorId: string;
  startsAt: string;
  mode: AppointmentMode;
}): Promise<CreatedAppointment> => {
  const { rows } = await pool.query<{
    leadId: string;
    name: string;
    email: string | null;
    phone: string | null;
    caseType: CaseType;
    summary: string | null;
    assignedAttorneyId: string | null;
  }>(
    `SELECT l.id AS "leadId", l.name, l.email, l.phone, l."caseType", l.summary, l."assignedAttorneyId"
       FROM "Conversation" c JOIN "Lead" l ON l."conversationId" = c.id
      WHERE c.id = $1 AND c."visitorId" = $2`,
    [conversationId, visitorId],
  );
  const lead = rows[0];
  appAssert(
    lead,
    NOT_FOUND,
    "Share your details with the assistant first, then pick a time.",
  );
  appAssert(
    lead.assignedAttorneyId,
    CONFLICT,
    "No attorney is assigned yet",
    appErrorCode.NoAttorneyAvailable,
  );

  // Tapping twice, or a retry, returns the appointment that already exists.
  const existing = await pool.query<AppointmentRow>(
    `${SELECT_VIEW} WHERE ap."conversationId" = $1 AND ap.status = 'booked'`,
    [conversationId],
  );
  if (existing.rows[0]) {
    return {
      ...toView(existing.rows[0]),
      manageToken: createManageToken(
        JWT_SECRET,
        existing.rows[0].id,
        existing.rows[0].linkVersion,
      ),
    };
  }

  await createHold(lead.assignedAttorneyId, startsAt);
  const created = await bookSlot({
    attorneyId: lead.assignedAttorneyId,
    startsAt,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    caseType: lead.caseType,
    summary: lead.summary,
    mode,
    leadId: lead.leadId,
    conversationId,
  }).finally(
    () => void releaseHold(lead.assignedAttorneyId!, normalize(startsAt)),
  );
  return created;
};

/* ---------- Manage links ---------- */

// Loads the appointment a manage link points at, or refuses. The same answer for a missing
// appointment, a stale link and a wrong signature, so a guesser learns nothing.
const loadForToken = async (id: string, token: string) => {
  const refuse = () =>
    new AppError(
      FORBIDDEN,
      "This link is no longer valid. Contact the firm to change your appointment.",
      appErrorCode.InvalidBookingLink,
    );
  if (appointmentIdFromToken(token) !== id) throw refuse();
  const row = await fetchView(id);
  if (
    !row ||
    row.status !== "booked" ||
    !verifyManageToken(JWT_SECRET, token, id, row.linkVersion)
  ) {
    throw refuse();
  }
  return row;
};

export const getAppointmentByToken = async (
  id: string,
  token: string,
): Promise<AppointmentView> => toView(await loadForToken(id, token));

const cancelRow = async (id: string, version: number) => {
  const { rows } = await pool.query<{ linkVersion: number }>(
    `UPDATE "Appointment"
        SET status = 'cancelled', "cancelledAt" = now(), "slotKey" = NULL, "linkVersion" = "linkVersion" + 1
      WHERE id = $1 AND status = 'booked' AND "linkVersion" = $2
      RETURNING "linkVersion"`,
    [id, version],
  );
  if (!rows[0]) return false;
  await removeAppointmentReminder(id, version);
  await enqueueAppointmentCancelled(
    { appointmentId: id },
    rows[0].linkVersion,
  ).catch((error: unknown) =>
    logger.error("failed to queue cancellation email", { error, id }),
  );
  return true;
};

export const cancelByToken = async (id: string, token: string) => {
  const row = await loadForToken(id, token);
  // The compare-and-swap on linkVersion means a double click cancels once.
  appAssert(
    await cancelRow(id, row.linkVersion),
    FORBIDDEN,
    "This link is no longer valid.",
    appErrorCode.InvalidBookingLink,
  );
};

export const cancelAsStaff = async (id: string) => {
  const row = await fetchView(id);
  appAssert(row, NOT_FOUND, "Appointment not found");
  appAssert(row.status === "booked", BAD_REQUEST, "Appointment is not booked");
  await cancelRow(id, row.linkVersion);
};

export const rescheduleByToken = async (
  id: string,
  token: string,
  { startsAt, holdToken }: { startsAt: string; holdToken: string },
): Promise<CreatedAppointment> => {
  const row = await loadForToken(id, token);
  const start = normalize(startsAt);
  appAssert(
    await holdIsValid(row.attorneyId, start, holdToken),
    CONFLICT,
    "Your reservation expired. Please pick a time again.",
    appErrorCode.SlotUnavailable,
  );
  const [rules, booked] = await Promise.all([
    loadRules(row.attorneyId),
    loadBookedStarts(row.attorneyId),
  ]);
  appAssert(
    isBookableStart(rules, start, new Date(), booked),
    CONFLICT,
    "That time is no longer available",
    appErrorCode.SlotUnavailable,
  );

  const endsAt = new Date(new Date(start).getTime() + SLOT_MINUTES * 60_000);
  try {
    const { rows } = await pool.query<{ linkVersion: number }>(
      `UPDATE "Appointment"
          SET "startsAt" = $3, "endsAt" = $4, "slotKey" = $5, "confirmedAt" = NULL,
              "linkVersion" = "linkVersion" + 1
        WHERE id = $1 AND status = 'booked' AND "linkVersion" = $2
        RETURNING "linkVersion"`,
      [
        id,
        row.linkVersion,
        start,
        endsAt.toISOString(),
        `${row.attorneyId}|${start}`,
      ],
    );
    appAssert(
      rows[0],
      FORBIDDEN,
      "This link is no longer valid.",
      appErrorCode.InvalidBookingLink,
    );
    await removeAppointmentReminder(id, row.linkVersion);
    await queueAppointmentEmails(id, rows[0].linkVersion, new Date(start));
    await releaseHold(row.attorneyId, start);
    return {
      ...toView((await fetchView(id))!),
      manageToken: createManageToken(JWT_SECRET, id, rows[0].linkVersion),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        CONFLICT,
        "Someone just booked that time. Please pick another.",
        appErrorCode.SlotTaken,
      );
    }
    throw error;
  }
};

/*
  A short, varied menu for the chat: the next two openings on each of the next few days, five at most.
  A visitor shown thirty identical buttons would not pick any of them.
 */
export const offerSlots = async (attorneyId: string): Promise<Slot[]> => {
  const all = await listSlotsForAttorney(attorneyId);
  const perDay = new Map<string, number>();
  const offered: Slot[] = [];
  for (const slot of all) {
    const day = slot.startsAt.slice(0, 10);
    const count = perDay.get(day) ?? 0;
    if (count >= 2) continue;
    perDay.set(day, count + 1);
    offered.push(slot);
    if (offered.length === 5) break;
  }
  return offered;
};
