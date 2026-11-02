import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareFile, streamChat, type ChatFile, type ChatMessage } from './assistant';

const MB = 1024 * 1024;
const chatFile = (name: string, bytes: number, kind: ChatFile['kind'] = 'pdf'): ChatFile => ({
  file: new File([new Uint8Array(bytes)], name),
  kind,
});

/** Run streamChat against a fake fetch and return what it sent. */
async function sent(messages: ChatMessage[]) {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { status: 500 }));
  await streamChat(messages, '/overview', () => {}, new AbortController().signal).catch(() => {});
  const init = fetchSpy.mock.calls[0]![1]!;
  return { body: init.body, headers: init.headers as Record<string, string> };
}

afterEach(() => vi.restoreAllMocks());

describe('Ask AI attachments', () => {
  it('sends plain JSON when there are no files', async () => {
    const { body, headers } = await sent([{ role: 'user', content: 'Hi' }]);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(body as string)).toEqual({
      messages: [{ role: 'user', content: 'Hi' }],
      page: '/overview',
    });
  });

  it('uploads files as multipart and points each message at its own files', async () => {
    const a = chatFile('invoice.pdf', 1000);
    const b = chatFile('photo.jpg', 2000, 'image');
    const { body, headers } = await sent([
      { role: 'user', content: 'Read this', files: [a] },
      { role: 'assistant', content: 'Done.' },
      { role: 'user', content: 'And this photo?', files: [b] },
    ]);
    expect(headers['Content-Type']).toBeUndefined(); // the browser adds the multipart boundary
    const form = body as FormData;
    const payload = JSON.parse(form.get('payload') as string);
    // Each message lists the indexes of its own files in the upload.
    expect(payload.messages.map((m: { files?: number[] }) => m.files)).toEqual([
      [0],
      undefined,
      [1],
    ]);
    expect((form.getAll('files') as File[]).map((f) => f.name)).toEqual([
      'invoice.pdf',
      'photo.jpg',
    ]);
  });

  it('drops the oldest files past the 20 MB request limit and says so', async () => {
    const old = chatFile('old-scan.pdf', 9 * MB);
    const mid = chatFile('mid.pdf', 9 * MB);
    const recent = chatFile('recent.pdf', 9 * MB);
    const { body } = await sent([
      { role: 'user', content: 'One', files: [old] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'Two', files: [mid] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'Three', files: [recent] },
    ]);
    const form = body as FormData;
    expect((form.getAll('files') as File[]).map((f) => f.name)).toEqual(['mid.pdf', 'recent.pdf']);
    const first = JSON.parse(form.get('payload') as string).messages[0];
    expect(first.files).toBeUndefined();
    expect(first.content).toContain('no longer available: old-scan.pdf');
  });

  it('refuses unsupported and oversized files before upload', async () => {
    expect(await prepareFile(new File(['x'], 'notes.txt'))).toContain("can't be read");
    expect(await prepareFile(new File(['x'], 'old.doc'))).toContain("can't be read");
    expect(await prepareFile(new File([new Uint8Array(11 * MB)], 'big.pdf'))).toContain(
      'larger than 10 MB',
    );
    expect(await prepareFile(new File(['%PDF'], 'ok.pdf'))).toMatchObject({ kind: 'pdf' });
  });
});
