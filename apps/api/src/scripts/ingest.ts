import "dotenv/config";
import { parseArgs } from "node:util";
import { ingestPages } from "../services/ingest.service.js";
import { closeDB } from "../config/db.js";

const { values } = parseArgs({
  options: {
    depth: { type: "string", default: "3" },
    force: { type: "boolean", default: false },
  },
});
const result = await ingestPages({
  depth: values.depth === "2" ? 2 : 3,
  force: values.force,
});
console.log(
  `done: ${result.ingested} ingested, ${result.skipped} unchanged, ${result.removed} removed`,
);
await closeDB();
