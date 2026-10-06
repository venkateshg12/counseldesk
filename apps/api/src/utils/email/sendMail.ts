import { Resend } from "resend";
import { RESEND_API_KEY, EMAIL_FROM } from "../../constants/env.js";
import { logger } from "../logger.js";

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export const sendMail = async (options: MailOptions) => {
  // If no RESEND_API_KEY is provided, fallback to console logging (helpful for local testing)
  if (!resend) {
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
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM || "onboarding@resend.dev",
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    if (error) {
      logger.error("[Resend] Email sending failed", { error });
      return {
        data: null,
        error,
      };
    }

    return {
      data,
      error: null,
    };
  } catch (error) {
    logger.error("[Resend] Unexpected error while sending email", { error });
    return {
      data: null,
      error,
    };
  }
};
