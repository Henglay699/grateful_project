import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChatConversationDetail,
  ChatConversationRow,
  ChatEvent,
  ChatMessageRow,
  ChatUser,
} from '@gs/shared';
import { api, refreshSession, session } from './api';
import { fetchFile } from './files';

export const chatKeys = {
  all: ['chat'] as const,
  conversations: ['chat', 'conversations'] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  users: ['chat', 'users'] as const,
};

export const chatApi = {
  messages: (id: string, q: { before?: number; after?: number } = {}) =>
    api<ChatMessageRow[]>(`/chat/conversations/${id}/messages`, { query: q }),
  send: (id: string, json: { body: string; mentionIds?: string[] } | { sticker: string }) =>
    api<ChatMessageRow>(`/chat/conversations/${id}/messages`, { method: 'POST', json }),
  sendFile: (id: string, file: File, caption: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (caption) fd.append('caption', caption);
    return api<ChatMessageRow>(`/chat/conversations/${id}/files`, { method: 'POST', body: fd });
  },
  read: (id: string, seq: number) =>
    api<undefined>(`/chat/conversations/${id}/read`, { method: 'POST', json: { seq } }),
  remove: (messageId: string) =>
    api<undefined>(`/chat/messages/${messageId}`, { method: 'DELETE' }),
  direct: (userId: string) =>
    api<ChatConversationDetail>('/chat/direct', { method: 'POST', json: { userId } }),
  createGroup: (title: string, memberIds: string[]) =>
    api<ChatConversationDetail>('/chat/groups', { method: 'POST', json: { title, memberIds } }),
  rename: (id: string, title: string) =>
    api<ChatConversationDetail>(`/chat/conversations/${id}`, { method: 'PATCH', json: { title } }),
  setPhoto: (id: string, photo: Blob) => {
    const fd = new FormData();
    fd.append('file', photo, 'group.png');
    return api<ChatConversationDetail>(`/chat/conversations/${id}/photo`, {
      method: 'POST',
      body: fd,
    });
  },
  removePhoto: (id: string) =>
    api<ChatConversationDetail>(`/chat/conversations/${id}/photo`, { method: 'DELETE' }),
  addMembers: (id: string, userIds: string[]) =>
    api<ChatConversationDetail>(`/chat/conversations/${id}/members`, {
      method: 'POST',
      json: { userIds },
    }),
  removeMember: (id: string, userId: string) =>
    api<undefined>(`/chat/conversations/${id}/members/${userId}`, { method: 'DELETE' }),
};

export const filePath = (messageId: string) => `/chat/messages/${messageId}/file`;

export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn: () => api<ChatConversationRow[]>('/chat/conversations'),
    // The live stream invalidates this; the interval only covers a dropped stream.
    refetchInterval: 60_000,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: chatKeys.conversation(id ?? ''),
    queryFn: () => api<ChatConversationDetail>(`/chat/conversations/${id}`),
    enabled: !!id,
  });
}

/** How long the server keeps messages (0 = forever). */
export function useChatInfo() {
  return useQuery({
    queryKey: ['chat', 'info'],
    queryFn: () => api<{ retentionDays: number }>('/chat/info'),
    staleTime: Infinity,
  });
}

export function useChatUsers(enabled = true) {
  return useQuery({
    queryKey: chatKeys.users,
    queryFn: () => api<ChatUser[]>('/chat/users'),
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Object URL for an image the API serves only with a token (group photos, sent pictures). */
export function useAuthedImage(path: string | null, version?: string | null) {
  return useQuery({
    queryKey: ['chat', 'image', path, version ?? ''],
    queryFn: async ({ signal }) =>
      URL.createObjectURL((await fetchFile(path!, { inline: '1' }, signal)).blob),
    enabled: !!path,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  }).data;
}

/* ---------- Live updates ---------- */

type Listener = (e: ChatEvent | { type: 'reconnected' }) => void;
const listeners = new Set<Listener>();

/** Hear chat events (and 'reconnected', after which open views should catch up). */
export function useChatEvents(fn: Listener) {
  useEffect(() => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, [fn]);
}

/**
 * Keeps one streaming connection to /chat/stream open while signed in, refreshing the chat
 * list on every event and passing events to open views. Reconnects after a few seconds.
 */
export function useChatStream() {
  const qc = useQueryClient();
  useEffect(() => {
    const ctrl = new AbortController();
    let first = true;
    const emit = (e: Parameters<Listener>[0]) => listeners.forEach((l) => l(e));

    async function connect(): Promise<void> {
      const go = () =>
        fetch('/api/v1/chat/stream', {
          headers: session.authHeader(),
          credentials: 'include',
          signal: ctrl.signal,
        });
      let res = await go();
      if (res.status === 401 && (await refreshSession())) res = await go();
      if (!res.ok || !res.body) throw new Error(`Chat stream failed (${res.status})`);
      if (!first) {
        // Anything missed while disconnected.
        void qc.invalidateQueries({ queryKey: chatKeys.all });
        emit({ type: 'reconnected' });
      }
      first = false;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as ChatEvent;
          if (e.type === 'ping') continue;
          void qc.invalidateQueries({ queryKey: chatKeys.conversations });
          if (e.type === 'conversation' || e.type === 'removed')
            void qc.invalidateQueries({ queryKey: chatKeys.conversation(e.conversationId) });
          emit(e);
        }
      }
    }

    void (async () => {
      while (!ctrl.signal.aborted) {
        try {
          await connect();
        } catch {
          /* network drop or server restart: retry below */
        }
        if (ctrl.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => ctrl.abort();
  }, [qc]);
}
