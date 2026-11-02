import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ui } from '../../components/ui';
import { fmtFileSize } from '../../lib/format';
import {
  baseName,
  burstPdf,
  COMPRESS_LEVELS,
  compressPdf,
  extractText,
  formatRanges,
  imagesToPdf,
  mergePdfs,
  organizePdf,
  pageCount,
  parseRanges,
  pdfToImages,
  readPages,
  removePages,
  splitPdf,
  type CompressLevel,
  type OutFile,
  type PagePlan,
} from '../../lib/pdfEngine';
import { addPageNumbers, addWatermark, type Corner } from '../../lib/pdfEdit';
import { pagesToDocx, pagesToXlsx } from '../../lib/pdfConvert';
import {
  ChosenFile,
  DropZone,
  FileOrderList,
  IMAGE_ACCEPT,
  LazyThumb,
  PDF_ACCEPT,
  Results,
  RunRow,
  usePdfThumbs,
  useRun,
} from './parts';
import s from './PdfTools.module.css';

/** Page count of the chosen file, shown next to its name. */
function usePageCount(file: File | null) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    setN(null);
    if (!file) return;
    let live = true;
    pageCount(file)
      .then((c) => live && setN(c))
      .catch(() => live && setN(null));
    return () => {
      live = false;
    };
  }, [file]);
  return n;
}

const pagesLabel = (n: number | null) => (n === null ? '' : ` · ${n} page${n === 1 ? '' : 's'}`);

export function MergeTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [out, setOut] = useState<OutFile[]>([]);
  const r = useRun();
  return (
    <>
      <DropZone
        accept={PDF_ACCEPT}
        multiple
        label="Add PDFs to merge"
        onFiles={(f) => {
          setFiles((xs) => [...xs, ...f]);
          setOut([]);
        }}
      />
      <FileOrderList files={files} onChange={setFiles} />
      <RunRow
        label="Merge PDFs"
        disabled={files.length < 2}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              const blob = await mergePdfs(files);
              setOut([{ name: `${baseName(files[0]!.name)}-merged.pdf`, blob }]);
            }),
        }}
      />
      {files.length === 1 && <div className={s.note}>Add at least one more PDF.</div>}
      <Results files={out} />
    </>
  );
}

type SplitMode = 'each' | 'single' | 'burst';

