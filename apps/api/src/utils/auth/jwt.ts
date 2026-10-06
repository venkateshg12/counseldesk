import type { SignOptions, VerifyOptions } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import { JWT_REFRESH_SECRET, JWT_SECRET } from "../../constants/env.js";
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from "../../types/auth.types.js";

type SignOptionsAndSecret = SignOptions & {
  secret: string;
};

type VerifyOptionsAndSecret = VerifyOptions & {
  secret: string;
};

const ALGORITHM = "HS256";

const accessTokenSignOptions: SignOptionsAndSecret = {
  expiresIn: "15m",
  audience: "access",
  algorithm: ALGORITHM,
  secret: JWT_SECRET,
};

export const refreshTokenSignOptions: SignOptionsAndSecret = {
  expiresIn: "30d",
  audience: "refresh",
  algorithm: ALGORITHM,
  secret: JWT_REFRESH_SECRET,
};

const accessTokenVerifyOptions: VerifyOptionsAndSecret = {
  audience: "access",
  algorithms: [ALGORITHM],
  secret: JWT_SECRET,
};

export const refreshTokenVerifyOptions: VerifyOptionsAndSecret = {
  audience: "refresh",
  algorithms: [ALGORITHM],
  secret: JWT_REFRESH_SECRET,
};

export const signToken = (
  payload: AccessTokenPayload | RefreshTokenPayload,
  options?: SignOptionsAndSecret,
) => {
  const { secret, ...signOpts } = options || accessTokenSignOptions;
  return jwt.sign(payload, secret, signOpts);
};

export const verifyToken = <TPayload extends object = AccessTokenPayload>(
  token: string,
  options?: VerifyOptionsAndSecret,
) => {
  const { secret, ...verifyOpts } = options || accessTokenVerifyOptions;
  try {
    const payload = jwt.verify(token, secret, { ...verifyOpts }) as TPayload;
    return {
      payload,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        error: error.message,
      };
    }

    return {
      error: "Unknown error occured please try again!",
    };
  }
};

/*
  Verifies an access token's signature, audience and algorithm but not its expiry. Only for
  identifying which session a caller holds — logout must still find the session to delete after
  the 15-minute access token has lapsed. Never use it to authorize a request.
 */
export const verifyAccessTokenIgnoringExpiry = (token: string) =>
  verifyToken(token, { ...accessTokenVerifyOptions, ignoreExpiration: true });
