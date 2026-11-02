import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  ASSISTANT_FILE_MAX_BYTES,
  ASSISTANT_FILES_PER_REQUEST,
  ASSISTANT_REQUEST_MAX_BYTES,
  assistantFileKind,
} from '@gs/shared';
import { AppError, badRequest } from '../../lib/errors';

/**
 * Files attached to an "Ask AI" question. They are held in memory for this one request,
 * passed to the AI model (images and PDFs as-is, Word and Excel as extracted text) and then
 * dropped. Nothing is written to disk or the database.
 */
export type Attachment =
  | { kind: 'image'; name: string; mimeType: string; data: Buffer }
  | { kind: 'pdf'; name: string; mimeType: 'application/pdf'; data: Buffer }
  | { kind: 'text'; name: string; text: string };

/** Caps on text pulled out of Word / Excel, so one big sheet can't blow the token budget. */
const MAX_TEXT_CHARS = 120_000;
const MAX_ROWS_PER_SHEET = 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ASSISTANT_FILE_MAX_BYTES,
    files: ASSISTANT_FILES_PER_REQUEST,
    fields: 2,
    fieldSize: 1024 * 1024, // the JSON "payload" field (the conversation)
  },
});

/** multipart/form-data with a "payload" JSON field and up to N "files"; JSON bodies pass through. */
export function assistantUpload(req: Request, res: Response, next: NextFunction) {
  upload.array('files', ASSISTANT_FILES_PER_REQUEST)(req, res, (err: unknown) => {
    const code =
      (err as { name?: string; code?: string } | undefined)?.name === 'MulterError'
        ? (err as { code: string }).code
        : null;
    if (code === 'LIMIT_FILE_SIZE')
      return next(new AppError(413, 'VALIDATION_ERROR', 'Each file must be smaller than 10 MB.'));
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE')
      return next(
        badRequest(`Attach at most ${ASSISTANT_FILES_PER_REQUEST} files to one conversation turn.`),
      );
    next(err);
  });
}

const startsWith = (buf: Buffer, bytes: number[], at = 0) =>
  bytes.every((b, i) => buf[at + i] === b);

/** The real image type from the file's first bytes (the browser's label can't be trusted). */
function sniffImage(buf: Buffer): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}
const isPdf = (buf: Buffer) => startsWith(buf, [0x25, 0x50, 0x44, 0x46]); // %PDF
const isZip = (buf: Buffer) => startsWith(buf, [0x50, 0x4b, 0x03, 0x04]); // PK.. (docx / xlsx)

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

function capText(text: string): string {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > MAX_TEXT_CHARS
    ? `${clean.slice(0, MAX_TEXT_CHARS)}\n…[the rest of the file was cut off: it is too long to read in full]`
    : clean;
}

/** Paragraphs, tabs, line breaks and table cells of a .docx, as plain text. */
async function wordText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('not a Word document');
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:(p|tr)>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return capText(decodeXml(text));
}

/** Every sheet of an .xlsx as "A | B | C" rows. */
async function excelText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((ws) => {
    const rows: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= MAX_ROWS_PER_SHEET) return;
      const cells = (row.values as unknown[]).slice(1).map((_, i) =>
        row
          .getCell(i + 1)
          .text.replace(/\s+/g, ' ')
          .trim(),
      );
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push(`${n}: ${cells.join(' | ')}`);
    });
    const more =
      ws.actualRowCount > MAX_ROWS_PER_SHEET
        ? `\n…[only the first ${MAX_ROWS_PER_SHEET} rows]`
        : '';
    parts.push(`## Sheet "${ws.name}"\n${rows.join('\n') || '(empty)'}${more}`);
  });
  return capText(parts.join('\n\n'));
}

/** Check one uploaded file and turn it into something the model can read. */
export async function readAttachment(file: Express.Multer.File): Promise<Attachment> {
  const name = file.originalname.slice(0, 200);
  const kind = assistantFileKind(name);
  const bad = (why: string) => badRequest(`"${name}" ${why}`);
  if (!kind)
    throw bad(
      'is not a supported file. Attach an image (PNG, JPG, WEBP, GIF), a PDF, a Word .docx or an Excel .xlsx file.',
    );
  const buf = file.buffer;
  if (kind === 'image') {
    const mimeType = sniffImage(buf);
    if (!mimeType) throw bad('is not a valid image.');
    return { kind: 'image', name, mimeType, data: buf };
  }
  if (kind === 'pdf') {
    if (!isPdf(buf)) throw bad('is not a valid PDF.');
    return { kind: 'pdf', name, mimeType: 'application/pdf', data: buf };
  }
  if (!isZip(buf))
    throw bad(
      kind === 'word'
        ? 'could not be read. Old .doc files: open in Word and "Save As" .docx first.'
        : 'could not be read. Old .xls files: open in Excel and "Save As" .xlsx first.',
    );
  try {
    const text = kind === 'word' ? await wordText(buf) : await excelText(buf);
    return { kind: 'text', name, text: text || '(the file has no text)' };
  } catch {
    throw bad(`could not be read as ${kind === 'word' ? 'a Word' : 'an Excel'} file.`);
  }
}

/** Read every uploaded file, after checking the request's total size. */
export async function readAttachments(files: Express.Multer.File[]): Promise<Attachment[]> {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > ASSISTANT_REQUEST_MAX_BYTES)
    throw new AppError(
      413,
      'VALIDATION_ERROR',
      'The attached files are too large together (20 MB at most). Start a new chat or attach fewer files.',
    );
  return Promise.all(files.map(readAttachment));
}