export function SplitTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SplitMode>('each');
  const [ranges, setRanges] = useState('');
  const [out, setOut] = useState<OutFile[]>([]);
  const pages = usePageCount(file);
  const r = useRun();
  if (!file)
    return (
      <DropZone accept={PDF_ACCEPT} label="Choose a PDF to split" onFiles={([f]) => setFile(f!)} />
    );
  return (
    <>
      <ChosenFile
        file={file}
        extra={pagesLabel(pages)}
        onClear={() => (setFile(null), setOut([]))}
      />
      <div className={s.options}>
        <div className={s.option}>
          How to split
          <div className={s.radioRow}>
            {(
              [
                ['each', 'One file per range'],
                ['single', 'Extract pages into one file'],
                ['burst', 'Every page as its own file'],
              ] as const
            ).map(([v, label]) => (
              <label key={v}>
                <input type="radio" checked={mode === v} onChange={() => setMode(v)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        {mode !== 'burst' && (
          <label className={s.option}>
            Pages
            <input
              className={ui.input}
              value={ranges}
              onChange={(e) => setRanges(e.target.value)}
              placeholder="e.g. 1-3, 5, 8-"
              style={{ width: 220 }}
            />
          </label>
        )}
      </div>
      <RunRow
        label="Split PDF"
        disabled={mode !== 'burst' && !ranges.trim()}
        state={{
          ...r,
          onRun: () =>
            r.run(async () =>
              setOut(mode === 'burst' ? await burstPdf(file) : await splitPdf(file, ranges, mode)),
            ),
        }}
      />
      <Results files={out} />
    </>
  );
}

interface PageCard extends PagePlan {
  key: number;
}

export function OrganizeTool() {
  const [file, setFile] = useState<File | null>(null);
  const [cards, setCards] = useState<PageCard[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [out, setOut] = useState<OutFile[]>([]);
  const thumbs = usePdfThumbs(file);
  const save = useRun();

  useEffect(() => {
    setCards(Array.from({ length: thumbs.count }, (_, i) => ({ key: i, index: i, rotate: 0 })));
    setOut([]);
  }, [file, thumbs.count]);

  if (!file)
    return (
      <DropZone
        accept={PDF_ACCEPT}
        label="Choose a PDF to organize"
        onFiles={([f]) => setFile(f!)}
      />
    );

  const update = (key: number, fn: (c: PageCard) => PageCard | null) => {
    setCards((cs) => cs.flatMap((c) => (c.key === key ? (fn(c) ?? []) : [c])));
    setOut([]);
  };
  const moveTo = (from: number, to: number) => {
    setCards((cs) => {
      const next = [...cs];
      const [c] = next.splice(from, 1);
      next.splice(to, 0, c!);
      return next;
    });
    setOut([]);
  };
  const rotateAll = (deg: number) => {
    setCards((cs) => cs.map((c) => ({ ...c, rotate: (c.rotate + deg + 360) % 360 })));
    setOut([]);
  };

  return (
    <>
      <ChosenFile
        file={file}
        extra={pagesLabel(cards.length || null)}
        onClear={() => setFile(null)}
      />
      {thumbs.loading && <div className={s.note}>Reading pages…</div>}
      {thumbs.error && <div className={s.error}>{thumbs.error}</div>}
      {cards.length > 0 && (
        <>
          <div className={s.runRow}>
            <button type="button" className={ui.ghostBtn} onClick={() => rotateAll(-90)}>
              ⟲ Rotate all left
            </button>
            <button type="button" className={ui.ghostBtn} onClick={() => rotateAll(90)}>
              ⟳ Rotate all right
            </button>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => setCards((cs) => [...cs].reverse())}
            >
              Reverse order
            </button>
            <span className={s.progress}>Drag pages to reorder.</span>
          </div>
          <div className={s.pages}>
            {cards.map((c, i) => (
              <div
                key={c.key}
                className={`${s.page}${dragging === i ? ` ${s.pageDragging}` : ''}${over === i && dragging !== i ? ` ${s.pageOver}` : ''}`}
                draggable
                onDragStart={() => setDragging(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging !== null && dragging !== i) moveTo(dragging, i);
                  setDragging(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <LazyThumb
                  index={c.index}
                  url={thumbs.urls[c.index]}
                  request={thumbs.request}
                  alt={`Page ${c.index + 1}`}
                  style={{
                    transform: `rotate(${c.rotate}deg) scale(${c.rotate % 180 ? 0.75 : 1})`,
                  }}
                />
                <div className={s.pageBar}>
                  <span>
                    {i + 1}
                    {c.index !== i && ` (p${c.index + 1})`}
                  </span>
                  <span className={s.pageBtns}>
                    <button
                      type="button"
                      className={s.iconBtn}
                      onClick={() =>
                        update(c.key, (x) => ({ ...x, rotate: (x.rotate + 270) % 360 }))
                      }
                      aria-label={`Rotate page ${i + 1} left`}
                      title="Rotate left"
                    >
                      ⟲
                    </button>
                    <button
                      type="button"
                      className={s.iconBtn}
                      onClick={() =>
                        update(c.key, (x) => ({ ...x, rotate: (x.rotate + 90) % 360 }))
                      }
                      aria-label={`Rotate page ${i + 1} right`}
                      title="Rotate right"
                    >
                      ⟳
                    </button>
                    <button
                      type="button"
                      className={s.iconBtn}
                      onClick={() =>
                        setCards((cs) => {
                          const next = [...cs];
                          next.splice(i + 1, 0, {
                            ...c,
                            key: Math.max(...cs.map((x) => x.key)) + 1,
                          });
                          return next;
                        })
                      }
                      aria-label={`Duplicate page ${i + 1}`}
                      title="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className={s.iconBtn}
                      disabled={cards.length === 1}
                      onClick={() => update(c.key, () => null)}
                      aria-label={`Delete page ${i + 1}`}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <RunRow
            label="Save PDF"
            disabled={!cards.length}
            state={{
              ...save,
              onRun: () =>
                save.run(async () => {
                  const blob = await organizePdf(file, cards);
                  setOut([{ name: `${baseName(file.name)}-organized.pdf`, blob }]);
                }),
            }}
          />
          <Results files={out} />
        </>
      )}
    </>
  );
}

export function RemovePagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [text, setText] = useState('');
  const [textError, setTextError] = useState('');
  const [out, setOut] = useState<OutFile[]>([]);
  const thumbs = usePdfThumbs(file);
  const save = useRun();
  const count = thumbs.count;
  const pages = Array.from({ length: count }, (_, i) => i);
  /** Last clicked page, the start of a shift-click range. */
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    anchor.current = null;
    setMarked(new Set());
    setText('');
    setTextError('');
    setOut([]);
  }, [file]);

  if (!file)
    return (
      <DropZone
        accept={PDF_ACCEPT}
        label="Choose a PDF to remove pages from"
        onFiles={([f]) => setFile(f!)}
      />
    );

  const select = (next: Set<number>) => {
    setMarked(next);
    setText(formatRanges(next));
    setTextError('');
    setOut([]);
  };
  /** Plain click toggles a page; shift-click gives every page from the last click the same state. */
  const toggle = (i: number, shift: boolean) => {
    const next = new Set(marked);
    const from = anchor.current;
    if (shift && from !== null) {
      const on = marked.has(from);
      for (let p = Math.min(from, i); p <= Math.max(from, i); p++) {
        if (on) next.add(p);
        else next.delete(p);
      }
    } else if (next.has(i)) next.delete(i);
    else next.add(i);
    anchor.current = i;
    select(next);
  };
  const typeRanges = (v: string) => {
    setText(v);
    setOut([]);
    if (!v.trim()) {
      setMarked(new Set());
      setTextError('');
      return;
    }
    try {
      setMarked(new Set(parseRanges(v, count).flat()));
      setTextError('');
    } catch (e) {
      setTextError(e instanceof Error ? e.message : 'Not a page range');
    }
  };
  const left = count - marked.size;

  return (
    <>
      <ChosenFile file={file} extra={pagesLabel(count || null)} onClear={() => setFile(null)} />
      {thumbs.loading && <div className={s.note}>Reading pages…</div>}
      {thumbs.error && <div className={s.error}>{thumbs.error}</div>}
      {count > 0 && (
        <>
          <div className={s.options}>
            <label className={s.option}>
              Pages to remove
              <input
                className={ui.input}
                value={text}
                onChange={(e) => typeRanges(e.target.value)}
                placeholder="e.g. 2, 5-7"
                style={{ width: 220 }}
              />
            </label>
            <div className={s.runRow} style={{ marginTop: 0 }}>
              <button
                type="button"
                className={ui.ghostBtn}
                onClick={() => select(new Set(pages.filter((i) => i % 2 === 1)))}
              >
                Even pages
              </button>
              <button
                type="button"
                className={ui.ghostBtn}
                onClick={() => select(new Set(pages.filter((i) => i % 2 === 0)))}
              >
                Odd pages
              </button>
              <button
                type="button"
                className={ui.ghostBtn}
                disabled={!marked.size}
                onClick={() => select(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          {textError ? (
            <div className={s.error}>{textError}</div>
          ) : (
            <div className={s.note}>
              Click pages to mark them for removal — hold Shift to mark a range.{' '}
              {marked.size > 0 &&
                `${marked.size} marked · ${left} page${left === 1 ? '' : 's'} will remain.`}
            </div>
          )}
          <div className={s.pages}>
            {pages.map((i) => {
              const on = marked.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  className={`${s.page} ${s.pagePick}${on ? ` ${s.pageRemoved}` : ''}`}
                  onClick={(e) => toggle(i, e.shiftKey)}
                  aria-pressed={on}
                  aria-label={`${on ? 'Keep' : 'Remove'} page ${i + 1}`}
                >
                  <LazyThumb index={i} url={thumbs.urls[i]} request={thumbs.request}>
                    {on && <span className={s.removeMark}>✕</span>}
                  </LazyThumb>
                  <div className={s.pageBar}>
                    <span>{i + 1}</span>
                    {on && <span className={s.removeLabel}>Remove</span>}
                  </div>
                </button>
              );
            })}
          </div>
          <RunRow
            label={
              marked.size
                ? `Remove ${marked.size} page${marked.size === 1 ? '' : 's'}`
                : 'Remove pages'
            }
            disabled={!marked.size || !left || !!textError}
            state={{
              ...save,
              onRun: () =>
                save.run(async () => {
                  const blob = await removePages(file, marked);
                  setOut([{ name: `${baseName(file.name)}-removed.pdf`, blob }]);
                }),
            }}
          />
          {marked.size > 0 && !left && (
            <div className={s.note}>At least one page has to stay in the PDF.</div>
          )}
          <Results files={out} />
        </>
      )}
    </>
  );
}

/** `name`, or `name (2)` etc. when already taken, so zip entries don't overwrite each other. */
function uniqueName(name: string, taken: Set<string>) {
  let n = name;
  for (let i = 2; taken.has(n); i++) n = name.replace(/(\.[^.]+)$/, ` (${i})$1`);
  taken.add(n);
  return n;
}

export function CompressTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [level, setLevel] = useState<CompressLevel>('medium');
  const [out, setOut] = useState<OutFile[]>([]);
  const [summary, setSummary] = useState<ReactNode>('');
  const r = useRun();
  const reset = () => (setOut([]), setSummary(''));
  return (
    <>
      <DropZone
        accept={PDF_ACCEPT}
        multiple
        label={files.length ? 'Add more PDFs' : 'Choose PDFs to compress'}
        onFiles={(f) => {
          setFiles((xs) => [...xs, ...f]);
          reset();
        }}
      />
      <FileOrderList
        files={files}
        onChange={(f) => {
          setFiles(f);
          reset();
        }}
      />
      {files.length > 0 && (
        <CompressOptions
          level={level}
          onLevel={(l) => {
            setLevel(l);
            reset();
          }}
        />
      )}
      <RunRow
        label={files.length > 1 ? `Compress ${files.length} PDFs` : 'Compress PDF'}
        disabled={!files.length}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              reset();
              const done: OutFile[] = [];
              const notes: string[] = [];
              const failed: string[] = [];
              const taken = new Set<string>();
              let before = 0;
              for (const [fi, file] of files.entries()) {
                const prefix = files.length > 1 ? `File ${fi + 1} of ${files.length} · ` : '';
                r.setProgress(`${prefix}Starting…`);
                try {
                  const res = await compressPdf(file, level, (d, t) =>
                    r.setProgress(`${prefix}Page ${d} of ${t}…`),
                  );
                  before += file.size;
                  done.push({
                    name: uniqueName(`${baseName(file.name)}-compressed.pdf`, taken),
                    blob: res.blob,
                  });
                  if (res.method === 'unchanged')
                    notes.push(`${file.name}: already as small as it gets.`);
                  else if (res.method === 'rasterized')
                    notes.push(`${file.name}: pages redrawn as images.`);
                } catch {
                  failed.push(file.name);
                }
              }
              if (!done.length) throw new Error('None of the files could be compressed.');
              const after = done.reduce((t, f) => t + f.blob.size, 0);
              const saved = Math.max(0, Math.round((1 - after / before) * 100));
              setSummary(
                <>
                  {after >= before
                    ? `Already as small as ${done.length === 1 ? 'it gets' : 'they get'} — no smaller version was found.`
                    : `${fmtFileSize(before)} → ${fmtFileSize(after)} (${saved}% smaller${done.length > 1 ? ' in total' : ''}).`}
                  {notes.map((n) => (
                    <div key={n}>{n}</div>
                  ))}
                  {failed.length > 0 && <div>Could not compress: {failed.join(', ')}.</div>}
                </>,
              );
              setOut(done);
            }),
        }}
      />
      <Results files={out} summary={summary} zipName="compressed-pdfs.zip" />
    </>
  );
}

function CompressOptions({
  level,
  onLevel,
}: {
  level: CompressLevel;
  onLevel: (l: CompressLevel) => void;
}) {
  return (
    <>
      <div className={s.options}>
        <div className={s.option}>
          Compression
          <div className={s.radioRow}>
            {(Object.keys(COMPRESS_LEVELS) as CompressLevel[]).map((k) => (
              <label key={k}>
                <input type="radio" checked={level === k} onChange={() => onLevel(k)} />
                {COMPRESS_LEVELS[k].label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className={s.note}>
        Scanned and photo-heavy PDFs shrink the most. If the smaller version needs pages redrawn as
        images, text in it can no longer be selected — keep the original for that.
      </div>
    </>
  );
}

export function ImagesToPdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [size, setSize] = useState<'a4' | 'fit'>('a4');
  const [out, setOut] = useState<OutFile[]>([]);
  const r = useRun();
  return (
    <>
      <DropZone
        accept={IMAGE_ACCEPT}
        multiple
        label="Add images (JPG, PNG, WebP…)"
        onFiles={(f) => {
          setFiles((xs) => [...xs, ...f]);
          setOut([]);
        }}
      />
      <FileOrderList files={files} onChange={setFiles} />
      <div className={s.options}>
        <div className={s.option}>
          Page size
          <div className={s.radioRow}>
            <label>
              <input type="radio" checked={size === 'a4'} onChange={() => setSize('a4')} />
              A4 (with margin)
            </label>
            <label>
              <input type="radio" checked={size === 'fit'} onChange={() => setSize('fit')} />
              Same as image
            </label>
          </div>
        </div>
      </div>
      <RunRow
        label="Create PDF"
        disabled={!files.length}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              const blob = await imagesToPdf(files, size);
              setOut([{ name: `${baseName(files[0]!.name)}.pdf`, blob }]);
            }),
        }}
      />
      <Results files={out} />
    </>
  );
}

