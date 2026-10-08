// SQLSTATE 23505: a unique constraint refused the row. Same check as the e-commerce port's catalog service.
export const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; sqlState?: string } | null;
  return e?.sqlState === "23505" || e?.code === "23505";
};
