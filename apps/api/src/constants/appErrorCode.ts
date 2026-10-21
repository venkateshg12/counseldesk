export enum appErrorCode {
  InvalidAccessToken = "InvalidAccessToken",
  Forbidden = "ForbiddenAccess",
  TokenExpired = "TOKEN_EXPIRED",
  LlmUnavailable = "LLM_UNAVAILABLE",
  ConversationTooLong = "CONVERSATION_TOO_LONG",
  GmailNotConfigured = "GMAIL_NOT_CONFIGURED",
  GmailAuthInvalid = "GMAIL_AUTH_INVALID",
  GmailSendFailed = "GMAIL_SEND_FAILED",
}
