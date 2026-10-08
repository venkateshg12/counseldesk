import "dotenv/config";
import {
  keywordSearch,
  vectorSearch,
  getSectionsByIds,
} from "../services/search.service.js";
import { embedQuery } from "../ai/embeddings.js";
import { closeDB } from "../config/db.js";

// Usage: pnpm --filter api search "Do you handle DUI cases in Phoenix?"
const question = process.argv.slice(2).join(" ");
if (!question) {
  console.error('Usage: pnpm --filter api search "<question>"');
  process.exit(1);
}

const [keyword, vector] = await Promise.all([
  keywordSearch(question, 5),
  embedQuery(question).then((v) => vectorSearch(v, 5)),
]);

const label = async (list: { id: string; score: number }[]) => {
  const sections = await getSectionsByIds(list.map((r) => r.id));
  return sections.map(
    (s, i) => `${list[i]!.score.toFixed(3)}  ${s.pagePath}#${s.anchor}`,
  );
};

console.log("KEYWORD");
console.log((await label(keyword)).join("\n") || "  (no matches)");
console.log("\nVECTOR");
console.log((await label(vector)).join("\n"));

await closeDB();
