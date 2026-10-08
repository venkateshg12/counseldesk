import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashValue } from "../src/utils/auth/index.js";
import { orm, pool } from "../src/prisma/db.js";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
const credentials = {
  email: "ana@firm.test",
  password: "correct horse battery",
};

beforeAll(async () => {
  await resetDb();
  await orm.User.create({
    email: credentials.email,
    name: "Ana Diaz",
    passwordHash: await hashValue(credentials.password),
  });
  app = await startApp();
});
afterAll(() => app.close());

const login = async () => {
  const client = createClient(app.baseUrl);
  const response = await client("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  return client;
};

describe("staff auth", () => {
  it("logs in, reads /auth/me, logs out", async () => {
    const client = await login();
    expect((await client("/auth/me")).status).toBe(200);

    await client("/auth/logout", { method: "POST" });
    expect((await client("/auth/me")).status).toBe(401);
  });

  it("rejects a wrong password with the same message as an unknown email", async () => {
    const client = createClient(app.baseUrl);
    const wrong = await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({ ...credentials, password: "nope" }),
    });
    const unknown = await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "x@firm.test", password: "nope" }),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("rotates the refresh token, tolerates a just-replaced one, and revokes on later reuse", async () => {
    const client = await login();
    const first = client.cookie("refreshToken")!;

    expect((await client("/auth/refresh")).status).toBe(200);
    expect(client.cookie("refreshToken")).not.toBe(first); // rotated

    // Replaying the old token right away: inside the 30 s grace window, accepted.
    client.setCookie("refreshToken", first);
    expect((await client("/auth/refresh")).status).toBe(200);

    // Pretend the rotation happened a minute ago, then replay again: treated as theft.
    await pool.query(
      `UPDATE "Session" SET "rotatedAt" = now() - interval '60 seconds'`,
    );
    client.setCookie("refreshToken", first);
    const reused = await client("/auth/refresh");
    expect(reused.status).toBe(401);
    expect((await reused.json()).errors[0].message).toBe("Session revoked");
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM "Session"')).rows[0].n,
    ).toBe(0);
  });

  it("stops working as soon as the session row is gone", async () => {
    const client = await login();
    await pool.query('DELETE FROM "Session"');
    expect((await client("/auth/me")).status).toBe(401);
  });
});