export function PdfToImagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'png' | 'jpeg'>('jpeg');
  const [dpi, setDpi] = useState(150);
  const [out, setOut] = useState<OutFile[]>([]);
  const pages = usePageCount(file);
  const r = useRun();
  if (!file)
    return (
      <DropZone
        accept={PDF_ACCEPT}
        label="Choose a PDF to convert"
        onFiles={([f]) => setFile(f!)}
      />
    );
  return (
    <>
      <ChosenFile
        file={file}
        extra={pagesLabel(pages)}
        onClear={() => (setFile(null), setOut([]))}
      />
      <div className={s.options}>
        <label className={s.option}>
          Format
          <select
            className={ui.input}
            value={format}
            onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}
          >
            <option value="jpeg">JPG (smaller)</option>
            <option value="png">PNG (sharp, larger)</option>
          </select>
        </label>
        <label className={s.option}>
          Quality
          <select className={ui.input} value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={96}>Screen (96 dpi)</option>
            <option value={150}>Standard (150 dpi)</option>
            <option value={300}>Print (300 dpi)</option>
          </select>
        </label>
      </div>
      <RunRow
        label="Convert to images"
        disabled={false}
        state={{
          ...r,
          onRun: () =>
            r.run(async () =>
              setOut(
                await pdfToImages(file, format, dpi, (d, t) => r.setProgress(`Page ${d} of ${t}…`)),
              ),
            ),
        }}
      />
      <Results files={out} />
    </>
  );
}

