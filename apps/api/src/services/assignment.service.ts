import type { CaseType } from "@repo/types";
import { pool } from "../prisma/db.js";

export type AssignedAttorney = {
  id: string;
  name: string;
  slug: string;
  email: string;
};

/*
  Picks the attorney for a case type: among active attorneys who handle it, the one with the least
  current work (booked future appointments plus leads taken in the last 30 days), alphabetical on a
  tie. With nobody matching, it falls back to whoever handles "other", then to anyone active, so a
  lead is never left unassigned just because the firm lists nobody for that area.
 */
const PICK_SQL = `
  SELECT a.id, a.name, a.slug, a.email,
         (SELECT count(*) FROM "Appointment" ap
           WHERE ap."attorneyId" = a.id AND ap.status = 'booked' AND ap."startsAt" > now())
       + (SELECT count(*) FROM "Lead" l
           WHERE l."assignedAttorneyId" = a.id AND l."createdAt" > now() - interval '30 days') AS load
    FROM "Attorney" a
   WHERE a.active
     AND ($1::text IS NULL OR EXISTS (
           SELECT 1 FROM "AttorneyPracticeArea" p
            WHERE p."attorneyId" = a.id AND p."caseType" = $1))
   ORDER BY load ASC, a.name ASC
   LIMIT 1`;

type Queryable = Pick<typeof pool, "query">;

export const pickAttorney = async (
  caseType: CaseType,
  client: Queryable = pool,
): Promise<AssignedAttorney | null> => {
  for (const area of [caseType, "other", null]) {
    const { rows } = await client.query<AssignedAttorney>(PICK_SQL, [area]);
    if (rows[0]) {
      const { id, name, slug, email } = rows[0];
      return { id, name, slug, email };
    }
  }
  return null;
};

/*
  Assigns a saved lead to an attorney. The pick and the write share one transaction under an advisory
  lock, so two leads arriving together are counted one after the other and spread across attorneys
  instead of both choosing the same least-busy one. A lead that already has an attorney is left alone.
 */
export const assignLead = async (
  leadId: string,
  caseType: CaseType,
): Promise<AssignedAttorney | null> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('lead-assignment'))",
    );
    const existing = await client.query<AssignedAttorney>(
      `SELECT a.id, a.name, a.slug, a.email FROM "Lead" l
         JOIN "Attorney" a ON a.id = l."assignedAttorneyId" WHERE l.id = $1`,
      [leadId],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0];
    }
    const attorney = await pickAttorney(caseType, client);
    if (attorney) {
      await client.query(
        `UPDATE "Lead" SET "assignedAttorneyId" = $1 WHERE id = $2`,
        [attorney.id, leadId],
      );
    }
    await client.query("COMMIT");
    return attorney;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
