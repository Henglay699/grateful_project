import { api, refreshSession, session } from './api';

type Query = Record<string, string | string[] | undefined>;

/** Fetch a file from the API (with auth) without saving it, e.g. to preview it. */
export async function fetchFile(
  path: string,
  query: Query = {},
  signal?: AbortSignal,
): Promise<{ blob: Blob; name: string }> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => url.searchParams.append(k, x));
  }
  const go = () =>
    fetch(url.pathname + url.search, { credentials: 'include', headers: authHeader(), signal });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name = fileNameFrom(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), name };
}

/** Save an already-fetched file through the browser's normal download. */
export function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Download a file from the API (with auth) and save it under the server-provided name. */
export async function downloadFile(path: string, query: Query = {}): Promise<void> {
  const { blob, name } = await fetchFile(path, query);
  saveBlob(blob, name);
}

/** File name from Content-Disposition: `filename*=UTF-8''…` (RFC 5987) wins over `filename="…"`. */
function fileNameFrom(disposition: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // Malformed escape: fall through to the plain filename.
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? 'download';
}

function authHeader(): HeadersInit {
  // The token lives in api.ts memory; reuse it through a tiny probe request header builder.
  return session.authHeader();
}

/** POST a single file as multipart form data. */
export function uploadFile<T>(
  path: string,
  file: File,
  query?: Record<string, string | boolean | undefined>,
): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  return api<T>(path, {
    method: 'POST',
    body: fd,
    query: query as Record<string, string | undefined>,
  });
}
