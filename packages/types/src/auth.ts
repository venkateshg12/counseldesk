import { z } from "zod";

// Trimmed and lowercased, so "Ana@Firm.com" and "ana@firm.com" are the same account.
const emailField = z.string().trim().toLowerCase().email().max(255);

export const staffLoginSchema = z.object({
  email: emailField,
  // Login checks only presence; strength rules belong to setting a password (the seed script).
  password: z.string().min(1, { message: "Password is required" }).max(255),
});

export type StaffLogin = z.infer<typeof staffLoginSchema>;

export const MIN_PASSWORD_LENGTH = 12;
// bcrypt reads only the first 72 bytes, so anything longer would be silently truncated.
export const MAX_PASSWORD_BYTES = 72;

// Same rule as the seed script: this is where strength is enforced, not at login.
const newPasswordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES,
    {
      message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes`,
    },
  );

export const staffForgotPasswordSchema = z.object({ email: emailField });

export type StaffForgotPassword = z.infer<typeof staffForgotPasswordSchema>;

export const staffResetPasswordSchema = z
  .object({
    token: z.string().min(1, { message: "Reset link is missing" }).max(512),
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type StaffResetPassword = z.infer<typeof staffResetPasswordSchema>;
