import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  traceId?: string;
  userAgent?: string;
  ip?: string;
  method?: string;
  path?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, run: () => T): T {
  return storage.run(context, run);
}

export function setRequestContext(fields: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}

export function requestContext(): RequestContext {
  return storage.getStore() ?? {};
}
