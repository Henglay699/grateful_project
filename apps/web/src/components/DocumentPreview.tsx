import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { DocumentRow } from '@gs/shared';
import { icons } from '../layout/icons';
import { fetchFile, saveBlob } from '../lib/files';
import { fmtDate, fmtFileSize } from '../lib/format';
import s from './DocumentPreview.module.css';
import { ExcelView } from './preview/ExcelView';
import { WordView } from './preview/WordView';

type Kind = 'pdf' | 'image' | 'excel' | 'word' | 'csv' | 'text' | 'none';

function kindOf(d: Pick<DocumentRow, 'mimeType' | 'originalName'>): Kind {
  const name = d.originalName.toLowerCase();
  if (d.mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpeg|webp)$/.test(d.mimeType)) return 'image';
  // Only the modern (zip-based) Office formats; legacy .xls/.doc have no browser renderer.
  if (name.endsWith('.xlsx')) return 'excel';
  if (name.endsWith('.docx')) return 'word';
  if (name.endsWith('.csv')) return 'csv';
  if (d.mimeType.startsWith('text/') || name.endsWith('.txt')) return 'text';
  return 'none';
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const TEXT_LIMIT = 200_000; // characters shown for text/CSV; the download has the rest
const CSV_ROWS = 500;

export type PreviewDoc = Pick<
  DocumentRow,
  'id' | 'title' | 'originalName' | 'mimeType' | 'sizeBytes' | 'createdAt' | 'uploadedBy'
>;

/**
 * Outlook-style viewer: shows the file first, with Download in the header. `path` is where
 * the file is fetched from (a document's by default; chat files pass their own).
 */
export function DocumentPreview({
  doc,
  path = `/documents/${doc.id}/download`,
  onClose,
}: {
  doc: PreviewDoc;
  path?: string;
  onClose: () => void;
}) {
  const kind = kindOf(doc);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Only previewable files are fetched; for the rest the Download button fetches on click.
  useEffect(() => {
    if (kind === 'none') return;
    const ctrl = new AbortController();
    fetchFile(path, { inline: '1' }, ctrl.signal)
      .then((r) => setBlob(r.blob))
      .catch(() => !ctrl.signal.aborted && setError(true));
    return () => ctrl.abort();
  }, [path, kind]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);

  const download = async () => {
    try {
      const b = blob ?? (await fetchFile(path)).blob;
      saveBlob(b, doc.originalName);
    } catch {
      setError(true);
    }
  };

  const zoomable = kind === 'pdf' || kind === 'image' || kind === 'excel' || kind === 'word';
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(Math.max(i + dir, 0), ZOOMS.length - 1)]!);
  };

  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.viewer} role="dialog" aria-modal="true" aria-labelledby="pv-title">
        <header className={s.head}>
          <span className={s.fileIcon}>{icons.documents({})}</span>
          <div className={s.titleWrap}>
            <h2 className={s.title} id="pv-title" title={doc.title}>
              {doc.title}
            </h2>
            <div className={s.meta}>
              {doc.originalName} · {fmtFileSize(doc.sizeBytes)} · {fmtDate(doc.createdAt)}
              {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
            </div>
          </div>
          <button type="button" className="new-shipment-btn" onClick={() => void download()}>
            {icons.download({})}
            Download
          </button>
          <button
            ref={closeRef}
            type="button"
            className={s.close}
            onClick={onClose}
            aria-label="Close preview"
          >
            {icons.close({})}
          </button>
        </header>

        <div className={s.body}>
          {error ? (
            <Notice title="Couldn’t open this file" text="Try again, or download it instead." />
          ) : kind === 'none' ? (
            <Notice
              title="No preview for this file type"
              text={
                /\.(xls|doc)$/i.test(doc.originalName)
                  ? `Older ${extOf(doc.originalName)} files can’t be shown here. Download to open it, or re-save it as .${extOf(doc.originalName).toLowerCase()}x and upload again to preview it.`
                  : `${extOf(doc.originalName)} files can’t be shown here. Download to open it.`
              }
            />
          ) : !blob ? (
            <div className={s.loading}>Loading preview…</div>
          ) : kind === 'pdf' ? (
            <PdfView blob={blob} zoom={zoom} onPages={setPages} onError={() => setError(true)} />
          ) : kind === 'image' ? (
            <ImageView blob={blob} zoom={zoom} alt={doc.title} />
          ) : kind === 'excel' ? (
            <ExcelView blob={blob} zoom={zoom} onError={() => setError(true)} />
          ) : kind === 'word' ? (
            <WordView blob={blob} zoom={zoom} onError={() => setError(true)} />
          ) : (
            <TextView blob={blob} csv={kind === 'csv'} />
          )}
        </div>

        {zoomable && blob && !error && (
          <div className={s.zoomBar}>
            {pages > 0 && (
              <span className={s.pages}>
                {pages} page{pages === 1 ? '' : 's'}
              </span>
            )}
            <button type="button" onClick={() => step(-1)} aria-label="Zoom out">
              −
            </button>
            <button type="button" className={s.zoomValue} onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Zoom in">
              +
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Renders every page to a canvas; zoom 1 = fit to the viewer's width. */
function PdfView({
  blob,
  zoom,
  onPages,
  onError,
}: {
  blob: Blob;
  zoom: number;
  onPages: (n: number) => void;
  onError: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fit, setFit] = useState(1);

  useEffect(() => {
    let doc: PDFDocumentProxy | null = null;
    let cancelled = false;
    (async () => {
      // Loaded on first preview only, so pdf.js isn't in the main bundle.
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      doc = await pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        isEvalSupported: false,
      }).promise;
      if (cancelled) return void doc.destroy();
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      const width = (wrap.current?.clientWidth ?? 800) - 48;
      setFit(Math.min(width / first.width, 1.6));
      setPdf(doc);
      onPages(doc.numPages);
    })().catch(() => !cancelled && onError());
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are stable enough; reload only on a new file
  }, [blob]);

  return (
    <div ref={wrap} className={s.pdfPages}>
      {pdf &&
        Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={i} pdf={pdf} n={i + 1} scale={fit * zoom} />
        ))}
    </div>
  );
}

