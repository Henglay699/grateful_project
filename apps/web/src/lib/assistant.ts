import {
  ASSISTANT_FILE_MAX_BYTES,
  ASSISTANT_FILES_PER_REQUEST,
  ASSISTANT_REQUEST_MAX_BYTES,
  assistantFileKind,
  type AssistantFileKind,
} from '@gs/shared';
import { ApiError, api, refreshSession, session } from './api';

/** A file attached to a question. It lives only in this browser tab; the server never keeps it. */
export interface ChatFile {
  file: File;
  kind: AssistantFileKind;
  /** blob: URL for an image thumbnail (revoke it when the chat is cleared). */
  preview?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  files?: ChatFile[];
}

export const assistantStatus = () => api<{ enabled: boolean }>('/assistant/status');

/** Suggested questions for a page: written by the AI from its guide (a built-in list otherwise). */
export const assistantSuggestions = (page: string) =>
  api<{ questions: string[]; source: 'ai' | 'built-in' }>('/assistant/suggestions', {
    query: { page },
  });

/** Three follow-up questions after an answer; never throws (no follow-ups on failure). */
export const assistantFollowUps = (question: string, answer: string, page: string) =>
  api<{ questions: string[] }>('/assistant/follow-ups', {
    method: 'POST',
    json: { question, answer, page },
  })
    .then((r) => r.questions)
    .catch(() => [] as string[]);

/** "/accounting/billing/abc" → "accounting/billing"; "/plans/123" → "plans" (as the API groups). */
export function pageSection(page: string): string {
  const parts = page.split('/').filter(Boolean);
  if (!parts.length) return 'overview';
  return parts[0] === 'accounting' && parts[1] ? `accounting/${parts[1]}` : parts[0]!;
}

/** `count` items of `list` in an order set by `seed` (a new seed, a new pick). */
export function pickSome<T>(list: T[], count: number, seed: number): T[] {
  const out = [...list];
  let x = (seed * 9301 + 49297) % 233280 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 9301 + 49297) % 233280;
    const j = Math.floor((x / 233280) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, count);
}

/** Large photos are shrunk before upload: quicker, and within every AI model's image limits. */
const MAX_IMAGE_EDGE = 2048;
const SHRINK_ABOVE_BYTES = 3 * 1024 * 1024;

async function shrinkImage(file: File): Promise<File> {
  if (file.type === 'image/gif') return file; // may be animated; send as-is
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // the server checks it and explains if it isn't a real image
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SHRINK_ABOVE_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/** Check a picked / pasted / dropped file. Returns the attachment, or why it can't be used. */
export async function prepareFile(file: File): Promise<ChatFile | string> {
  const kind = assistantFileKind(file.name);
  if (!kind)
    return `"${file.name}" can't be read. Attach images, PDF, Word (.docx) or Excel (.xlsx) files.`;
  const ready = kind === 'image' ? await shrinkImage(file) : file;
  if (ready.size > ASSISTANT_FILE_MAX_BYTES) return `"${file.name}" is larger than 10 MB.`;
  return { file: ready, kind, preview: kind === 'image' ? URL.createObjectURL(ready) : undefined };
}

/**
 * The request body. Files of the conversation are re-sent (newest first, within the request
 * limits) so follow-up questions about them still work; the server keeps nothing between
 * requests. Files that no longer fit are mentioned by name instead.
 */
function requestBody(messages: ChatMessage[], page: string): string | FormData {
  if (!messages.some((m) => m.files?.length))
    return JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      page,
    });
  const keep = new Set<ChatFile>();
  let bytes = 0;
  for (const m of [...messages].reverse())
    for (const f of m.files ?? []) {
      if (
        keep.size >= ASSISTANT_FILES_PER_REQUEST ||
        bytes + f.file.size > ASSISTANT_REQUEST_MAX_BYTES
      )
        continue;
      keep.add(f);
      bytes += f.file.size;
    }
  const form = new FormData();
  const sent: ChatFile[] = [];
  const payload = messages.map(({ role, content, files = [] }) => {
    const dropped = files.filter((f) => !keep.has(f)).map((f) => f.file.name);
    const indexes = files.filter((f) => keep.has(f)).map((f) => sent.push(f) - 1);
    return {
      role,
      content: dropped.length
        ? `${content}\n\n[Attached earlier, no longer available: ${dropped.join(', ')}]`
        : content,
      ...(indexes.length ? { files: indexes } : {}),
    };
  });
  form.append('payload', JSON.stringify({ messages: payload, page }));
  for (const f of sent) form.append('files', f.file, f.file.name);
  return form;
}

/**
 * Sends the conversation to the "Ask AI" endpoint and calls `onText` with each chunk of
 * the answer as it streams in. Resolves when the answer is complete.
 */
export async function streamChat(
  messages: ChatMessage[],
  page: string,
  onText: (chunk: string) => void,
  signal: AbortSignal,
  retried = false,
): Promise<void> {
  const body = requestBody(messages, page);
  const res = await fetch('/api/v1/assistant/chat', {
    method: 'POST',
    // FormData sets its own multipart Content-Type (with the boundary).
    headers: {
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...session.authHeader(),
    },
    credentials: 'include',
    body,
    signal,
  });
  if (res.status === 401 && !retried && (await refreshSession())) {
    return streamChat(messages, page, onText, signal, true);
  }
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, 'INTERNAL', message);
  }

  // Newline-delimited JSON: {"text"} chunks, then {"done"} or {"error"}.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const evt = JSON.parse(line) as { text?: string; error?: string; done?: boolean };
      if (evt.text) onText(evt.text);
      if (evt.error) throw new ApiError(502, 'INTERNAL', evt.error);
      if (evt.done) return;
    }
  }
  throw new ApiError(502, 'INTERNAL', 'The answer was cut off. Try again.');
}
