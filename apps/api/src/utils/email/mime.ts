import crypto from "node:crypto";
import { z } from "zod";

/*
  Pure MIME building for outgoing mail: no environment, no network, so it can be unit-tested and
  reused. The sender identity is passed in by the caller, never taken from message input.
 */

const hasText = (value?: string) => Boolean(value?.trim());

// Header values must be a single line: a CR/LF here is how header injection happens.
const singleLine = z
  .string()
  .trim()
  .refine((value) => !/[\r\n]/.test(value), "Must be a single line");

export const sendEmailSchema = z
  .object({
    to: z.string().trim().pipe(z.email("Invalid recipient email address")),
    subject: singleLine.pipe(
      z.string().min(1, "Subject is required").max(300, "Subject is too long"),
    ),
    text: z.string().optional(),
    html: z.string().optional(),
  })
  .refine((email) => hasText(email.text) || hasText(email.html), {
    message: "Provide a text body, an html body, or both",
    path: ["text"],
  });

// Deliberately has no `from`: the sender identity belongs to the application, not the caller.
export type SendEmailInput = z.input<typeof sendEmailSchema>;
export type ValidEmail = z.output<typeof sendEmailSchema>;

const CRLF = "\r\n";
const isAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);

// RFC 2047 encoded-words are capped at 75 characters, so long non-ASCII values are split on
// character boundaries (never mid-code-point) into several words.
export const encodeHeaderValue = (value: string): string => {
  if (isAscii(value)) return value;

  const MAX_CHUNK_BYTES = 45; // 45 bytes -> 60 base64 chars, plus 12 of "=?UTF-8?B??="
  const words: string[] = [];
  let chunk = "";

  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > MAX_CHUNK_BYTES) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);

  return words
    .map(
      (word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`,
    )
    .join(`${CRLF} `);
};

export const formatFromHeader = (address: string, senderName: string) => {
  // Control characters have no place in a display name, and would break the header.
  // eslint-disable-next-line no-control-regex
  const name = senderName.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) return address;

  const displayName = isAscii(name)
    ? `"${name.replace(/(["\\])/g, "\\$1")}"`
    : encodeHeaderValue(name);
  return `${displayName} <${address}>`;
};

// Base64 bodies are wrapped at 76 characters, as MIME requires.
const encodeBody = (content: string) =>
  Buffer.from(content, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&" + CRLF)
    .trimEnd();

const bodyPart = (contentType: "text/plain" | "text/html", content: string) =>
  [
    `Content-Type: ${contentType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(content),
  ].join(CRLF);

export const buildMimeMessage = (
  { to, subject, text, html }: ValidEmail,
  from: string,
): string => {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    "MIME-Version: 1.0",
  ];

  const textBody = hasText(text) ? text! : undefined;
  const htmlBody = hasText(html) ? html! : undefined;

  // Only one body: a plain single-part message.
  if (!textBody || !htmlBody) {
    const [contentType, content] = htmlBody
      ? (["text/html", htmlBody] as const)
      : (["text/plain", textBody!] as const);
    return [...headers, bodyPart(contentType, content)].join(CRLF);
  }

  // Both: multipart/alternative, plain text first so clients prefer the last (html) part.
  const boundary = `alt_${crypto.randomBytes(16).toString("hex")}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    bodyPart("text/plain", textBody),
    `--${boundary}`,
    bodyPart("text/html", htmlBody),
    `--${boundary}--`,
    "",
  ].join(CRLF);
};
