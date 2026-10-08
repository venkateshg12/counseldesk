import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ChatEvent } from "@repo/types";
import { createApp } from "../src/app.js";
import { pool } from "../src/prisma/db.js";
import { redisConnection } from "../src/jobs/redis/connection.js";
import { fakeLlm } from "../src/ai/providers/fake.js";

export { fakeLlm };

export const startApp = async () => {
  const server: Server = createApp().listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
};

// Every table except Prisma's own bookkeeping, emptied in one statement.
export const resetDb = async () => {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length)
    await pool.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  await redisConnection.flushdb();
  fakeLlm.reset();
};

// Reads a whole SSE response into its events.
export const readSse = async (response: Response) => {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
};

// fetch with a cookie jar, so the visitorId and auth cookies persist across calls in one test.
// `cookie` / `setCookie` let a test read a token or replay an old one.
export const createClient = (baseUrl: string) => {
  const jar = new Map<string, string>();
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...init.headers,
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const [name, value] = pair!.split("=");
      if (value) jar.set(name!, value);
      else jar.delete(name!);
    }
    return response;
  };
  return Object.assign(request, {
    cookie: (name: string) => jar.get(name),
    setCookie: (name: string, value: string) => jar.set(name, value),
  });
};
