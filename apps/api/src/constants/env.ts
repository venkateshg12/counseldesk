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
