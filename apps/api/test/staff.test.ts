import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashValue } from "../src/utils/auth/index.js";
import { orm } from "../src/prisma/db.js";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
let handoffId: string;

beforeAll(async () => {
  await resetDb();
  await orm.User.create({
    email: "ana@firm.test",
    name: "Ana",
    passwordHash: await hashValue("correct horse battery"),
  });
  for (const name of ["Lead One", "Lead Two"]) {
    const conversation = await orm.Conversation.create({ visitorId: name });
    await orm.Lead.create({
      conversationId: conversation.id,
      name,
      phone: "602-555-0100",
      caseType: "dui",
    });
    const handoff = await orm.Handoff.create({
      conversationId: conversation.id,
      reason: "test",
    });
    handoffId = handoff.id;
  }
  app = await startApp();
});
afterAll(() => app.close());

describe("staff API", () => {
  it("requires login", async () => {
    expect((await fetch(`${app.baseUrl}/staff/leads`)).status).toBe(401);
  });

  it("paginates leads", async () => {
    const client = createClient(app.baseUrl);
    await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ana@firm.test",
        password: "correct horse battery",
      }),
    });

    const page1 = await (await client("/staff/leads?limit=1")).json();
    expect(page1.data).toHaveLength(1);
    expect(page1.meta).toEqual({ page: 1, limit: 1, total: 2, hasMore: true });

    const page2 = await (await client("/staff/leads?limit=1&page=2")).json();
    expect(page2.meta.hasMore).toBe(false);
  });

  it("resolves a handoff once", async () => {
    const client = createClient(app.baseUrl);
    await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ana@firm.test",
        password: "correct horse battery",
      }),
    });

    expect(
      (await client(`/staff/handoffs/${handoffId}/resolve`, { method: "POST" }))
        .status,
    ).toBe(200);
    expect(
      (await client(`/staff/handoffs/${handoffId}/resolve`, { method: "POST" }))
        .status,
    ).toBe(409);
  });
});
