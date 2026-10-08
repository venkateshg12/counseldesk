import "dotenv/config";
import { prepareAnswer } from "../services/answer.service.js";
import { streamText } from "../ai/llm.js";
import {
  extractCitations,
  invalidCitationNumbers,
} from "../utils/citations.js";
import { NOT_FOUND_REPLY } from "../ai/prompts/index.js";
import { closeDB } from "../config/db.js";

// Usage: pnpm --filter api ask "What does a first DUI cost?"
const question = process.argv.slice(2).join(" ");
const prepared = await prepareAnswer({ question, history: [] });

let answer = "";
if (prepared.sources.length === 0) {
  answer = NOT_FOUND_REPLY;
  process.stdout.write(answer);
} else {
  for await (const event of streamText({
    purpose: "answer",
    promptVersion: prepared.promptVersion,
    system: prepared.system,
    messages: prepared.messages,
  })) {
    if (event.type === "text") {
      answer += event.text;
      process.stdout.write(event.text);
    } else {
      console.log(
        `\n\n[${event.provider}] ${prepared.retrieveMs} ms retrieval, ${event.firstTokenMs} ms first token, ${event.usage.inputTokens}/${event.usage.outputTokens} tokens`,
      );
    }
  }
}

console.log(
  "\nSources given:",
  prepared.sources.map((s) => `[${s.number}] ${s.url}`),
);
console.log(
  "Cited:",
  extractCitations(answer, prepared.sources).map((s) => s.number),
);
console.log(
  "Invalid citations:",
  invalidCitationNumbers(answer, prepared.sources),
);
await closeDB();
