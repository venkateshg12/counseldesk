import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEGAL_ADVICE_REPLY } from "../src/ai/prompts/index.js";
import { ingestPages } from "../src/services/ingest.service.js";
import { pool } from "../src/prisma/db.js";
import {
  createClient,
  fakeLlm,
  readSse,
  resetDb,
  startApp,
} from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  await ingestPages({ depth: 3 }); // real pages, fake embeddings
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  fakeLlm.reset();
  await pool.query('TRUNCATE "Conversation" CASCADE');
});

const ask = (
  client: ReturnType<typeof createClient>,
  message: string,
  conversationId?: string,
) =>
  client("/chat", {
    method: "POST",
    body: JSON.stringify({ message, conversationId }),
  });

describe("POST /chat", () => {
  it("streams meta, tokens, citations, done — and saves the answer with its citation", async () => {
    fakeLlm.push(
      { kind: "json", data: { intent: "question", reason: "test" } },
      { kind: "text", text: "A first DUI starts at a flat fee of $2,500 [1]." },
    );
    const client = createClient(app.baseUrl);

    const response = await ask(client, "How much is a first DUI?");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(response);
    const types = events.map((e) => e.type);

    expect(types[0]).toBe("meta");
    expect(types.filter((t) => t === "token").length).toBeGreaterThan(1);
    expect(types.slice(-2)).toEqual(["citations", "done"]);

    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations).toHaveLength(
      1,
    );

    const { rows } = await pool.query(
      `SELECT m.role, m.intent, count(c.id)::int AS citations FROM "Message" m
       LEFT JOIN "MessageCitation" c ON c."messageId" = m.id GROUP BY m.id ORDER BY m."createdAt"`,
    );
    expect(rows).toEqual([
      { role: "user", intent: null, citations: 0 },
      { role: "assistant", intent: "question", citations: 1 },
    ]);
  });

  it("refuses legal advice with the fixed reply and never calls the answer model", async () => {
    fakeLlm.push({
      kind: "json",
      data: { intent: "legal_advice", reason: "test" },
    });
    const events = await readSse(
      await ask(createClient(app.baseUrl), "Will I go to jail?"),
    );

    const text = events
      .flatMap((e) => (e.type === "token" ? [e.text] : []))
      .join("");
    expect(text).toBe(LEGAL_ADVICE_REPLY);
    expect(fakeLlm.calls().map((c) => c.method)).toEqual(["generateJson"]);
  });

  it("does not let another visitor continue a conversation", async () => {
    fakeLlm.push({
      kind: "json",
      data: { intent: "small_talk", reason: "test" },
    });
    const first = await readSse(await ask(createClient(app.baseUrl), "hi"));
    const meta = first[0];
    if (meta?.type !== "meta") throw new Error("expected meta first");

    const intruder = createClient(app.baseUrl); // different visitorId cookie
    const events = await readSse(
      await ask(intruder, "hi again", meta.conversationId),
    );
    expect(events).toEqual([
      { type: "error", message: "Conversation not found", code: "APP_ERROR" },
    ]);
  });

  it("rejects an empty message with a 400 envelope before streaming", async () => {
    const response = await ask(createClient(app.baseUrl), "");
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe("error");
  });

  it("sends an error event when the model is unavailable", async () => {
    fakeLlm.push(
      { kind: "json", data: { intent: "question", reason: "test" } },
      {
        kind: "error",
        error: Object.assign(new Error("down"), { status: 503 }),
      },
    );
    const events = await readSse(
      await ask(createClient(app.baseUrl), "What are your hours?"),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "LLM_UNAVAILABLE",
    });
  });
});
