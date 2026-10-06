import { staffLoginSchema } from "@repo/types";
import { catchError, appAssert } from "../utils/errors/index.js";
import { OK, UNAUTHORIZED } from "../constants/http.js";
import { ok } from "../utils/api/index.js";
import {
  loginUser,
  revokeSessions,
  refreshUserAccessToken,
} from "../services/auth.service.js";
import {
  clearAuthCookies,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
  setAuthCookies,
  verifyAccessTokenIgnoringExpiry,
} from "../utils/auth/index.js";

export const loginHandler = catchError(async (req, res) => {
  const request = staffLoginSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await loginUser(
    request,
    req.headers["user-agent"],
  );

  setAuthCookies({ res, accessToken, refreshToken })
    .status(OK)
    .json(ok({ user }));
});

export const logoutHandler = catchError(async (req, res) => {
  const accessToken = req.cookies.accessToken as string | undefined;
  // An expired access token still identifies the session to delete.
  const { payload } = accessToken
    ? verifyAccessTokenIgnoringExpiry(accessToken)
    : {};
  if (payload) {
    await revokeSessions({ id: payload.sessionId });
  }

  clearAuthCookies(res)
    .status(OK)
    .json(ok({ message: "Logged out" }));
});

export const refreshHandler = catchError(async (req, res) => {
  const refreshToken = req.cookies.refreshToken as string | undefined;
  appAssert(refreshToken, UNAUTHORIZED, "Missing refresh token");

  const { accessToken, newRefreshToken } =
    await refreshUserAccessToken(refreshToken);

  // Refresh tokens are single-use, so a new one is issued on every refresh.
  res
    .status(OK)
    .cookie("refreshToken", newRefreshToken, getRefreshTokenCookieOptions())
    .cookie("accessToken", accessToken, getAccessTokenCookieOptions())
    .json(ok({ message: "Access token refreshed" }));
});
