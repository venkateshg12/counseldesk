import type {
  AvailabilityRuleInput,
  StaffAppointment,
  StaffAttorney,
} from "@repo/types";
import { pool } from "../prisma/db.js";
import { appAssert } from "../utils/errors/index.js";
import { BAD_REQUEST, NOT_FOUND } from "../constants/http.js";
import { cancelAsStaff } from "./booking.service.js";

export const listAppointments = async (query: {
  from?: string;
  to?: string;
  attorneyId?: string;
  status?: string;
}): Promise<StaffAppointment[]> => {
  const { rows } = await pool.query(
    `SELECT ap.id, ap."attorneyId", a.name AS "attorneyName", ap.name, ap.email, ap.phone,
            ap."caseType", ap.summary, ap.mode, ap.status, ap."startsAt", ap."endsAt"
       FROM "Appointment" ap JOIN "Attorney" a ON a.id = ap."attorneyId"
      WHERE ($1::timestamptz IS NULL OR ap."startsAt" >= $1)
        AND ($2::timestamptz IS NULL OR ap."startsAt" < $2)
        AND ($3::uuid IS NULL OR ap."attorneyId" = $3)
        AND ($4::text IS NULL OR ap.status = $4)
      ORDER BY ap."startsAt" ASC
      LIMIT 500`,
    [
      query.from ?? null,
      query.to ?? null,
      query.attorneyId ?? null,
      query.status ?? null,
    ],
  );
  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
};

export const updateAppointmentStatus = async (
  id: string,
  status: "completed" | "no_show" | "cancelled",
) => {
  if (status === "cancelled") {
    // Goes through the same path as a visitor's cancel: frees the slot, drops the reminder, sends emails.
    await cancelAsStaff(id);
    return;
  }
  const { rowCount } = await pool.query(
    `UPDATE "Appointment" SET status = $2 WHERE id = $1 AND status = 'booked'`,
    [id, status],
  );
  appAssert(rowCount, NOT_FOUND, "No booked appointment with that id");
};

export const assignLeadToAttorney = async (
  leadId: string,
  attorneyId: string,
) => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM "Attorney" WHERE id = $1 AND active`,
    [attorneyId],
  );
  appAssert(rows[0], BAD_REQUEST, "Unknown or inactive attorney");
  const { rowCount } = await pool.query(
    `UPDATE "Lead" SET "assignedAttorneyId" = $2 WHERE id = $1`,
    [leadId, attorneyId],
  );
  appAssert(rowCount, NOT_FOUND, "Lead not found");
};

export const listAttorneys = async (): Promise<StaffAttorney[]> => {
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.name, a.email, a.active,
            COALESCE((SELECT array_agg(p."caseType" ORDER BY p."caseType")
                        FROM "AttorneyPracticeArea" p WHERE p."attorneyId" = a.id), '{}') AS "practiceAreas",
            COALESCE((SELECT json_agg(json_build_object(
                        'weekday', r.weekday, 'startMinute', r."startMinute", 'endMinute', r."endMinute")
                        ORDER BY r.weekday, r."startMinute")
                        FROM "AvailabilityRule" r WHERE r."attorneyId" = a.id), '[]'::json) AS availability
       FROM "Attorney" a ORDER BY a.name`,
  );
  return rows;
};

// Replaces the attorney's whole weekly schedule in one transaction.
export const setAvailability = async (
  attorneyId: string,
  rules: AvailabilityRuleInput[],
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query(
      `SELECT 1 FROM "Attorney" WHERE id = $1`,
      [attorneyId],
    );
    appAssert(exists.rowCount, NOT_FOUND, "Attorney not found");
    await client.query(
      `DELETE FROM "AvailabilityRule" WHERE "attorneyId" = $1`,
      [attorneyId],
    );
    for (const rule of rules) {
      await client.query(
        `INSERT INTO "AvailabilityRule" (id, "attorneyId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1,$2,$3,$4)`,
        [attorneyId, rule.weekday, rule.startMinute, rule.endMinute],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
