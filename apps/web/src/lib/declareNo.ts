import type { ChangeEvent } from 'react';

/**
 * A Declare No. as typed: "I" (import) or "E" (export), a space added for you, then digits only,
 * e.g. "I 122050". Anything else is dropped. While deleting, the bare letter is kept without the
 * space, so Backspace can clear it.
 */
export function formatDeclareNo(raw: string, deleting = false): string {
  const t = raw.trimStart().toUpperCase();
  if (!/^[IE]/.test(t)) return '';
  const digits = t.slice(1).replace(/\D/g, '');
  return deleting && !digits ? t[0]! : `${t[0]} ${digits}`;
}

/** Put on a Declare No. box's onChange, before the form reads the value. */
export function maskDeclareNo(e: ChangeEvent<HTMLInputElement>) {
  const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith('delete') ?? false;
  const next = formatDeclareNo(e.target.value, deleting);
  if (next !== e.target.value) e.target.value = next;
}
