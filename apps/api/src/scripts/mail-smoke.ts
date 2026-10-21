import "dotenv/config";
import { parseArgs } from "node:util";
import { isGmailConfigured } from "../config/gmail.js";
import { sendEmail } from "../services/gmail.service.js";

// Sends one real message through the Gmail API, to prove the credentials work.
// Usage: pnpm --filter api mail:smoke --to you@example.com
const { values } = parseArgs({ options: { to: { type: "string" } } });

if (!values.to) {
  console.error("Usage: pnpm --filter api mail:smoke --to <address>");
  process.exit(1);
}
if (!isGmailConfigured()) {
  console.error(
    "Gmail is not configured: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN and GMAIL_SENDER_ADDRESS (see docs/gmail-api-email-sender.md).",
  );
  process.exit(1);
}

const { messageId } = await sendEmail({
  to: values.to,
  subject: "CounselDesk Gmail API test",
  text: "If you can read this, the Gmail API sender works.",
  html: "<p>If you can read this, the Gmail API sender works.</p>",
});
console.log("sent, message id:", messageId);