export function PdfToTextTool() {
  const [file, setFile] = useState<File | null>(null);
  const [ranges, setRanges] = useState('');
  const [text, setText] = useState('');
  const [blank, setBlank] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const pages = usePageCount(file);
  const r = useRun();
  const reset = () => (setText(''), setBlank([]), setCopied(false));
  if (!file)
    return (
      <DropZone accept={PDF_ACCEPT} label="Choose a PDF to read" onFiles={([f]) => setFile(f!)} />
    );
  const out: OutFile[] = text
    ? [{ name: `${baseName(file.name)}.txt`, blob: new Blob([text], { type: 'text/plain' }) }]
    : [];
  return (
    <>
      <ChosenFile file={file} extra={pagesLabel(pages)} onClear={() => (setFile(null), reset())} />
      <div className={s.options}>
        <label className={s.option}>
          Pages
          <input
            className={ui.input}
            value={ranges}
            onChange={(e) => setRanges(e.target.value)}
            placeholder="All pages, or e.g. 1-3, 5"
            style={{ width: 220 }}
          />
        </label>
      </div>
      <RunRow
        label="Get text"
        disabled={pages === null}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              reset();
              const wanted = ranges.trim() ? parseRanges(ranges, pages!).flat() : undefined;
              const res = await extractText(file, wanted, (d, t) =>
                r.setProgress(`Page ${d} of ${t}…`),
              );
              const empty = res.filter((p) => !p.text).map((p) => p.page);
              if (empty.length === res.length)
                throw new Error(
                  'No text found — this looks like a scanned PDF, which has only pictures of text.',
                );
              setBlank(empty);
              setText(
                res.length === 1
                  ? res[0]!.text
                  : res.map((p) => `--- Page ${p.page + 1} ---\n${p.text}`).join('\n\n'),
              );
            }),
        }}
      />
      {text && (
        <>
          <textarea
            className={ui.input}
            readOnly
            value={text}
            rows={16}
            aria-label="Text from the PDF"
            style={{ width: '100%', marginTop: 16, fontFamily: 'monospace', fontSize: 12.5 }}
          />
          <div className={s.runRow} style={{ marginTop: 10 }}>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy text'}
            </button>
          </div>
          {blank.length > 0 && (
            <div className={s.note}>
              No text on page{blank.length === 1 ? '' : 's'} {formatRanges(blank)} — probably
              scanned.
            </div>
          )}
        </>
      )}
      <Results files={out} />
    </>
  );
}

