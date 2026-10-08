import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

export default async function setup() {
  config({ path: ".env.test", override: true });
  const testUrl = process.env["DATABASE_URL"]!;
  const adminUrl = testUrl.replace(/\/counseldesk_test$/, "/counseldesk");

  // Create the test database once; it persists between runs.
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const exists = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'counseldesk_test'",
  );
  if (exists.rowCount === 0)
    await admin.query("CREATE DATABASE counseldesk_test");
  await admin.end();

  // Same migrations as production; the env makes the CLI target the test database.
  execFileSync("pnpm", ["exec", "prisma", "db", "migrate"], {
    stdio: "inherit",
    env: process.env,
  });
}
