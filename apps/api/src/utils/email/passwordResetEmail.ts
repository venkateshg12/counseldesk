import { STAFF_APP_URL } from "../../constants/env.js";
import { RESET_TOKEN_TTL_MS } from "../auth/passwordReset.js";

// A staff member's name goes into HTML, so it is escaped.
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export const getPasswordResetEmail = (
  user: { name: string },
  token: string,
) => {
  const link = `${STAFF_APP_URL}/staff/reset-password?token=${encodeURIComponent(token)}`;
  const minutes = RESET_TOKEN_TTL_MS / 60_000;
  const intro = `Hi ${user.name}, we received a request to reset your CounselDesk staff password.`;
  const expiry = `This link works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email and your password stays as it is.`;

  return {
    subject: "Reset your CounselDesk password",
    text: `${intro}\n\nChoose a new password: ${link}\n\n${expiry}`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${link}">Choose a new password</a></p><p>${escapeHtml(expiry)}</p>`,
  };
};
