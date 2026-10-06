import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { notifyQueue } from "../queues/notify.queue.js";

export function setupBullBoard() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(notifyQueue)], serverAdapter });
  return serverAdapter.getRouter();
}
