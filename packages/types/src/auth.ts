import { z } from "zod";

// Trimmed and lowercased, so "Ana@Firm.com" and "ana@firm.com" are the same account.
const emailField = z.string().trim().toLowerCase().email().max(255);

export const staffLoginSchema = z.object({
  email: emailField,
  // Login checks only presence; strength rules belong to setting a password (the seed script).
  password: z.string().min(1, { message: "Password is required" }).max(255),
});

export type StaffLogin = z.infer<typeof staffLoginSchema>;
