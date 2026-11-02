/**
 * Date inputs: clicking the date text lets you type; clicking anywhere else in the field
 * (empty space or the calendar icon) opens the native picker. Other picker types
 * (month, week, time, datetime-local) open the picker wherever you click.
 */
const PICKER_TYPES = new Set(['date', 'month', 'week', 'time', 'datetime-local']);

// Roughly as wide as the displayed value, e.g. "28-May-2026".
const SAMPLE = '28-May-2026';
const TOLERANCE = 6; // px of slack after the text

const pickerInput = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && PICKER_TYPES.has(el.type);

let ctx: CanvasRenderingContext2D | null = null;

/** Screen x where the date text ends, so clicks left of it are "on the value". */
function valueEndX(el: HTMLInputElement): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return (
    el.getBoundingClientRect().left +
    parseFloat(cs.borderLeftWidth) +
    parseFloat(cs.paddingLeft) +
    ctx.measureText(SAMPLE).width +
    TOLERANCE
  );
}

const onValue = (e: MouseEvent, el: HTMLInputElement) =>
  el.type === 'date' && e.clientX < valueEndX(el);

document.addEventListener('click', (e) => {
  const el = e.target;
  if (!pickerInput(el) || el.disabled || el.readOnly) return;
  if (onValue(e, el)) return; // on the date text: let the user type
  try {
    el.showPicker();
  } catch {
    // Unsupported browser or picker already open.
  }
});

// Text cursor over the date, pointer elsewhere, so the field looks right.
document.addEventListener('mousemove', (e) => {
  const el = e.target;
  if (!pickerInput(el) || el.disabled || el.readOnly) return;
  el.style.cursor = onValue(e, el) ? 'text' : 'pointer';
});