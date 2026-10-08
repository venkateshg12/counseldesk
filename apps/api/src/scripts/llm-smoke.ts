import "dotenv/config";
import { z } from "zod";
import { generateJson, streamText } from "../ai/llm.js";
import { closeDB } from "../config/db.js";

const verdict = await generateJson({
  purpose: "route",
  promptVersion: "smoke",
  system: "Classify the sentiment of the user's message.",
  messages: [{ role: "user", content: "I love how fast this is!" }],
  schema: z.object({ sentiment: z.enum(["positive", "neutral", "negative"]) }),
});
console.log("json:", verdict);

process.stdout.write("stream: ");
for await (const event of streamText({
  purpose: "answer",
  promptVersion: "smoke",
  system: "Answer in one short sentence.",
  messages: [{ role: "user", content: "Why is the sky blue?" }],
})) {
  if (event.type === "text") process.stdout.write(event.text);
  else
    console.log(
      `\n[${event.provider}/${event.model}] first token ${event.firstTokenMs} ms, tokens in/out ${event.usage.inputTokens}/${event.usage.outputTokens}${event.fellBack ? " (fallback)" : ""}`,
    );
}

await closeDB();
