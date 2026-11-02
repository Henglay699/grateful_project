/*
 * Print a /print/... page without leaving the current one: the page loads in a hidden frame
 * and, once its data, fonts and images are in, opens the browser's print dialog itself
 * (see useAutoPrint). Ctrl/⌘-click on a PrintLink still opens the page in a new tab.
 */

export const AUTOPRINT_PARAM = 'autoprint';

type PrintMessage = { type: 'gs:print-start'; title: string } | { type: 'gs:print-done' };

let frame: HTMLIFrameElement | null = null;
let savedTitle: string | null = null;

function finish() {
  if (savedTitle !== null) document.title = savedTitle;
  savedTitle = null;
  // Removed a moment later: some browsers still read the frame right after the dialog closes.
  const f = frame;
  frame = null;
  setTimeout(() => f?.remove(), 1000);
}

if (typeof window !== 'undefined')
  window.addEventListener('message', (e: MessageEvent<PrintMessage>) => {
    if (e.origin !== window.location.origin || !frame || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'gs:print-start') {
      // The saved PDF is named after the page title.
      savedTitle ??= document.title;
      document.title = e.data.title;
    } else if (e.data?.type === 'gs:print-done') finish();
  });

export function printInPlace(url: string): void {
  frame?.remove();
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.title = 'Print';
  // Laid out at A4 size (not display:none) so the page renders exactly as it prints.
  Object.assign(f.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '210mm',
    height: '297mm',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  f.src = `${url}${url.includes('?') ? '&' : '?'}${AUTOPRINT_PARAM}=1`;
  document.body.appendChild(f);
  frame = f;
}
