import multer from 'multer';
import { badRequest } from './errors';

const EXCEL_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.ms-excel', // browsers often label .csv this way on Windows
  'application/octet-stream',
]);

/** Single in-memory spreadsheet upload (field name "file"), max 5 MB. */
export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|csv)$/i.test(file.originalname) && EXCEL_TYPES.has(file.mimetype);
    if (ok) cb(null, true);
    else
      cb(
        badRequest(
          'Upload an .xlsx or .csv file. Old .xls files: open in Excel and "Save As" .xlsx first.',
        ),
      );
  },
}).single('file');

export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) throw badRequest('Attach the spreadsheet in a form field named "file"');
  return file;
}

/** "SHP-26-0001.xlsx"-safe file name for Content-Disposition. */
export function attachmentName(name: string): string {
  // Plain name for old clients; filename* (RFC 5987) keeps "+", "'" and spaces as they are.
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"; filename*=UTF-8''${encoded}`;
}