/** PDF to Word or Excel: both rebuild the page from its text, so scans have nothing to give. */
export function PdfConvertTool({ to }: { to: 'docx' | 'xlsx' }) {
  const [file, setFile] = useState<File | null>(null);
  const [ranges, setRanges] = useState('');
  const [oneSheet, setOneSheet] = useState(false);
  const [blank, setBlank] = useState<number[]>([]);
  const [out, setOut] = useState<OutFile[]>([]);
  const pages = usePageCount(file);
  const r = useRun();
  const reset = () => (setOut([]), setBlank([]));
  if (!file)
    return (
      <DropZone
        accept={PDF_ACCEPT}
        label="Choose a PDF to convert"
        onFiles={([f]) => setFile(f!)}
      />
    );
  return (
    <>
      <ChosenFile file={file} extra={pagesLabel(pages)} onClear={() => (setFile(null), reset())} />
      <div className={s.options}>
        <label className={s.option}>
          Pages
          <input
            className={ui.input}
            value={ranges}
            onChange={(e) => setRanges(e.target.value)}
            placeholder="All pages, or e.g. 1-3, 5"
            style={{ width: 220 }}
          />
        </label>
        {to === 'xlsx' && (
          <div className={s.option}>
            Sheets
            <div className={s.radioRow}>
              <label>
                <input type="radio" checked={!oneSheet} onChange={() => setOneSheet(false)} />
                One sheet per page
              </label>
              <label>
                <input type="radio" checked={oneSheet} onChange={() => setOneSheet(true)} />
                All pages on one sheet
              </label>
            </div>
          </div>
        )}
      </div>
      <RunRow
        label={to === 'docx' ? 'Convert to Word' : 'Convert to Excel'}
        disabled={pages === null}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              reset();
              const wanted = ranges.trim() ? parseRanges(ranges, pages!).flat() : undefined;
              const read = await readPages(file, {
                pages: wanted,
                styles: to === 'docx',
                onProgress: (d, t) => r.setProgress(`Reading page ${d} of ${t}…`),
              });
              const empty = read.filter((p) => !p.rows.length).map((p) => p.page);
              if (empty.length === read.length)
                throw new Error(
                  'No text found — this looks like a scanned PDF, which has only pictures of text.',
                );
              r.setProgress('Building the file…');
              const blob =
                to === 'docx' ? await pagesToDocx(read) : await pagesToXlsx(read, oneSheet);
              setBlank(empty);
              setOut([{ name: `${baseName(file.name)}.${to}`, blob }]);
            }),
        }}
      />
      <Results
        files={out}
        summary={
          blank.length > 0 &&
          `No text on page${blank.length === 1 ? '' : 's'} ${formatRanges(blank)} — probably scanned, so ${blank.length === 1 ? 'it is' : 'they are'} empty in the file.`
        }
      />
      {out.length > 0 && (
        <div className={s.note}>
          {to === 'docx'
            ? 'Text keeps its place, size, bold and italics. Pictures, lines and boxes are not copied.'
            : 'Amounts become numbers, so they add up. Check column alignment on complex tables.'}
        </div>
      )}
    </>
  );
}

