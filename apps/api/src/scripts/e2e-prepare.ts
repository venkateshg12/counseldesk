import "dotenv/config";
import { pool, orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { ingestPages } from "../services/ingest.service.js";
import { hashValue } from "../utils/auth/index.js";

// Fresh state for an E2E run: empty tables, the real pages with fake embeddings, one staff account.
const { rows } = await pool.query<{ tablename: string }>(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
);
if (rows.length > 0) {
  await pool.query(
    `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`,
  );
}
await ingestPages({ depth: 3 });
await orm.User.create({
  email: "staff@e2e.test",
  name: "E2E Staff",
  passwordHash: await hashValue("e2e-password-123"),
});
// One attorney for every case type, working every hour of every day, so the booking flow has slots
// whatever day and time the suite runs.
const attorney = await pool.query<{ id: string }>(
  `INSERT INTO "Attorney" (id, slug, name, email) VALUES (gen_random_uuid(), 'e2e-attorney', 'Elena Ruiz', 'elena@e2e.test') RETURNING id`,
);
const attorneyId = attorney.rows[0]!.id;
for (const caseType of [
  "dui",
  "criminal_defense",
  "family_law",
  "personal_injury",
  "estate_planning",
  "other",
]) {
  await pool.query(
    `INSERT INTO "AttorneyPracticeArea" (id, "attorneyId", "caseType") VALUES (gen_random_uuid(), $1, $2)`,
    [attorneyId, caseType],
  );
}
for (let weekday = 0; weekday < 7; weekday++) {
  await pool.query(
    `INSERT INTO "AvailabilityRule" (id, "attorneyId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, 0, 1440)`,
    [attorneyId, weekday],
  );
}
console.log("e2e database ready");
await closeDB();
