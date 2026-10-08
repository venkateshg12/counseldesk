import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  app = await startApp();
});
afterAll(() => app.close());

describe("chat rate limit", () => {
  it("allows 20 messages per visitor per 10 minutes, then answers 429", async () => {
    const client = createClient(app.baseUrl);
    const send = () =>
      client("/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
      });

    for (let i = 0; i < 20; i++) {
      const response = await send();
      expect(response.status).toBe(200);
      await response.text(); // drain the stream
    }
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await limited.json()).errors[0].code).toBe("TOO_MANY_REQUESTS");
  });
});
