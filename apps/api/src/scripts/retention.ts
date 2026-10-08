import "dotenv/config";
import { parseArgs } from "node:util";
import { pool } from "../prisma/db.js";
import { closeDB } from "../config/db.js";

// Deletes conversations with no lead whose last activity is older than --days (default 90).
// Messages, citations and handoffs go with them (cascade). Leads are kept: they're business records.
const { values } = parseArgs({
  options: {
    days: { type: "string", default: "90" },
    "dry-run": { type: "boolean", default: false },
  },
});
const days = Number(values.days);

const sql = `
  FROM "Conversation" c
  WHERE c."updatedAt" < now() - make_interval(days => $1)
    AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."conversationId" = c.id)`;

const { rows } = await pool.query<{ n: string }>(
  `SELECT count(*) AS n ${sql}`,
  [days],
);
console.log(
  `${rows[0]!.n} conversation(s) older than ${days} days without a lead`,
);

if (!values["dry-run"]) {
  const result = await pool.query(
    `DELETE FROM "Conversation" WHERE id IN (SELECT c.id ${sql})`,
    [days],
  );
  console.log(`deleted ${result.rowCount ?? 0}`);
}
await closeDB();
