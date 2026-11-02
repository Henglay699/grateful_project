import { useEffect, useRef, useState } from 'react';
import s from './WordView.module.css';

/** Renders a .docx as paged sheets (layout, tables, images, headers/footers). */
export function WordView({
  blob,
  zoom,
  onError,
}: {
  blob: Blob;
  zoom: number;
  onError: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!el) return;
    (async () => {
      // Loaded on first Word preview only.
      const { renderAsync } = await import('docx-preview');
      if (cancelled) return;
      el.innerHTML = '';
      await renderAsync(blob, el, el, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        // Embedded fonts would load from blob: URLs, which the CSP's font-src refuses.
        ignoreFonts: true,
        // Images as data: URLs (allowed by img-src).
        useBase64URL: true,
      });
      if (!cancelled) setReady(true);
    })().catch(() => !cancelled && onError());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on a new file
  }, [blob]);

  return (
    <>
      {!ready && <div className={s.loading}>Loading preview…</div>}
      <div ref={host} className={s.host} style={{ zoom }} />
    </>
  );
}
