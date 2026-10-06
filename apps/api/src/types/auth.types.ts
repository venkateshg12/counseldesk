import type { Response } from "express";
import type { Models } from "../prisma/contract.js";

export type AccessTokenPayload = {
  userId: Models.public_User["id"];
  sessionId: Models.public_Session["id"];
};

export type RefreshTokenPayload = {
  sessionId: Models.public_Session["id"];
  jti: string;
};

export type CookieParams = {
  res: Response;
  accessToken: string;
  refreshToken: string;
};
