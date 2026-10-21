import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPasswordResetToken,
  hashValue,
} from "../src/utils/auth/index.js";
import { notifyQueue } from "../src/jobs/queues/notify.queue.js";
import { orm, pool } from "../src/prisma/db.js";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
const credentials = {
  email: "ana@firm.test",
  password: "correct horse battery",
};
const NEW_PASSWORD = "a brand new passphrase";
const INVALID = "This reset link is invalid or has expired.";

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await notifyQueue.close();
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  await orm.User.create({
    email: credentials.email,
    name: "Ana Diaz",
    passwordHash: await hashValue(credentials.password),
  });
});

const post = (
  path: string,
  body: unknown,
  client = createClient(app.baseUrl),
) => client(path, { method: "POST", body: JSON.stringify(body) });

const forgot = (email: string) => post("/auth/password/forgot", { email });

const reset = (token: string, password = NEW_PASSWORD) =>
  post("/auth/password/reset", { token, password, confirmPassword: password });

const login = (password: string) =>
  post("/auth/login", { email: credentials.email, password });

const tokenFor = async (issuedAt = Date.now()) => {
  const { rows } = await pool.query<{ id: string; passwordHash: string }>(
    'SELECT id, "passwordHash" FROM "User"',
  );
  return createPasswordResetToken(rows[0]!.id, rows[0]!.passwordHash, issuedAt);
};

const queuedResets = async () =>
  (await notifyQueue.getJobs(["waiting", "delayed", "active"])).filter(
    (job) => job.name === "password_reset",
  );

describe("forgot password", () => {
  it("answers identically for a known and an unknown email, and queues only for the known one", async () => {
    const known = await forgot(credentials.email);
    const unknown = await forgot("nobody@firm.test");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());

    const jobs = await queuedResets();
    expect(jobs).toHaveLength(1);
    // Only ids go to Redis: no email, no name, and no link.
    expect(Object.keys(jobs[0]!.data).sort()).toEqual(["issuedAt", "userId"]);
  });

  it("limits requests per address, and limits unknown addresses the same way", async () => {
    for (const email of [credentials.email, "nobody@firm.test"]) {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await forgot(email)).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
    }
  });

  it("rejects a malformed email", async () => {
    expect((await forgot("not-an-email")).status).toBe(400);
  });
});

describe("reset password", () => {
  it("sets the new password, signs out every session, and works only once", async () => {
    const signedIn = createClient(app.baseUrl);
    expect((await post("/auth/login", credentials, signedIn)).status).toBe(200);
    expect((await signedIn("/auth/me")).status).toBe(200);

    const token = await tokenFor();
    const response = await reset(token);
    expect(response.status).toBe(200);

    expect((await login(credentials.password)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    // The session that existed before the reset is gone.
    expect((await signedIn("/auth/me")).status).toBe(401);

    // The same link again: the hash it was signed against no longer exists.
    const again = await reset(token, "yet another passphrase");
    expect(again.status).toBe(400);
    expect((await again.json()).errors[0].message).toBe(INVALID);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it("refuses tampered, expired and malformed links with one message", async () => {
    const good = await tokenFor();
    const [userId, issuedAt, signature] = good.split(".");
    const tooOld = await tokenFor(Date.now() - 11 * 60 * 1000);
    const bad = [
      `${userId}.${issuedAt}.${signature!.slice(0, -2)}xx`, // forged signature
      `${userId}.${Number(issuedAt) + 1}.${signature}`, // changed timestamp
      tooOld,
      "garbage",
      `${userId}.${issuedAt}`,
      `${userId}.${issuedAt}.${signature}.extra`,
      `not-a-uuid.${issuedAt}.${signature}`,
    ];

    for (const token of bad) {
      const response = await reset(token);
      expect(response.status).toBe(400);
      expect((await response.json()).errors[0].message).toBe(INVALID);
    }
    // Nothing changed.
    expect((await login(credentials.password)).status).toBe(200);
  });

  it("refuses a link for an account that no longer exists", async () => {
    const token = await tokenFor();
    await pool.query('DELETE FROM "User"');
    expect((await reset(token)).status).toBe(400);
  });

  it("validates the new password", async () => {
    const token = await tokenFor();

    const short = await reset(token, "too short");
    expect(short.status).toBe(400);

    const mismatch = await post("/auth/password/reset", {
      token,
      password: NEW_PASSWORD,
      confirmPassword: "something different",
    });
    expect(mismatch.status).toBe(400);

    const tooLong = await reset(token, "x".repeat(73));
    expect(tooLong.status).toBe(400);

    // None of the failed attempts used up the link.
    expect((await reset(token)).status).toBe(200);
  });

  it("lets exactly one of two simultaneous uses of a link win", async () => {
    const token = await tokenFor();
    const statuses = (
      await Promise.all([
        reset(token, "first winner passphrase"),
        reset(token, "second winner passphrase"),
      ])
    ).map((r) => r.status);

    expect(statuses.sort()).toEqual([200, 400]);
  });
});
