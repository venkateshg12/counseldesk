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
console.log("e2e database ready");
await closeDB();
