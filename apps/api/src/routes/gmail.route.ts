import { Router } from "express";
import {
  gmailAuthorizeHandler,
  gmailCallbackHandler,
} from "../controllers/gmailAuth.controller.js";
import { GMAIL_OAUTH_SETUP, NODE_ENV } from "../constants/env.js";

export const gmailRoutes = Router();

// prefix: /auth/gmail  (the path is fixed by the redirect URI registered with Google)

/*
  The one-time authorization flow. Anyone who can open it can park a Gmail refresh token in the
  server log, so in production it is off unless GMAIL_OAUTH_SETUP=true (set it only while
  re-authorizing, e.g. when a Google "Testing" token expires after 7 days).
 */
if (NODE_ENV !== "production" || GMAIL_OAUTH_SETUP === "true") {
  gmailRoutes.get("/", gmailAuthorizeHandler);
  gmailRoutes.get("/callback", gmailCallbackHandler);
}
