import { useEffect, useRef } from 'react';
import { AUTOPRINT_PARAM } from '../../lib/printInPlace';

const post = (data: unknown) => window.parent.postMessage(data, window.location.origin);

/**
 * In the hidden frame of printInPlace (?autoprint=1): once `ready` (data loaded), waits for
 * fonts and images, then opens the print dialog and tells the page underneath when it closes.
 */
export function useAutoPrint(ready: boolean): void {
  const started = useRef(false);
  useEffect(() => {
    const auto = new URLSearchParams(window.location.search).get(AUTOPRINT_PARAM) === '1';
    if (!auto || !ready || started.current || window.parent === window) return;
    started.current = true;
    void (async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map((img) => new Promise((done) => img.addEventListener('load', done, { once: true }))),
      );
      // Two frames: the last layout (and the document.title effect) has been applied.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.addEventListener('afterprint', () => post({ type: 'gs:print-done' }), { once: true });
      post({ type: 'gs:print-start', title: document.title });
      window.print();
    })();
  }, [ready]);
}
