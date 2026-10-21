import type { Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/email/sendMail.js", () => ({ sendMail }));

import { processPasswordReset } from "../src/jobs/processors/notify.processor.js";
import { notifyQueue } from "../src/jobs/queues/notify.queue.js";
import {
  hashValue,
  isValidPasswordResetSignature,
  parsePasswordResetToken,
} from "../src/utils/auth/index.js";
import { orm } from "../src/prisma/db.js";
import { resetDb } from "./helpers.js";

afterAll(() => notifyQueue.close());

let userId: string;
let passwordHash: string;

beforeEach(async () => {
  await resetDb();
  sendMail.mockReset().mockResolvedValue({ data: null, error: null });
  passwordHash = await hashValue("correct horse battery");
  const user = await orm.User.create({
    email: "ana@firm.test",
    name: "Ana <b>Diaz</b>",
    passwordHash,
  });
  userId = user.id;
});

const job = (data: unknown) => ({ data }) as Job<never>;

describe("password reset email", () => {
  it("mails the user (not the staff inbox) a link that verifies against their hash", async () => {
    const result = await processPasswordReset(
      job({ userId, issuedAt: Date.now() }),
    );
    expect(result).toEqual({ status: "sent" });

    const mail = sendMail.mock.calls[0]![0];
    expect(mail.to).toBe("ana@firm.test");
    expect(mail.subject).toMatch(/reset/i);

    const token = new URL(
      mail.text.match(/https?:\/\/\S+/)![0],
    ).searchParams.get("token")!;
    const parsed = parsePasswordResetToken(token)!;
    expect(parsed.userId).toBe(userId);
    expect(isValidPasswordResetSignature(parsed, passwordHash)).toBe(true);
    // Escaped in the HTML part, so a name can't inject markup.
    expect(mail.html).not.toContain("<b>Diaz</b>");
  });

  it("throws when sending fails, so BullMQ retries", async () => {
    sendMail.mockResolvedValue({
      data: null,
      error: new Error("provider down"),
    });
    await expect(
      processPasswordReset(job({ userId, issuedAt: Date.now() })),
    ).rejects.toThrow(/provider down/);
  });

  it("skips a job that outlived its link, and one for a missing user", async () => {
    expect(
      await processPasswordReset(
        job({ userId, issuedAt: Date.now() - 11 * 60 * 1000 }),
      ),
    ).toMatchObject({ status: "skipped", reason: "expired" });

    expect(
      await processPasswordReset(
        job({ userId: crypto.randomUUID(), issuedAt: Date.now() }),
      ),
    ).toMatchObject({ status: "skipped", reason: "user not found" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("fails permanently on a malformed payload", async () => {
    await expect(processPasswordReset(job({ userId: "nope" }))).rejects.toThrow(
      /Malformed job payload/,
    );
  });
});
