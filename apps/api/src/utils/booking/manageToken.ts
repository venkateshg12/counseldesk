import crypto from "node:crypto";

/*
  The link in a confirmation email that lets the visitor view, cancel or reschedule one appointment,
  with no account. Like the password-reset link, nothing about it is stored: it is
  `<appointmentId>.<linkVersion>.<signature>`, an HMAC over the id and the appointment's current
  link version. Cancelling or rescheduling bumps the version, so every older link stops verifying.
  The key is derived from a server secret with a purpose label, so it can't be confused with any
  other signing key.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyFor = (secret: string) =>
  crypto
    .createHmac("sha256", secret)
    .update("counseldesk:booking-link:v1")
    .digest();

const sign = (secret: string, appointmentId: string, version: number) =>
  crypto
    .createHmac("sha256", keyFor(secret))
    .update(`${appointmentId}:${version}`)
    .digest("base64url");

export const createManageToken = (
  secret: string,
  appointmentId: string,
  version: number,
) => `${appointmentId}.${version}.${sign(secret, appointmentId, version)}`;

/** True only for a well-formed token for this appointment at its current link version. */
export const verifyManageToken = (
  secret: string,
  token: string,
  appointmentId: string,
  currentVersion: number,
) => {
  const [id, versionText, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !id || !versionText || !signature) return false;
  if (!UUID.test(id) || id !== appointmentId) return false;
  if (!/^\d{1,9}$/.test(versionText) || Number(versionText) !== currentVersion)
    return false;

  const expected = Buffer.from(sign(secret, id, currentVersion));
  const actual = Buffer.from(signature);
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
};

/** The appointment id inside a token, without trusting it: the signature is checked afterwards. */
export const appointmentIdFromToken = (token: string) => {
  const id = token.split(".")[0];
  return id && UUID.test(id) ? id : null;
};
