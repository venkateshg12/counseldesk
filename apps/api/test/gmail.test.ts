import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const SECRETS = {
  clientSecret: "test-client-secret-value",
  refreshToken: "test-refresh-token-value",
};

// The Gmail settings must exist before env.ts is first imported, so they are set in a hoisted block.
const google = vi.hoisted(() => {
  process.env.GMAIL_CLIENT_ID = "test-client-id";
  process.env.GMAIL_CLIENT_SECRET = "test-client-secret-value";
  process.env.GMAIL_REDIRECT_URI = "http://localhost:4000/auth/gmail/callback";
  process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token-value";
  process.env.GMAIL_SENDER_ADDRESS = "noreply@firm.test";
  process.env.GMAIL_SENDER_NAME = "Harbor & Vale";
  return {
    send: vi.fn(),
    getToken: vi.fn(),
    setCredentials: vi.fn(),
  };
});

vi.mock("@googleapis/gmail", () => {
  class OAuth2 {
    constructor(
      readonly id: string,
      readonly secret: string,
      readonly redirect?: string,
    ) {}
    setCredentials = google.setCredentials;
    getToken = google.getToken;
    generateAuthUrl(options: {
      access_type: string;
      prompt: string;
      scope: string[];
      state: string;
      login_hint?: string;
    }) {
      const query = new URLSearchParams({
        client_id: this.id,
        redirect_uri: this.redirect ?? "",
        response_type: "code",
        access_type: options.access_type,
        prompt: options.prompt,
        scope: options.scope.join(" "),
        state: options.state,
        login_hint: options.login_hint ?? "",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
    }
  }
  return {
    auth: { OAuth2 },
    gmail: () => ({ users: { messages: { send: google.send } } }),
  };
});

import { AppError } from "../src/utils/errors/index.js";
import { sendEmail } from "../src/services/gmail.service.js";
import { sendMail } from "../src/utils/email/index.js";
import { createClient, resetDb, startApp } from "./helpers.js";

const mail = {
  to: "ana@firm.test",
  subject: "Hello",
  text: "Plain",
  html: "<p>Rich</p>",
};

const googleError = (status: number, error: unknown) => ({
  response: { status, data: { error } },
  config: { headers: { Authorization: `Bearer ${SECRETS.refreshToken}` } },
});

let app: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  await resetDb();
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  google.send.mockReset().mockResolvedValue({ data: { id: "msg-123" } });
  google.getToken.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("sendEmail", () => {
  it("sends one raw MIME message as the configured sender, with the refresh token", async () => {
    expect(await sendEmail(mail)).toEqual({ messageId: "msg-123" });

    expect(google.setCredentials).toHaveBeenCalledWith({
      refresh_token: SECRETS.refreshToken,
    });
    const request = google.send.mock.calls[0]![0];
    expect(request.userId).toBe("me");
    const raw = Buffer.from(request.requestBody.raw, "base64url").toString();
    expect(raw).toContain('From: "Harbor & Vale" <noreply@firm.test>');
    expect(raw).toContain("To: ana@firm.test");
    expect(raw).toContain("Subject: Hello");
    expect(raw).toContain("multipart/alternative");
  });

  it("refuses bad input before calling Google", async () => {
    await expect(sendEmail({ ...mail, to: "nope" })).rejects.toThrow();
    await expect(
      sendEmail({ ...mail, subject: "Hi\r\nBcc: x@evil.test" }),
    ).rejects.toThrow();
    expect(google.send).not.toHaveBeenCalled();
  });

  it.each([
    [401, { status: "UNAUTHENTICATED" }, 500, "GMAIL_AUTH_INVALID"],
    [400, "invalid_grant", 500, "GMAIL_AUTH_INVALID"],
    [
      429,
      { errors: [{ reason: "rateLimitExceeded" }] },
      429,
      "GMAIL_SEND_FAILED",
    ],
    [
      403,
      { errors: [{ reason: "dailyLimitExceeded" }] },
      429,
      "GMAIL_SEND_FAILED",
    ],
    [
      403,
      { errors: [{ reason: "accessNotConfigured" }] },
      502,
      "GMAIL_SEND_FAILED",
    ],
    [
      400,
      { errors: [{ reason: "invalidArgument" }] },
      400,
      "GMAIL_SEND_FAILED",
    ],
    [500, { status: "INTERNAL" }, 502, "GMAIL_SEND_FAILED"],
  ])(
    "maps Google %i %j to HTTP %i / %s without leaking secrets",
    async (status, body, httpStatus, code) => {
      google.send.mockRejectedValue(googleError(status, body));

      const error = (await sendEmail(mail).catch(
        (e: unknown) => e,
      )) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(httpStatus);
      expect(error.errorCode).toBe(code);
      for (const secret of Object.values(SECRETS))
        expect(error.message).not.toContain(secret);
    },
  );
});

describe("sendMail", () => {
  it("reports success as { data, error: null }", async () => {
    expect(await sendMail(mail)).toEqual({
      data: { id: "msg-123" },
      error: null,
    });
  });

  it("returns the failure instead of throwing, so the processor can retry", async () => {
    google.send.mockRejectedValue(googleError(500, { status: "INTERNAL" }));
    const result = await sendMail(mail);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(AppError);
  });
});

describe("authorization flow", () => {
  const start = async () => {
    const client = createClient(app.baseUrl);
    const response = await client("/auth/gmail", { redirect: "manual" });
    const location = new URL(response.headers.get("location")!);
    return { client, response, location };
  };

  it("redirects to Google asking for send-only offline access", async () => {
    const { client, response, location } = await start();

    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.send",
    );
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");
    expect(location.searchParams.get("login_hint")).toBe("noreply@firm.test");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/auth/gmail/callback",
    );
    expect(client.cookie("gmail_oauth_state")).toBe(
      location.searchParams.get("state"),
    );
  });

  it("prints the refresh token once, to stdout only, and never returns it", async () => {
    const { client, location } = await start();
    google.getToken.mockResolvedValue({
      tokens: {
        refresh_token: "fresh-refresh-token",
        scope: "https://www.googleapis.com/auth/gmail.send",
      },
    });
    const write = vi.spyOn(process.stdout, "write");

    const response = await client(
      `/auth/gmail/callback?code=abc&state=${location.searchParams.get("state")}`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("fresh-refresh-token");
    expect(
      write.mock.calls.some((call) =>
        String(call[0]).includes("GMAIL_REFRESH_TOKEN=fresh-refresh-token"),
      ),
    ).toBe(true);
  });

  it("rejects a callback with a missing or wrong state", async () => {
    const { client } = await start();
    const wrong = await client("/auth/gmail/callback?code=abc&state=nope");
    expect(wrong.status).toBe(400);

    const stranger = createClient(app.baseUrl); // never started the flow: no state cookie
    const missing = await stranger("/auth/gmail/callback?code=abc&state=x");
    expect(missing.status).toBe(400);
    expect(google.getToken).not.toHaveBeenCalled();
  });

  it("rejects a denied consent, a missing code, a bad code, a missing scope and a missing refresh token", async () => {
    const callback = async (query: string) => {
      const { client, location } = await start();
      const state = location.searchParams.get("state");
      return (await client(`/auth/gmail/callback?${query}&state=${state}`))
        .status;
    };

    expect(await callback("error=access_denied")).toBe(400);
    expect(await callback("foo=bar")).toBe(400);

    google.getToken.mockRejectedValue(googleError(400, "invalid_grant"));
    expect(await callback("code=bad")).toBe(400);

    google.getToken.mockResolvedValue({
      tokens: {
        refresh_token: "x",
        scope: "https://www.googleapis.com/auth/userinfo.email",
      },
    });
    expect(await callback("code=abc")).toBe(400);

    google.getToken.mockResolvedValue({
      tokens: { scope: "https://www.googleapis.com/auth/gmail.send" },
    });
    expect(await callback("code=abc")).toBe(502);
  });
});
