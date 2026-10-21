import {
  staffForgotPasswordSchema,
  staffLoginSchema,
  staffResetPasswordSchema,
} from "@repo/types";
import { catchError, appAssert } from "../utils/errors/index.js";
import { OK, NOT_FOUND, UNAUTHORIZED } from "../constants/http.js";
import { ok } from "../utils/api/index.js";
import { orm } from "../prisma/db.js";
import {
  loginUser,
  requestPasswordReset,
  resetPassword,
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

export const meHandler = catchError(async (req, res) => {
  const user = await orm.User.where({ id: req.userId })
    .select("id", "email", "name")
    .first();
  appAssert(user, NOT_FOUND, "User not found");
  res.status(OK).json(ok({ user }));
});

export const forgotPasswordHandler = catchError(async (req, res) => {
  const { email } = staffForgotPasswordSchema.parse(req.body);
  res.status(OK).json(ok(await requestPasswordReset(email)));
});

export const resetPasswordHandler = catchError(async (req, res) => {
  // The token travels in the body, not the URL, so it stays out of access logs and referrers.
  const { token, password } = staffResetPasswordSchema.parse(req.body);
  const result = await resetPassword({ token, password });
  // Every session was just ended; drop this browser's cookies too.
  clearAuthCookies(res).status(OK).json(ok(result));
});
