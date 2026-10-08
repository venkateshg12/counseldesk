import { chatRequestSchema, type ChatEvent } from "@repo/types";
import { catchError, AppError } from "../utils/errors/index.js";
import { OK } from "../constants/http.js";
import { handleMessage } from "../services/chat.service.js";
import { logger } from "../utils/logger.js";

const HEARTBEAT_MS = 15_000;

export const chatHandler = catchError(async (req, res) => {
  // Validated before any streaming starts, so a bad request still gets a normal 400 envelope.
  const { conversationId, message } = chatRequestSchema.parse(req.body);

  const controller = new AbortController();
  // `close` before the response finished means the visitor disconnected.
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  res.status(OK).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (event: ChatEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  try {
    await handleMessage({
      visitorId: req.visitorId!,
      conversationId,
      message,
      signal: controller.signal,
      emit: send,
    });
  } catch (error) {
    // Headers are already sent: the error goes into the stream, not into the status code.
    if (error instanceof AppError) {
      send({
        type: "error",
        message: error.message,
        code: error.errorCode ?? "APP_ERROR",
      });
    } else {
      logger.error("chat failed", { error });
      send({
        type: "error",
        message: "Something went wrong. Please try again.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});
