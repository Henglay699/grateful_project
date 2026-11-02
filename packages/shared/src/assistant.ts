/**
 * Files the AI assistant can read. They are analysed in memory for one answer and never
 * saved on the server.
 */
export const ASSISTANT_FILE_MAX_BYTES = 10 * 1024 * 1024; // per file
export const ASSISTANT_FILES_PER_MESSAGE = 3;
/** Files sent with one request (the browser re-sends a conversation's recent files). */
export const ASSISTANT_FILES_PER_REQUEST = 6;
/** All files in one request together; keeps it under the proxy's 25 MB body limit. */
export const ASSISTANT_REQUEST_MAX_BYTES = 20 * 1024 * 1024;

export type AssistantFileKind = 'image' | 'pdf' | 'word' | 'excel';
/** Accepted extensions → kind. Old .doc / .xls are binary formats the server can't read. */
export const ASSISTANT_FILE_TYPES: Record<string, AssistantFileKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  pdf: 'pdf',
  docx: 'word',
  xlsx: 'excel',
};
/** For <input type="file" accept="…">. */
export const ASSISTANT_FILE_ACCEPT = Object.keys(ASSISTANT_FILE_TYPES)
  .map((e) => `.${e}`)
  .join(',');

export const assistantFileKind = (name: string): AssistantFileKind | null =>
  ASSISTANT_FILE_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
