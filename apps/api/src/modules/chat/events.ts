import type { ChatEvent } from '@gs/shared';

/**
 * Live chat updates for open /chat/stream connections, per user. In memory: the API runs as
 * one process (see ecosystem.config.cjs); several instances would need Postgres NOTIFY.
 */
type Listener = (e: ChatEvent) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(userId: string, fn: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(userId);
  };
}

export function publish(userIds: Iterable<string>, e: ChatEvent): void {
  for (const id of new Set(userIds)) listeners.get(id)?.forEach((fn) => fn(e));
}
