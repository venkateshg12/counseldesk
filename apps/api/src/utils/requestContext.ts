import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(
  context: RequestContext,
  fn: () => T,
) => storage.run(context, fn);

// Undefined outside a request: boot, shutdown, background jobs, scripts.
export const getRequestId = () => storage.getStore()?.requestId;
