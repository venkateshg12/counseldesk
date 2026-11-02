import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChatEvent } from "@repo/types";
import { notifyQueue } from "../src/jobs/queues/notify.queue.js";
import { pool } from "../src/prisma/db.js";
import { assignLead } from "../src/services/assignment.service.js";
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

// An attorney who works every hour of every day, so slots exist whatever day the test runs on.
const seedAttorney = async (
  slug: string,
  areas: string[],
  name = slug.toUpperCase(),
) => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "Attorney" (id, slug, name, email) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
    [slug, name, `${slug}@firm.test`],
  );
  const id = rows[0]!.id;
  for (const area of areas)
    await pool.query(
      `INSERT INTO "AttorneyPracticeArea" (id, "attorneyId", "caseType") VALUES (gen_random_uuid(), $1, $2)`,
      [id, area],
    );
  for (let weekday = 0; weekday < 7; weekday++)
    await pool.query(
      `INSERT INTO "AvailabilityRule" (id, "attorneyId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, 0, 1440)`,
      [id, weekday],
    );
  return id;
};

type Json = { data: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

const slotsFor = async (
  client: ReturnType<typeof createClient>,
  caseType = "dui",
) =>
  ((await (await client(`/booking/slots?caseType=${caseType}`)).json()) as Json)
    .data;

const book = async (
  client: ReturnType<typeof createClient>,
  slots: Awaited<ReturnType<typeof slotsFor>>,
  index = 0,
  email = "visitor@example.com",
) => {
  const startsAt = slots.slots[index].startsAt as string;
  const hold = await client("/booking/holds", {
    method: "POST",
    body: JSON.stringify({ attorneyId: slots.attorney.id, startsAt }),
  });
  expect(hold.status).toBe(201);
  const { holdToken } = ((await hold.json()) as Json).data;
  const response = await client("/booking/appointments", {
    method: "POST",
    body: JSON.stringify({
      name: "Visitor One",
      email,
      mode: "video",
      caseType: "dui",
      attorneyId: slots.attorney.id,
      startsAt,
      holdToken,
    }),
  });
  return { response, startsAt };
};

describe("booking", () => {
  it("lists slots for the attorney who handles the case type", async () => {
    await seedAttorney("elena", ["dui"]);
    await seedAttorney("marcus", ["family_law"]);
    const slots = await slotsFor(createClient(app.baseUrl), "dui");
    expect(slots.attorney.slug).toBe("elena");
    expect(slots.slots.length).toBeGreaterThan(10);
    expect(slots.timeZone).toBe("America/Phoenix");
  });

  it("books a slot, queues the emails and takes the slot off the list", async () => {
    await seedAttorney("elena", ["dui"]);
    const client = createClient(app.baseUrl);
    const slots = await slotsFor(client);
    const { response, startsAt } = await book(client, slots);
    expect(response.status).toBe(201);
    const created = ((await response.json()) as Json).data;
    expect(created.status).toBe("booked");

    const { rows } = await pool.query(
      `SELECT "slotKey", "linkVersion" FROM "Appointment" WHERE id = $1`,
      [created.id],
    );
    expect(rows[0].slotKey).toContain(new Date(startsAt).toISOString());
    expect(
      await notifyQueue.getJob(`appt-${created.id}-v1-confirm`),
    ).toBeDefined();
    expect(
      await notifyQueue.getJob(`appt-${created.id}-v1-attorney`),
    ).toBeDefined();

    const after = await slotsFor(client);
    expect(
      after.slots.map((s: { startsAt: string }) => s.startsAt),
    ).not.toContain(new Date(startsAt).toISOString());
  });

  it("refuses a second hold on the same slot", async () => {
    await seedAttorney("elena", ["dui"]);
    const a = createClient(app.baseUrl);
    const b = createClient(app.baseUrl);
    const slots = await slotsFor(a);
    const body = JSON.stringify({
      attorneyId: slots.attorney.id,
      startsAt: slots.slots[0].startsAt,
    });
    expect((await a("/booking/holds", { method: "POST", body })).status).toBe(
      201,
    );
    const second = await b("/booking/holds", { method: "POST", body });
    expect(second.status).toBe(409);
  });

  it("refuses a booking without a valid hold token", async () => {
    await seedAttorney("elena", ["dui"]);
    const client = createClient(app.baseUrl);
    const slots = await slotsFor(client);
    const response = await client("/booking/appointments", {
      method: "POST",
      body: JSON.stringify({
        name: "Visitor One",
        email: "visitor@example.com",
        mode: "video",
        caseType: "dui",
        attorneyId: slots.attorney.id,
        startsAt: slots.slots[0].startsAt,
        holdToken: "x".repeat(24),
      }),
    });
    expect(response.status).toBe(409);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM "Appointment"')).rows[0]
        .n,
    ).toBe(0);
  });

  it("refuses a start time that is not a real slot", async () => {
    await seedAttorney("elena", ["dui"]);
    const client = createClient(app.baseUrl);
    const slots = await slotsFor(client);
    const off = new Date(slots.slots[0].startsAt);
    off.setUTCMinutes(off.getUTCMinutes() + 7);
    const response = await client("/booking/holds", {
      method: "POST",
      body: JSON.stringify({
        attorneyId: slots.attorney.id,
        startsAt: off.toISOString(),
      }),
    });
    expect(response.status).toBe(409);
  });

  it("lets Postgres itself refuse a double booking, even past every check", async () => {
    const id = await seedAttorney("elena", ["dui"]);
    const insert = () =>
      pool.query(
        `INSERT INTO "Appointment" (id, "attorneyId", name, "caseType", "startsAt", "endsAt", "slotKey")
         VALUES (gen_random_uuid(), $1, 'A', 'dui', now(), now(), $2)`,
        [id, `${id}|same-slot`],
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: "23505" });
  });

  it("cancels once: the link dies, the slot returns and the reminder is gone", async () => {
    await seedAttorney("elena", ["dui"]);
    const client = createClient(app.baseUrl);
    const slots = await slotsFor(client);
    // A slot far enough out for a reminder to be scheduled.
    const index = slots.slots.length - 1;
    const { response, startsAt } = await book(client, slots, index);
    const created = ((await response.json()) as Json).data;
    expect(
      await notifyQueue.getJob(`appt-${created.id}-v1-reminder`),
    ).toBeDefined();

    const url = `/booking/appointments/${created.id}`;
    const token = encodeURIComponent(created.manageToken);
    expect((await client(`${url}?token=${token}`)).status).toBe(200);

    expect(
      (await client(`${url}/cancel?token=${token}`, { method: "POST" })).status,
    ).toBe(200);
    // The same link again: dead.
    expect(
      (await client(`${url}/cancel?token=${token}`, { method: "POST" })).status,
    ).toBe(403);
    expect((await client(`${url}?token=${token}`)).status).toBe(403);

    expect(
      await notifyQueue.getJob(`appt-${created.id}-v1-reminder`),
    ).toBeUndefined();
    expect(
      await notifyQueue.getJob(`appt-${created.id}-v2-cancelled`),
    ).toBeDefined();
    expect(
      (await slotsFor(client)).slots.map(
        (s: { startsAt: string }) => s.startsAt,
      ),
    ).toContain(new Date(startsAt).toISOString());
  });

  it("rejects a token for a different appointment", async () => {
    await seedAttorney("elena", ["dui"]);
    const client = createClient(app.baseUrl);
    const slots = await slotsFor(client);
    const first = (
      (await (await book(client, slots, 0)).response.json()) as Json
    ).data;
    const second = (
      (await (
        await book(client, slots, 1, "two@example.com")
      ).response.json()) as Json
    ).data;
    const response = await client(
      `/booking/appointments/${second.id}?token=${encodeURIComponent(first.manageToken)}`,
    );
    expect(response.status).toBe(403);
  });

  it("reschedules: the old link dies and the new one works", async () => {
    await seedAttorney("elena", ["dui"]);
    const client = createClient(app.baseUrl);
    const slots = await slotsFor(client);
    const created = (
      (await (await book(client, slots, 0)).response.json()) as Json
    ).data;

    const newStart = slots.slots[3].startsAt as string;
    const hold = (
      (await (
        await client("/booking/holds", {
          method: "POST",
          body: JSON.stringify({
            attorneyId: slots.attorney.id,
            startsAt: newStart,
          }),
        })
      ).json()) as Json
    ).data;
    const url = `/booking/appointments/${created.id}`;
    const moved = await client(
      `${url}/reschedule?token=${encodeURIComponent(created.manageToken)}`,
      {
        method: "POST",
        body: JSON.stringify({ startsAt: newStart, holdToken: hold.holdToken }),
      },
    );
    expect(moved.status).toBe(200);
    const movedData = ((await moved.json()) as Json).data;
    expect(new Date(movedData.startsAt).toISOString()).toBe(
      new Date(newStart).toISOString(),
    );

    expect(
      (await client(`${url}?token=${encodeURIComponent(created.manageToken)}`))
        .status,
    ).toBe(403);
    expect(
      (
        await client(
          `${url}?token=${encodeURIComponent(movedData.manageToken)}`,
        )
      ).status,
    ).toBe(200);
    // A fresh confirmation goes out for the new version.
    expect(
      await notifyQueue.getJob(`appt-${created.id}-v2-confirm`),
    ).toBeDefined();
  });
});

