import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEAD_ALREADY_SAVED_REPLY } from "../src/ai/prompts/index.js";
import { saveLead } from "../src/services/lead.service.js";
import { notifyQueue } from "../src/jobs/queues/notify.queue.js";
import { orm, pool } from "../src/prisma/db.js";
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
  app = await startApp();
});
afterAll(async () => {
  await notifyQueue.close();
  await app.close();
});
beforeEach(() => resetDb());

const say = async (
  client: ReturnType<typeof createClient>,
  message: string,
  conversationId?: string,
) =>
  readSse(
    await client("/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationId }),
    }),
  );

const textOf = (events: Awaited<ReturnType<typeof say>>) =>
  events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");

describe("lead capture", () => {
  it("saves one lead and handoff, marks the conversation, and queues one email", async () => {
    const client = createClient(app.baseUrl);
    fakeLlm.push(
      { kind: "json", data: { intent: "wants_lawyer", reason: "test" } },
      {
        kind: "tool",
        result: {
          type: "tool_call",
          name: "createLead",
          args: { name: "Ana Diaz", phone: "602-555-0100", caseType: "dui" },
        },
      },
    );
    const events = await say(client, "Ana Diaz, 602-555-0100, DUI");
    expect(textOf(events)).toContain("Thank you, Ana Diaz");

    const { rows } = await pool.query(
      `SELECT c.status, l.id AS "leadId", h.status AS handoff FROM "Conversation" c
       JOIN "Lead" l ON l."conversationId" = c.id JOIN "Handoff" h ON h."conversationId" = c.id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "needs_human",
      handoff: "pending",
    });
    expect(
      await notifyQueue.getJob(`lead:${rows[0].leadId}:email`),
    ).toBeDefined();

    // Asking again in the same conversation: no tool call, no second lead.
    const meta = events[0];
    if (meta?.type !== "meta") throw new Error("expected meta first");
    fakeLlm.push({
      kind: "json",
      data: { intent: "wants_lawyer", reason: "test" },
    });
    expect(
      textOf(await say(client, "I want a lawyer", meta.conversationId)),
    ).toBe(LEAD_ALREADY_SAVED_REPLY);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM "Lead"')).rows[0].n,
    ).toBe(1);
  });

  it("saves nothing when the tool arguments are invalid", async () => {
    fakeLlm.push(
      { kind: "json", data: { intent: "wants_lawyer", reason: "test" } },
      {
        kind: "tool",
        result: {
          type: "tool_call",
          name: "createLead",
          args: { name: "Bo", phone: "call me", caseType: "family_law" },
        },
      },
    );
    const text = textOf(
      await say(createClient(app.baseUrl), "Bo, call me, divorce"),
    );
    expect(text).toContain("phone number or email address");
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM "Lead"')).rows[0].n,
    ).toBe(0);
  });

  it("creates exactly one lead when two saves race", async () => {
    const conversation = await orm.Conversation.create({ visitorId: "race" });
    const args = {
      name: "Sam Kim",
      email: "sam@example.com",
      caseType: "dui" as const,
    };

    const results = await Promise.all([
      saveLead(conversation.id, args),
      saveLead(conversation.id, args),
    ]);

    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0].lead.id).toBe(results[1].lead.id);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM "Lead"')).rows[0].n,
    ).toBe(1);
  });
});