const CORNERS: [Corner, string][] = [
  ['bottom-center', 'Bottom centre'],
  ['bottom-right', 'Bottom right'],
  ['bottom-left', 'Bottom left'],
  ['top-right', 'Top right'],
];

export function PageNumbersTool() {
  const [file, setFile] = useState<File | null>(null);
  const [position, setPosition] = useState<Corner>('bottom-center');
  const [format, setFormat] = useState('Page {n} of {total}');
  const [start, setStart] = useState(1);
  const [size, setSize] = useState(10);
  const [skipFirst, setSkipFirst] = useState(false);
  const [out, setOut] = useState<OutFile[]>([]);
  const pages = usePageCount(file);
  const r = useRun();
  if (!file)
    return (
      <DropZone accept={PDF_ACCEPT} label="Choose a PDF to number" onFiles={([f]) => setFile(f!)} />
    );
  return (
    <>
      <ChosenFile
        file={file}
        extra={pagesLabel(pages)}
        onClear={() => (setFile(null), setOut([]))}
      />
      <div className={s.options}>
        <label className={s.option}>
          Position
          <select
            className={ui.input}
            value={position}
            onChange={(e) => setPosition(e.target.value as Corner)}
          >
            {CORNERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={s.option}>
          Format
          <select className={ui.input} value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="Page {n} of {total}">Page 1 of 9</option>
            <option value="{n} / {total}">1 / 9</option>
            <option value="Page {n}">Page 1</option>
            <option value="{n}">1</option>
            <option value="- {n} -">- 1 -</option>
          </select>
        </label>
        <label className={s.option}>
          First number
          <input
            className={ui.input}
            type="number"
            min={0}
            value={start}
            onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 90 }}
          />
        </label>
        <label className={s.option}>
          Size
          <select
            className={ui.input}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {[8, 9, 10, 11, 12, 14].map((n) => (
              <option key={n} value={n}>
                {n} pt
              </option>
            ))}
          </select>
        </label>
        <div className={s.radioRow}>
          <label>
            <input
              type="checkbox"
              checked={skipFirst}
              onChange={(e) => setSkipFirst(e.target.checked)}
            />
            Skip the first page (cover)
          </label>
        </div>
      </div>
      <RunRow
        label="Add page numbers"
        disabled={false}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              const blob = await addPageNumbers(file, { position, format, start, size, skipFirst });
              setOut([{ name: `${baseName(file.name)}-numbered.pdf`, blob }]);
            }),
        }}
      />
      <Results files={out} />
    </>
  );
}

