import type { CookieOptions, Response } from "express";
import { NODE_ENV, PUBLIC_PATH_PREFIX } from "../../constants/env.js";
import { fifteenMinutesFromNow, thirtyDaysFromNow } from "../date/date.js";
import type { CookieParams } from "../../types/auth.types.js";

const secure = NODE_ENV !== "development";
export const REFRESH_PATH = "/auth/refresh"; // the route, as the API sees it
const REFRESH_COOKIE_PATH = `${PUBLIC_PATH_PREFIX}${REFRESH_PATH}`; // the path the browser requests

const defaults: CookieOptions = {
  // "none" lets the staff page on Vercel send these to the API on Render (different sites), but
  // browsers drop SameSite=None cookies that aren't Secure. Locally both are one site, so "lax".
  sameSite: secure ? "none" : "lax",
  httpOnly: true,
  secure,
};

export const getAccessTokenCookieOptions = (): CookieOptions => ({
  ...defaults,
  expires: fifteenMinutesFromNow(),
});

export const getRefreshTokenCookieOptions = (): CookieOptions => ({
  ...defaults,
  expires: thirtyDaysFromNow(),
  path: REFRESH_COOKIE_PATH,
});

export const setAuthCookies = ({
  res,
  accessToken,
  refreshToken,
}: CookieParams) =>
  res
    .cookie("accessToken", accessToken, getAccessTokenCookieOptions())
    .cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

export const clearAuthCookies = (res: Response) =>
  res
    .clearCookie("accessToken", defaults)
    .clearCookie("refreshToken", { ...defaults, path: REFRESH_COOKIE_PATH });
