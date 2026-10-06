import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { hashValue } from "../utils/auth/index.js";

// Creates a staff account, or resets its password if the email already exists.
// Usage: pnpm --filter api seed:staff --email ana@firm.test --name "Ana Diaz"
const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});

const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();

if (!email || !name) {
  console.error(
    'Usage: pnpm --filter api seed:staff --email <email> --name "<name>"',
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Password (min 12 characters): ");
rl.close();

if (password.length < 12 || new TextEncoder().encode(password).length > 72) {
  console.error(
    "Password must be 12–72 bytes (bcrypt reads only the first 72).",
  );
  process.exit(1);
}

const passwordHash = await hashValue(password);
const existing = await orm.User.where({ email }).select("id").first();

if (existing) {
  await orm.User.where({ id: existing.id }).update({ name, passwordHash });
  // A password change ends every session, the same as the e-commerce reset flow.
  await orm.Session.where({ userId: existing.id }).deleteAll();
  console.log(`Updated ${email} and signed out its sessions.`);
} else {
  await orm.User.create({ email, name, passwordHash });
  console.log(`Created staff account ${email}.`);
}

await closeDB();
