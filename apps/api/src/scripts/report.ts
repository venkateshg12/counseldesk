import "dotenv/config";
import { parseArgs } from "node:util";
import { getStats } from "../services/stats.service.js";
import { closeDB } from "../config/db.js";

const { values } = parseArgs({
  options: { days: { type: "string", default: "7" } },
});
const stats = await getStats(Number(values.days));

console.log(
  `\nLast ${stats.days} day(s) — cost estimated at paid-tier list prices as of ${stats.pricesAsOf}\n`,
);
console.log("Totals:", stats.totals);
console.log("\nAnswers (question intent), ms:");
console.table([stats.answers]);
console.log("Messages by intent:");
console.table(stats.intents);
console.log("Model calls:");
console.table(stats.calls);

await closeDB();
