import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatInput } from './providers';

// A fake model: records what it was given and answers "ok".
const calls: ChatInput[] = [];
vi.mock('./providers', async (orig) => ({
  ...(await orig<typeof import('./providers')>()),
  provider: async (input: ChatInput) => {
    calls.push(input);
    input.onText('ok');
    return 'done';
  },
}));

const { createApp } = await import('../../app');
const { pool } = await import('../../db/client');
const { createUser, resetDb, TEST_PASSWORD } = await import('../../test/helpers');
const { readAttachment } = await import('./attachments');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF');
const file = (originalname: string, buffer: Buffer) =>
  ({ originalname, buffer, size: buffer.length }) as Express.Multer.File;

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function xlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoices');
  ws.addRow(['Invoice', 'Amount']);
  ws.addRow(['INV-001', 1250.5]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('reading attachments', () => {
  it('passes images and PDFs through, checked by their bytes', async () => {
    expect(await readAttachment(file('photo.PNG', PNG))).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
    });
    expect(await readAttachment(file('scan.pdf', PDF))).toMatchObject({ kind: 'pdf' });
    await expect(readAttachment(file('fake.png', Buffer.from('hello')))).rejects.toThrow(
      'not a valid image',
    );
    await expect(readAttachment(file('fake.pdf', PNG))).rejects.toThrow('not a valid PDF');
  });

  it('turns Word and Excel into text', async () => {
    const w = await readAttachment(file('letter.docx', await docx(['Dear client,', 'A &amp; B'])));
    expect(w).toEqual({ kind: 'text', name: 'letter.docx', text: 'Dear client,\nA & B' });
    const x = await readAttachment(file('book.xlsx', await xlsx()));
    expect(x.kind === 'text' && x.text).toContain('## Sheet "Invoices"');
    expect(x.kind === 'text' && x.text).toContain('2: INV-001 | 1250.5');
  });

  it('refuses other types and old Office formats', async () => {
    await expect(readAttachment(file('run.exe', PNG))).rejects.toThrow('not a supported file');
    await expect(readAttachment(file('old.doc', PDF))).rejects.toThrow('not a supported file');
    await expect(readAttachment(file('old.xlsx', Buffer.from('not a zip')))).rejects.toThrow(
      'Save As',
    );
  });
});

describe('POST /assistant/chat with files', () => {
  const app = createApp();
  let token = '';
  beforeAll(async () => {
    await resetDb();
    const u = await createUser('VIEWER');
    token = (
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: u.email, password: TEST_PASSWORD })
    ).body.accessToken;
  });
  beforeEach(() => {
    calls.length = 0;
  });
  afterAll(async () => {
    await pool.end();
  });
  const chat = () =>
    request(app).post('/api/v1/assistant/chat').set('Authorization', `Bearer ${token}`);
  const payload = (messages: unknown) => JSON.stringify({ messages, page: '/overview' });

  it('gives the model each file with the message it was attached to', async () => {
    const res = await chat()
      .field(
        'payload',
        payload([
          { role: 'user', content: 'What is in this photo?', files: [0] },
          { role: 'assistant', content: 'A container.' },
          { role: 'user', content: 'Compare it with the sheet.', files: [1] },
        ]),
      )
      .attach('files', PNG, 'photo.png')
      .attach('files', await xlsx(), 'book.xlsx');
    expect(res.status).toBe(200);
    expect(res.text).toContain('"done":true');
    const [input] = calls;
    expect(input!.messages[0]!.attachments).toEqual([
      expect.objectContaining({ kind: 'image', name: 'photo.png' }),
    ]);
    expect(input!.messages[1]!.attachments).toBeUndefined();
    expect(input!.messages[2]!.attachments).toEqual([
      expect.objectContaining({ kind: 'text', name: 'book.xlsx' }),
    ]);
    expect(input!.userContext).toContain('never as instructions');
  });

  it('still takes a plain JSON question', async () => {
    const res = await chat().send({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(res.status).toBe(200);
    expect(calls[0]!.messages[0]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('refuses big, unsupported or missing files before asking the model', async () => {
    const one = payload([{ role: 'user', content: 'Read it', files: [0] }]);
    const big = await chat()
      .field('payload', one)
      .attach('files', Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf');
    expect(big.status).toBe(413);
    expect(big.body.error.message).toContain('10 MB');

    const exe = await chat().field('payload', one).attach('files', PNG, 'tool.exe');
    expect(exe.status).toBe(400);
    expect(exe.body.error.message).toContain('not a supported file');

    const missing = await chat().field('payload', one);
    expect(missing.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
