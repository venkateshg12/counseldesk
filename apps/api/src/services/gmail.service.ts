import { gmail, type gmail_v1 } from "@googleapis/gmail";
import {
  GMAIL_REDIRECT_URI,
  GMAIL_REFRESH_TOKEN,
  GMAIL_SENDER_ADDRESS,
  GMAIL_SENDER_NAME,
} from "../constants/env.js";
import {
  BAD_GATEWAY,
  BAD_REQUEST,
  INTERNAL_SERVER_ERROR,
  TOO_MANY_REQUESTS,
  type HttpStatusCode,
} from "../constants/http.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import { GMAIL_SCOPES, getGmailOAuthClient } from "../config/gmail.js";
import { AppError, appAssert } from "../utils/errors/index.js";
import {
  buildMimeMessage,
  formatFromHeader,
  sendEmailSchema,
  type SendEmailInput,
} from "../utils/email/mime.js";
import { logger } from "../utils/logger.js";

/*
  Sends mail through the Gmail API as GMAIL_SENDER_ADDRESS, using a long-lived refresh token: the
  OAuth2 client exchanges it for short-lived access tokens by itself, so nobody signs in per email.

  Free of req/res and of any queue, so it is called from the BullMQ processors unchanged.
 */

type GoogleErrorShape = {
  code?: string | number;
  response?: { status?: number; data?: { error?: unknown } };
};

/*
  Reduces a googleapis failure to an AppError. The raw error is never logged or returned: a Gaxios
  error carries the request config, including the Authorization header and the client secret.
 */
const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;

  const { code, response } = (error ?? {}) as GoogleErrorShape;
  const status = response?.status;
  const body = response?.data?.error;

  // The token endpoint answers with a string ("invalid_grant"); the Gmail API with an object.
  const oauthError = typeof body === "string" ? body : undefined;
  const apiReason =
    typeof body === "object" && body !== null
      ? ((body as { errors?: { reason?: string }[] }).errors?.[0]?.reason ??
        (body as { status?: string }).status)
      : undefined;

  logger.error("[gmail] failed to send email", {
    status,
    code,
    oauthError,
    apiReason,
  });

  const fail = (
    httpStatus: HttpStatusCode,
    message: string,
    errorCode: appErrorCode,
  ) => new AppError(httpStatus, message, errorCode);

  if (
    oauthError === "invalid_grant" ||
    oauthError === "invalid_client" ||
    oauthError === "unauthorized_client" ||
    status === 401
  ) {
    return fail(
      INTERNAL_SERVER_ERROR,
      "Gmail authorization is invalid or has expired; re-run the Gmail authorization and update GMAIL_REFRESH_TOKEN",
      appErrorCode.GmailAuthInvalid,
    );
  }
  if (
    status === 429 ||
    (status === 403 && /ratelimit|dailylimit|quota/i.test(apiReason ?? ""))
  ) {
    return fail(
      TOO_MANY_REQUESTS,
      "Gmail sending limit reached; try again later",
      appErrorCode.GmailSendFailed,
    );
  }
  if (status === 400) {
    return fail(
      BAD_REQUEST,
      "Gmail rejected the message; check the recipient and content",
      appErrorCode.GmailSendFailed,
    );
  }
  if (status === 403) {
    return fail(
      BAD_GATEWAY,
      "Gmail denied the request; check the Gmail API is enabled and the gmail.send scope was granted",
      appErrorCode.GmailSendFailed,
    );
  }
  return fail(
    BAD_GATEWAY,
    "Failed to send email through Gmail",
    appErrorCode.GmailSendFailed,
  );
};

let gmailClient: gmail_v1.Gmail | undefined;

const getGmailClient = (): gmail_v1.Gmail => {
  appAssert(
    GMAIL_REFRESH_TOKEN && GMAIL_SENDER_ADDRESS,
    INTERNAL_SERVER_ERROR,
    "Gmail is not authorized yet (GMAIL_REFRESH_TOKEN and GMAIL_SENDER_ADDRESS must be set); complete the one-time Gmail authorization",
    appErrorCode.GmailNotConfigured,
  );

  if (!gmailClient) {
    const auth = getGmailOAuthClient();
    // Only the refresh token is stored; the client fetches and renews access tokens itself.
    auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
    gmailClient = gmail({ version: "v1", auth });
  }
  return gmailClient;
};

export const sendEmail = async (
  input: SendEmailInput,
): Promise<{ messageId: string }> => {
  const email = sendEmailSchema.parse(input);
  const client = getGmailClient();

  const raw = Buffer.from(
    buildMimeMessage(
      email,
      formatFromHeader(GMAIL_SENDER_ADDRESS, GMAIL_SENDER_NAME),
    ),
    "utf8",
  ).toString("base64url");

  try {
    const { data } = await client.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    logger.info("[gmail] email sent", { messageId: data.id });
    return { messageId: data.id ?? "" };
  } catch (error) {
    throw toAppError(error);
  }
};

/*
  One-time authorization: the browser flow that produces GMAIL_REFRESH_TOKEN.
 */

const redirectConfigured = () =>
  appAssert(
    GMAIL_REDIRECT_URI,
    INTERNAL_SERVER_ERROR,
    "GMAIL_REDIRECT_URI is not set",
    appErrorCode.GmailNotConfigured,
  );

export const getGmailAuthUrl = (state: string): string => {
  redirectConfigured();
  return getGmailOAuthClient().generateAuthUrl({
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // and make Google issue one even if this account authorized before
    scope: GMAIL_SCOPES,
    state,
    // Pre-selects the sender account so a personal account isn't picked by accident.
    login_hint: GMAIL_SENDER_ADDRESS || undefined,
  });
};

export const exchangeGmailAuthCode = async (code: string): Promise<string> => {
  redirectConfigured();

  const tokens = await getGmailOAuthClient()
    .getToken(code)
    .then(({ tokens }) => tokens)
    .catch((error: unknown) => {
      // Never log the error object itself: it can carry the code and client secret.
      const status = (error as GoogleErrorShape)?.response?.status;
      logger.error("[gmail] authorization code exchange failed", { status });
      throw new AppError(
        BAD_REQUEST,
        "Invalid or expired authorization code; start again at /auth/gmail",
        appErrorCode.GmailAuthInvalid,
      );
    });

  appAssert(
    tokens.scope?.split(" ").includes(GMAIL_SCOPES[0]!),
    BAD_REQUEST,
    "The gmail.send permission was not granted",
    appErrorCode.GmailAuthInvalid,
  );
  appAssert(
    tokens.refresh_token,
    BAD_GATEWAY,
    "Google did not return a refresh token; remove this app at myaccount.google.com/permissions for the sender account and try again",
    appErrorCode.GmailAuthInvalid,
  );

  return tokens.refresh_token;
};
