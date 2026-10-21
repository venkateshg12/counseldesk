import crypto from "node:crypto";
import type { CookieOptions } from "express";
import { NODE_ENV } from "../constants/env.js";
import { BAD_REQUEST, OK } from "../constants/http.js";
import {
  exchangeGmailAuthCode,
  getGmailAuthUrl,
} from "../services/gmail.service.js";
import { appAssert, catchError } from "../utils/errors/index.js";
import { logger } from "../utils/logger.js";

const STATE_COOKIE = "gmail_oauth_state";

// Scoped to this flow's path. Lax is enough: Google returns the browser with a top-level GET.
const stateCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: NODE_ENV !== "development",
  path: "/auth/gmail",
};

const sameValue = (a: string, b: string) =>
  crypto.timingSafeEqual(
    crypto.createHash("sha256").update(a).digest(),
    crypto.createHash("sha256").update(b).digest(),
  );

// GET /auth/gmail — send the browser to Google's consent screen.
export const gmailAuthorizeHandler = catchError(async (_req, res) => {
  // A random state tied to this browser stops someone else's authorization from being replayed here.
  const state = crypto.randomBytes(32).toString("hex");
  res.cookie(STATE_COOKIE, state, {
    ...stateCookieOptions,
    maxAge: 10 * 60 * 1000,
  });

  logger.info("[gmail] OAuth authorization started");
  res.redirect(getGmailAuthUrl(state));
});

// GET /auth/gmail/callback — Google sends the browser back here with a one-time code.
export const gmailCallbackHandler = catchError(async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = (req.cookies as Record<string, unknown> | undefined)?.[
    STATE_COOKIE
  ];
  res.clearCookie(STATE_COOKIE, stateCookieOptions);

  appAssert(
    !error,
    BAD_REQUEST,
    "Google authorization was denied or failed; start again at /auth/gmail",
  );
  appAssert(
    typeof state === "string" &&
      typeof expectedState === "string" &&
      sameValue(state, expectedState),
    BAD_REQUEST,
    "Invalid or expired authorization session; start again at /auth/gmail",
  );
  appAssert(
    typeof code === "string" && code.length > 0,
    BAD_REQUEST,
    "Missing authorization code",
  );

  const refreshToken = await exchangeGmailAuthCode(code);

  /*
    The one place the refresh token is shown: the server console, for the person running the setup.
    It is never put in the response, and nothing else in the app logs it. Written straight to stdout
    so the log level and the logger's redaction can't hide or mangle it.
   */
  process.stdout.write(
    "[gmail] Authorization successful. Add this to your .env (or host secrets), then restart:\n" +
      `GMAIL_REFRESH_TOKEN=${refreshToken}\n`,
  );

  res
    .status(OK)
    .type("html")
    .send(
      "<p>Gmail authorization successful. Copy GMAIL_REFRESH_TOKEN from the server console.</p>",
    );
});