function PdfPage({ pdf, n, scale }: { pdf: PDFDocumentProxy; n: number; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    void pdf.getPage(n).then((page) => {
      const el = canvas.current;
      if (cancelled || !el) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.floor(viewport.width * dpr);
      el.height = Math.floor(viewport.height * dpr);
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;
      task = page.render({
        canvasContext: el.getContext('2d')!,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      task.promise.catch(() => {}); // cancelled by a zoom change
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, n, scale]);
  return <canvas ref={canvas} className={s.sheet} aria-label={`Page ${n}`} />;
}

function ImageView({ blob, zoom, alt }: { blob: Blob; zoom: number; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return null;
  return (
    <div className={s.imageWrap}>
      <img
        src={url}
        alt={alt}
        className={s.sheet}
        style={{
          maxWidth: zoom === 1 ? '100%' : 'none',
          width: zoom === 1 ? undefined : `${zoom * 100}%`,
        }}
      />
    </div>
  );
}

function TextView({ blob, csv }: { blob: Blob; csv: boolean }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void blob.text().then(setText);
  }, [blob]);
  if (text === null) return <div className={s.loading}>Loading preview…</div>;
  const cut = text.length > TEXT_LIMIT;
  const shown = cut ? text.slice(0, TEXT_LIMIT) : text;
  if (csv) {
    const rows = parseCsv(shown);
    const [head, ...rest] = rows;
    return (
      <div className={`${s.sheet} ${s.textSheet}`}>
        <table className={s.csv}>
          {head && (
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rest.slice(0, CSV_ROWS).map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(cut || rest.length > CSV_ROWS) && (
          <p className={s.more}>Showing the first rows only. Download for the full file.</p>
        )}
      </div>
    );
  }
  return (
    <div className={`${s.sheet} ${s.textSheet}`}>
      <pre className={s.pre}>{shown}</pre>
      {cut && <p className={s.more}>Showing the start only. Download for the full file.</p>}
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className={s.notice}>
      <span className={s.noticeIcon}>{icons.documents({})}</span>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

/** Minimal CSV parser: commas, quoted fields, doubled quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function extOf(name: string) {
  return /\.([^.]+)$/.exec(name)?.[1]?.toUpperCase() ?? 'These';
}
