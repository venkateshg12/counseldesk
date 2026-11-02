export enum appErrorCode {
  InvalidAccessToken = "InvalidAccessToken",
  Forbidden = "ForbiddenAccess",
  TokenExpired = "TOKEN_EXPIRED",
  LlmUnavailable = "LLM_UNAVAILABLE",
  ConversationTooLong = "CONVERSATION_TOO_LONG",
  GmailNotConfigured = "GMAIL_NOT_CONFIGURED",
  GmailAuthInvalid = "GMAIL_AUTH_INVALID",
  GmailSendFailed = "GMAIL_SEND_FAILED",
  SlotTaken = "SLOT_TAKEN",
  SlotUnavailable = "SLOT_UNAVAILABLE",
  InvalidBookingLink = "INVALID_BOOKING_LINK",
  NoAttorneyAvailable = "NO_ATTORNEY_AVAILABLE",
}