export function WatermarkTool() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('CONFIDENTIAL');
  const [size, setSize] = useState(60);
  const [color, setColor] = useState('#dc2626');
  const [opacity, setOpacity] = useState(0.2);
  const [diagonal, setDiagonal] = useState(true);
  const [out, setOut] = useState<OutFile[]>([]);
  const pages = usePageCount(file);
  const r = useRun();
  if (!file)
    return (
      <DropZone
        accept={PDF_ACCEPT}
        label="Choose a PDF to watermark"
        onFiles={([f]) => setFile(f!)}
      />
    );
  return (
    <>
      <ChosenFile
        file={file}
        extra={pagesLabel(pages)}
        onClear={() => (setFile(null), setOut([]))}
      />
      <div className={s.options}>
        <label className={s.option}>
          Text
          <input
            className={ui.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ width: 220 }}
          />
        </label>
        <label className={s.option}>
          Size
          <select
            className={ui.input}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {[36, 48, 60, 72, 96].map((n) => (
              <option key={n} value={n}>
                {n} pt
              </option>
            ))}
          </select>
        </label>
        <label className={s.option}>
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 44, height: 32, padding: 2, cursor: 'pointer' }}
          />
        </label>
        <label className={s.option}>
          Opacity
          <select
            className={ui.input}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          >
            {[0.1, 0.2, 0.3, 0.5].map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
          </select>
        </label>
        <div className={s.radioRow}>
          <label>
            <input type="radio" checked={diagonal} onChange={() => setDiagonal(true)} />
            Diagonal
          </label>
          <label>
            <input type="radio" checked={!diagonal} onChange={() => setDiagonal(false)} />
            Horizontal
          </label>
        </div>
      </div>
      <RunRow
        label="Add watermark"
        disabled={!text.trim()}
        state={{
          ...r,
          onRun: () =>
            r.run(async () => {
              const blob = await addWatermark(file, {
                text: text.trim(),
                size,
                color,
                opacity,
                diagonal,
              });
              setOut([{ name: `${baseName(file.name)}-watermarked.pdf`, blob }]);
            }),
        }}
      />
      <Results files={out} />
    </>
  );
}
