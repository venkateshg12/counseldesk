import "dotenv/config";
import { parseArgs } from "node:util";
import { pool } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { STAFF_NOTIFY_EMAIL } from "../constants/env.js";

// Creates the demo firm's three attorneys, their practice areas and weekday hours. Safe to re-run:
// existing attorneys keep any hours staff have edited. Booking emails go to a plus-address of one
// inbox (you+elena@gmail.com), so a demo needs only one mailbox.
// Usage: pnpm --filter api seed:attorneys [--email-base you@gmail.com]
const { values } = parseArgs({ options: { "email-base": { type: "string" } } });
const base = (values["email-base"] ?? STAFF_NOTIFY_EMAIL).trim().toLowerCase();
const [local, domain] = base.split("@");
if (!local || !domain) {
  console.error("--email-base must be an email address like you@gmail.com");
  process.exit(1);
}

const ATTORNEYS = [
  {
    slug: "elena-ruiz",
    name: "Elena Ruiz",
    areas: ["dui", "criminal_defense", "other"],
  },
  { slug: "marcus-chen", name: "Marcus Chen", areas: ["family_law"] },
  {
    slug: "priya-nair",
    name: "Priya Nair",
    areas: ["personal_injury", "estate_planning"],
  },
];

for (const attorney of ATTORNEYS) {
  const email = `${local}+${attorney.slug.split("-")[0]}@${domain}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "Attorney" (id, slug, name, email) VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
     RETURNING id`,
    [attorney.slug, attorney.name, email],
  );
  const id = rows[0]!.id;

  for (const caseType of attorney.areas) {
    await pool.query(
      `INSERT INTO "AttorneyPracticeArea" (id, "attorneyId", "caseType") VALUES (gen_random_uuid(), $1, $2)
       ON CONFLICT ("attorneyId", "caseType") DO NOTHING`,
      [id, caseType],
    );
  }

  const hours = await pool.query(
    `SELECT 1 FROM "AvailabilityRule" WHERE "attorneyId" = $1 LIMIT 1`,
    [id],
  );
  if (!hours.rowCount) {
    // Monday to Friday, 9:00-17:00 Arizona time.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await pool.query(
        `INSERT INTO "AvailabilityRule" (id, "attorneyId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, 540, 1020)`,
        [id, weekday],
      );
    }
  }
  console.log(`${attorney.name} <${email}>: ${attorney.areas.join(", ")}`);
}

await closeDB();
