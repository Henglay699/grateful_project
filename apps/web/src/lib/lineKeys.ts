import type { KeyboardEvent } from 'react';

const FIELDS = 'input:not([type="hidden"]), select, textarea';

/** Whether the caret may leave a text box: the whole text is selected, or the caret is at the edge. */
function atEdge(el: HTMLElement, toEnd: boolean) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return true;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null) return true;
  const len = el.value.length;
  if (start === 0 && end === len) return true;
  return start === end && start === (toEnd ? len : 0);
}

/** Whether the box is mid-typing, so Up/Down belong to it (picking a suggestion from its list). */
function typing(el: HTMLElement) {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement) || !el.list || !el.value) return false;
  return !(el.selectionStart === 0 && el.selectionEnd === el.value.length);
}

function focusBox(el: HTMLElement | undefined) {
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement) el.select();
}

/**
 * Moves around the line items like Excel. Enter or ↓ goes to the same box on the next line
 * (Shift+Enter or ↑ goes up). ← and → go to the box beside, once the caret is at the edge of
 * the text. Put it on each line's row as `onKeyDown`; it never submits the form.
 */
export function moveInLines(e: KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
  const row = e.currentTarget;
  const box = e.target as HTMLElement;
  const boxes = [...row.querySelectorAll<HTMLElement>(FIELDS)];
  const col = boxes.indexOf(box);
  if (col < 0) return;

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (e.shiftKey) return;
    const right = e.key === 'ArrowRight';
    if (!atEdge(box, right)) return;
    const target = boxes[col + (right ? 1 : -1)];
    if (!target) return;
    e.preventDefault();
    focusBox(target);
    return;
  }

  let up: boolean;
  if (e.key === 'Enter') up = e.shiftKey;
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !typing(box))
    up = e.key === 'ArrowUp';
  else return;
  e.preventDefault();
  let next = up ? row.previousElementSibling : row.nextElementSibling;
  // Skip anything between the lines that isn't one (a header, a datalist).
  while (next && next.className !== row.className)
    next = up ? next.previousElementSibling : next.nextElementSibling;
  focusBox(next?.querySelectorAll<HTMLElement>(FIELDS)[col]);
}
