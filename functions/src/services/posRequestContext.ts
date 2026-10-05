import { AsyncLocalStorage } from "node:async_hooks";
import type { PosAuthSessionData } from "../types/auth";

// Only share verified data inside one callable invocation. Never cache RBAC
// across requests, users, devices or Cloud Run instances.
const context = new AsyncLocalStorage<Map<string, Promise<PosAuthSessionData>>>();

export function withPosRequestContext<T>(work: () => Promise<T>): Promise<T> {
  return context.run(new Map(), work);
}

export function requestAuthSession(
  key: string,
  load: () => Promise<PosAuthSessionData>,
): Promise<PosAuthSessionData> {
  const cache = context.getStore();
  if (!cache) return load();
  const existing = cache.get(key);
  if (existing) return existing;
  const result = load();
  cache.set(key, result);
  return result;
}
