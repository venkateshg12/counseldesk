import { describe, expect, it } from "vitest";
import {
  buildMimeMessage,
  encodeHeaderValue,
  formatFromHeader,
  sendEmailSchema,
} from "./mime.js";

const FROM = "noreply@firm.test";
const build = (input: Parameters<typeof sendEmailSchema.parse>[0]) =>
  buildMimeMessage(sendEmailSchema.parse(input), FROM);

// Base64 body of the part that follows the given content type.
const bodyAfter = (mime: string, contentType: string) => {
  const part = mime.split(`Content-Type: ${contentType}; charset="UTF-8"`)[1]!;
  const encoded = part
    .split("\r\n\r\n")[1]!
    .split("\r\n--")[0]!
    .replace(/\r\n/g, "");
  return Buffer.from(encoded, "base64").toString("utf8");
};

describe("buildMimeMessage", () => {
  it("builds a single-part text message", () => {
    const mime = build({ to: "a@b.test", subject: "Hello", text: "Hi there" });
    expect(mime).toContain(
      `From: ${FROM}\r\nTo: a@b.test\r\nSubject: Hello\r\n`,
    );
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).not.toContain("multipart");
    expect(bodyAfter(mime, "text/plain")).toBe("Hi there");
  });

  it("builds a single-part html message", () => {
    const mime = build({ to: "a@b.test", subject: "Hello", html: "<p>Hi</p>" });
    expect(mime).not.toContain("multipart");
    expect(bodyAfter(mime, "text/html")).toBe("<p>Hi</p>");
  });

  it("sends text and html as multipart/alternative, text first", () => {
    const mime = build({
      to: "a@b.test",
      subject: "Hello",
      text: "plain",
      html: "<b>rich</b>",
    });
    expect(mime).toMatch(
      /Content-Type: multipart\/alternative; boundary="alt_[0-9a-f]{32}"/,
    );
    expect(mime.indexOf("text/plain")).toBeLessThan(mime.indexOf("text/html"));
    expect(bodyAfter(mime, "text/plain")).toBe("plain");
    expect(bodyAfter(mime, "text/html")).toBe("<b>rich</b>");
    expect(mime.trimEnd().endsWith("--")).toBe(true);
  });

  it("wraps encoded bodies at 76 characters", () => {
    const mime = build({
      to: "a@b.test",
      subject: "Long",
      text: "x".repeat(500),
    });
    for (const line of mime.split("\r\n"))
      expect(line.length).toBeLessThanOrEqual(76 + 40);
    expect(bodyAfter(mime, "text/plain")).toBe("x".repeat(500));
  });

  it("keeps non-ASCII text intact", () => {
    const text = "Señor Núñez — 你好 ✓";
    expect(
      bodyAfter(build({ to: "a@b.test", subject: "x", text }), "text/plain"),
    ).toBe(text);
  });
});

describe("headers", () => {
  it("encodes a non-ASCII subject as RFC 2047 words of at most 75 characters", () => {
    const subject =
      "Réinitialisation du mot de passe — ça marche très bien aujourd'hui";
    const encoded = encodeHeaderValue(subject);
    const words = encoded.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    const decoded = words
      .map((w) =>
        Buffer.from(w.slice("=?UTF-8?B?".length, -2), "base64").toString(
          "utf8",
        ),
      )
      .join("");
    expect(decoded).toBe(subject);
  });

  it("leaves an ASCII subject alone", () => {
    expect(encodeHeaderValue("Reset your password")).toBe(
      "Reset your password",
    );
  });

  it("formats the From header with and without a display name", () => {
    expect(formatFromHeader(FROM, "")).toBe(FROM);
    expect(formatFromHeader(FROM, 'Harbor "& Vale"')).toBe(
      `"Harbor \\"& Vale\\"" <${FROM}>`,
    );
    expect(formatFromHeader(FROM, "Café\r\nBcc: x@y.test")).not.toMatch(
      /[\r\n]/,
    );
    expect(formatFromHeader(FROM, "Hôtel")).toMatch(
      /^=\?UTF-8\?B\?.+\?= <noreply@firm\.test>$/,
    );
  });
});

describe("input validation", () => {
  it("rejects header injection through the subject", () => {
    expect(() =>
      sendEmailSchema.parse({
        to: "a@b.test",
        subject: "Hi\r\nBcc: attacker@evil.test",
        text: "x",
      }),
    ).toThrow(/single line/);
  });

  it("rejects header injection through the recipient", () => {
    expect(() =>
      sendEmailSchema.parse({
        to: "a@b.test\r\nBcc: attacker@evil.test",
        subject: "Hi",
        text: "x",
      }),
    ).toThrow();
  });

  it("rejects a bad recipient, an empty subject, an over-long subject and no body", () => {
    const ok = { to: "a@b.test", subject: "Hi", text: "x" };
    expect(() => sendEmailSchema.parse({ ...ok, to: "nope" })).toThrow(
      /recipient/,
    );
    expect(() => sendEmailSchema.parse({ ...ok, subject: "  " })).toThrow(
      /Subject is required/,
    );
    expect(() =>
      sendEmailSchema.parse({ ...ok, subject: "s".repeat(301) }),
    ).toThrow(/too long/);
    expect(() =>
      sendEmailSchema.parse({ to: "a@b.test", subject: "Hi", text: "  " }),
    ).toThrow(/text body/);
  });

  it("has no way to choose the sender", () => {
    const parsed = sendEmailSchema.parse({
      to: "a@b.test",
      subject: "Hi",
      text: "x",
      from: "ceo@evil.test",
    });
    expect(parsed).not.toHaveProperty("from");
  });
});
