const getEnv = (key: string, defaultValue?: string) => {
  const value = process.env[key] || defaultValue;

  if (value === undefined) {
    throw new Error(`Missing environment variable ${key}`);
  }

  return value;
};

export const PORT = getEnv("PORT", "4000");
export const NODE_ENV = getEnv("NODE_ENV");

// "real" uses Gemini + Groq/Nvidia; "fake" uses the scripted/heuristic provider (tests and E2E only).
export const LLM_PROVIDER = getEnv("LLM_PROVIDER", "real");
if (LLM_PROVIDER === "fake" && NODE_ENV === "production") {
  throw new Error("LLM_PROVIDER=fake is not allowed in production");
}

export const CORS_ORIGIN = getEnv("CORS_ORIGIN");
export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");
export const DATABASE_URL = getEnv("DATABASE_URL");
export const JWT_SECRET = getEnv("JWT_SECRET");
export const JWT_REFRESH_SECRET = getEnv("JWT_REFRESH_SECRET");
// Prefix a proxy puts in front of the API's routes ("" when called directly, "/api" behind proxy)
export const PUBLIC_PATH_PREFIX = getEnv("PUBLIC_PATH_PREFIX", "");

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
// Redis logical database. Tests use 1 so flushing it never touches development data.
export const REDIS_DB = getEnv("REDIS_DB", "0");
// Empty for a local passwordless Redis; set both for a hosted one.
export const REDIS_USERNAME = getEnv("REDIS_USERNAME", "");
export const REDIS_PASSWORD = getEnv("REDIS_PASSWORD", "");
export const TRUSTED_PROXY_CIDRS = getEnv("TRUSTED_PROXY_CIDRS", "");

export const RESEND_API_KEY = getEnv("RESEND_API_KEY", "");
export const EMAIL_FROM = getEnv("EMAIL_FROM", "onboarding@resend.dev");
export const STAFF_NOTIFY_EMAIL = getEnv("STAFF_NOTIFY_EMAIL");
// Where staff open a conversation (Phase 36). Defaults to the first allowed origin.
export const STAFF_APP_URL = getEnv(
  "STAFF_APP_URL",
  CORS_ORIGIN.split(",")[0]!.trim(),
);
export const ENABLE_QUEUE_DASHBOARD = getEnv("ENABLE_QUEUE_DASHBOARD", "false");
export const QUEUE_DASHBOARD_USER = getEnv("QUEUE_DASHBOARD_USER", "");
export const QUEUE_DASHBOARD_PASSWORD = getEnv("QUEUE_DASHBOARD_PASSWORD", "");

const llmDefault = LLM_PROVIDER === "fake" ? "fake" : undefined;

export const NVIDIA_EMBEDDING_API_KEY = getEnv(
  "NVIDIA_EMBEDDING_API_KEY",
  process.env.NVIDIA_API_KEY || process.env.GEMINI_API_KEY || llmDefault || "",
);
export const NVIDIA_CHAT_API_KEY = getEnv(
  "NVIDIA_CHAT_API_KEY",
  process.env.NVIDIA_API_KEY || llmDefault || "",
);
export const NVIDIA_API_KEY =
  process.env.NVIDIA_API_KEY || NVIDIA_EMBEDDING_API_KEY;
export const NVIDIA_EMBEDDING_MODEL = getEnv(
  "NVIDIA_EMBEDDING_MODEL",
  "nvidia/nemotron-3-embed-1b",
);
export const NVIDIA_CHAT_MODEL = getEnv(
  "NVIDIA_CHAT_MODEL",
  "nvidia/nemotron-3-ultra-550b-a55b",
);

export const GEMINI_API_KEY = getEnv("GEMINI_API_KEY", llmDefault || "");
export const GEMINI_EMBEDDING_MODEL = getEnv(
  "GEMINI_EMBEDDING_MODEL",
  "gemini-embedding-2",
);
// Pin an exact model id, never an alias like "-latest": an alias can move and change eval results.
export const GEMINI_CHAT_MODEL = getEnv(
  "GEMINI_CHAT_MODEL",
  "gemini-3.6-flash",
);

// Where the firm's website lives; citation links point here.
export const SITE_URL = getEnv("SITE_URL").replace(/\/$/, "");
export const ANSWER_PROMPT_VERSION = getEnv(
  "ANSWER_PROMPT_VERSION",
  "answer.v1",
);

// Experiment knobs (Phase 23). Defaults are the chosen production configuration.
export const KEYWORD_QUERY = getEnv("KEYWORD_QUERY", "or");
export const GEMINI_THINKING_LEVEL = getEnv("GEMINI_THINKING_LEVEL", "low");
export const LLM_PRIMARY = getEnv("LLM_PRIMARY", "gemini");
