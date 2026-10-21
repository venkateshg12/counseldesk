import { NODE_ENV } from "../../constants/env.js";
import { isGmailConfigured } from "../../config/gmail.js";
import { sendEmail } from "../../services/gmail.service.js";
import { logger } from "../logger.js";

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/*
  Returns `{ data, error }` instead of throwing, so the job processors decide what a failure means
  (they throw, which is what makes BullMQ retry). Sending itself is done by the Gmail API.
 */
export const sendMail = async (options: MailOptions) => {
  if (!isGmailConfigured()) {
    if (NODE_ENV === "production") {
      // The development fallback below prints the whole message, which for a password reset is a
      // login credential, and would also report a send that never happened as a success.
      logger.error(
        "[Mail] Gmail is not configured; refusing to send in production",
      );
      return {
        data: null,
        error: new Error("Gmail is not configured"),
      };
    }

    // No Gmail credentials outside production: print the message instead (local development and E2E).
    logger.info("--- DEVELOPMENT MAIL SEND ---");
    logger.info(`To: ${options.to}`);
    logger.info(`Subject: ${options.subject}`);
    logger.info(`Body: ${options.text}`);
    logger.info("------------------------------");
    return {
      data: null,
      error: null,
    };
  }

  try {
    const { messageId } = await sendEmail(options);
    return { data: { id: messageId }, error: null };
  } catch (error) {
    // sendEmail has already logged the Google-side detail without the secrets.
    return { data: null, error };
  }
};
