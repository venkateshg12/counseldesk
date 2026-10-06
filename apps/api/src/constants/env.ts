const getEnv = (key: string, defaultValue?: string) => {
  const value = process.env[key] || defaultValue;

  if (value === undefined) {
    throw new Error(`Missing environment variable ${key}`);
  }

  return value;
};

export const PORT = getEnv("PORT", "4000");
export const NODE_ENV = getEnv("NODE_ENV");
export const CORS_ORIGIN = getEnv("CORS_ORIGIN");
export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");
export const DATABASE_URL = getEnv("DATABASE_URL");
export const JWT_SECRET = getEnv("JWT_SECRET");
export const JWT_REFRESH_SECRET = getEnv("JWT_REFRESH_SECRET");

/*
  HS256 secrets are only as strong as their entropy: a short or guessable one can be brute-forced
  offline from any single token, after which anyone can mint tokens for any user. The two must also
  differ, or a refresh token would verify as an access token.
 */
const MIN_JWT_SECRET_LENGTH = 32;

if (
  JWT_SECRET.length < MIN_JWT_SECRET_LENGTH ||
  JWT_REFRESH_SECRET.length < MIN_JWT_SECRET_LENGTH
) {
  throw new Error(
    `JWT_SECRET and JWT_REFRESH_SECRET must each be at least ${MIN_JWT_SECRET_LENGTH} characters (generate with: openssl rand -hex 32)`,
  );
}

if (JWT_SECRET === JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be different values");
}

export const REDIS_HOST = getEnv("REDIS_HOST");
export const REDIS_PORT = getEnv("REDIS_PORT");
// Empty for a local passwordless Redis; set both for a hosted one.
export const REDIS_USERNAME = getEnv("REDIS_USERNAME", "");
export const REDIS_PASSWORD = getEnv("REDIS_PASSWORD", "");
export const TRUSTED_PROXY_CIDRS = getEnv("TRUSTED_PROXY_CIDRS", "");
