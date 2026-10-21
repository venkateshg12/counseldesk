import { auth } from "@googleapis/gmail";
import {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI,
  GMAIL_REFRESH_TOKEN,
  GMAIL_SENDER_ADDRESS,
} from "../constants/env.js";
import { INTERNAL_SERVER_ERROR } from "../constants/http.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import { appAssert } from "../utils/errors/index.js";

// The one permission requested: sending. Never widen this to read/modify/full-mailbox scopes.
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export type GmailOAuthClient = InstanceType<typeof auth.OAuth2>;

// True once the one-time authorization has been done and everything needed to send is present.
export const isGmailConfigured = () =>
  Boolean(
    GMAIL_CLIENT_ID &&
    GMAIL_CLIENT_SECRET &&
    GMAIL_REFRESH_TOKEN &&
    GMAIL_SENDER_ADDRESS,
  );

let oauthClient: GmailOAuthClient | undefined;

/*
  The single OAuth2 client for sending. Created on first use so a server without Gmail configured
  still boots; it then fails here, with a clean error, instead of at import time. Sending needs only
  the client id and secret; the redirect URI matters for the authorization flow alone.
 */
export const getGmailOAuthClient = (): GmailOAuthClient => {
  appAssert(
    GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET,
    INTERNAL_SERVER_ERROR,
    "Gmail is not configured on the server (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)",
    appErrorCode.GmailNotConfigured,
  );

  oauthClient ??= new auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REDIRECT_URI || undefined,
  );
  return oauthClient;
};
