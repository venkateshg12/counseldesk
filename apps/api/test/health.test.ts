import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  await resetDb();
  app = await startApp();
});
afterAll(() => app.close());

describe("GET /health", () => {
  it("reports postgres and redis up", async () => {
    const response = await fetch(`${app.baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "success",
      data: { postgres: "up", redis: "up" },
    });
  });
});
