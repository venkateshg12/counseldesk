import "dotenv/config";
import { loadCases } from "./loadCases.js";
import type { EvalCase } from "./schema.js";
import { pool } from "../prisma/db.js";
import { closeDB } from "../config/db.js";

// Every expected "path#anchor" must exist in the ingested content, or the case can never pass.
const cases = loadCases();
const { rows } = await pool.query<{ ref: string }>(
  `SELECT p.path || '#' || s.anchor AS ref FROM "Section" s JOIN "Page" p ON p.id = s."pageId"`,
);
const existing = new Set(rows.map((r) => r.ref));

let problems = 0;
for (const c of cases) {
  const missing = (c.expect.sections ?? []).filter((ref) => !existing.has(ref));
  // A case passes if ANY listed section is found, so it only breaks when ALL are missing — but
  // report every missing one, because a dead alternative is still a typo.
  for (const ref of missing) {
    console.log(`${c.id}: no section ${ref}`);
    problems++;
  }
  if (c.category === "answerable" && !c.expect.sections?.length) {
    console.log(`${c.id}: answerable case without expected sections`);
    problems++;
  }
}

const byCategory = cases.reduce<Record<string, EvalCase[]>>((acc, c) => {
  (acc[c.category] ??= []).push(c);
  return acc;
}, {});

console.log(
  Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, v?.length]),
  ),
);
console.log(
  `${cases.length} cases, ${cases.filter((c) => c.ci).length} in the CI subset, ${problems} problem(s)`,
);

await closeDB();
process.exit(problems ? 1 : 0);