describe("assignment", () => {
  it("spreads leads across attorneys who share a practice area", async () => {
    const a = await seedAttorney("anna", ["dui"], "Anna");
    const b = await seedAttorney("ben", ["dui"], "Ben");
    const leadIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const conversation = await pool.query<{ id: string }>(
        `INSERT INTO "Conversation" (id, "visitorId") VALUES (gen_random_uuid(), $1) RETURNING id`,
        [`v${i}`],
      );
      const lead = await pool.query<{ id: string }>(
        `INSERT INTO "Lead" (id, "conversationId", name, email, "caseType") VALUES (gen_random_uuid(), $1, $2, $3, 'dui') RETURNING id`,
        [conversation.rows[0]!.id, `Lead ${i}`, `l${i}@example.com`],
      );
      leadIds.push(lead.rows[0]!.id);
    }
    // Concurrent on purpose: the advisory lock must still spread them 2 and 2.
    await Promise.all(leadIds.map((id) => assignLead(id, "dui")));
    const { rows } = await pool.query<{
      assignedAttorneyId: string;
      n: number;
    }>(
      `SELECT "assignedAttorneyId", count(*)::int AS n FROM "Lead" GROUP BY 1`,
    );
    expect(rows.map((r) => r.assignedAttorneyId).sort()).toEqual([a, b].sort());
    expect(rows.map((r) => r.n)).toEqual([2, 2]);
  });

  it("falls back to the 'other' attorney when nobody handles the case type", async () => {
    const fallback = await seedAttorney("gen", ["other"]);
    const conversation = await pool.query<{ id: string }>(
      `INSERT INTO "Conversation" (id, "visitorId") VALUES (gen_random_uuid(), 'x') RETURNING id`,
    );
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO "Lead" (id, "conversationId", name, email, "caseType") VALUES (gen_random_uuid(), $1, 'N', 'n@example.com', 'estate_planning') RETURNING id`,
      [conversation.rows[0]!.id],
    );
    const attorney = await assignLead(lead.rows[0]!.id, "estate_planning");
    expect(attorney?.id).toBe(fallback);
  });
});

describe("booking from the chat", () => {
  it("offers slots after a lead is saved and books the one tapped, once", async () => {
    await seedAttorney("marcus", ["family_law"], "Marcus Chen");
    const client = createClient(app.baseUrl);
    fakeLlm.push(
      { kind: "json", data: { intent: "wants_lawyer", reason: "test" } },
      {
        kind: "tool",
        result: {
          type: "tool_call",
          name: "createLead",
          args: {
            name: "Dana Roy",
            email: "dana@example.com",
            caseType: "family_law",
          },
        },
      },
    );
    const events = await readSse(
      await client("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "Dana Roy, dana@example.com, divorce",
        }),
      }),
    );
    const meta = events.find((e) => e.type === "meta") as Extract<
      ChatEvent,
      { type: "meta" }
    >;
    const offered = events.find((e) => e.type === "slots") as Extract<
      ChatEvent,
      { type: "slots" }
    >;
    expect(offered.attorney.name).toBe("Marcus Chen");
    expect(offered.slots.length).toBeGreaterThan(0);
    expect(offered.slots.length).toBeLessThanOrEqual(5);

    const startsAt = offered.slots[0]!.startsAt;
    const post = () =>
      client(`/chat/${meta.conversationId}/book`, {
        method: "POST",
        body: JSON.stringify({ startsAt }),
      });
    const first = await post();
    expect(first.status).toBe(201);
    // Tapping again returns the same appointment instead of booking twice.
    const again = ((await (await post()).json()) as Json).data;
    expect(again.id).toBe(((await first.json()) as Json).data.id);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM "Appointment"')).rows[0]
        .n,
    ).toBe(1);

    // The lead's own details were used, and the booking is linked to the lead.
    const { rows } = await pool.query(
      `SELECT name, email, "leadId" FROM "Appointment"`,
    );
    expect(rows[0]).toMatchObject({
      name: "Dana Roy",
      email: "dana@example.com",
    });
    expect(rows[0].leadId).not.toBeNull();
  });

  it("refuses to book on a conversation that belongs to another browser", async () => {
    await seedAttorney("marcus", ["family_law"]);
    const owner = createClient(app.baseUrl);
    fakeLlm.push(
      { kind: "json", data: { intent: "wants_lawyer", reason: "test" } },
      {
        kind: "tool",
        result: {
          type: "tool_call",
          name: "createLead",
          args: {
            name: "Dana Roy",
            email: "dana@example.com",
            caseType: "family_law",
          },
        },
      },
    );
    const events = await readSse(
      await owner("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "Dana Roy, dana@example.com, divorce",
        }),
      }),
    );
    const meta = events.find((e) => e.type === "meta") as Extract<
      ChatEvent,
      { type: "meta" }
    >;
    const offered = events.find((e) => e.type === "slots") as Extract<
      ChatEvent,
      { type: "slots" }
    >;

    const stranger = createClient(app.baseUrl);
    const response = await stranger(`/chat/${meta.conversationId}/book`, {
      method: "POST",
      body: JSON.stringify({ startsAt: offered.slots[0]!.startsAt }),
    });
    expect(response.status).toBe(404);
  });
});
