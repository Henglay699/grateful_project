import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ui } from '../../components/ui';
import { saveBlob } from '../../lib/files';
import { fmtFileSize } from '../../lib/format';
import { openThumbs, zipFiles, type OutFile, type ThumbRenderer } from '../../lib/pdfEngine';
import s from './PdfTools.module.css';

export const PDF_ACCEPT = 'application/pdf,.pdf';
export const IMAGE_ACCEPT = 'image/*';

const matches = (f: File, accept: string) =>
  accept === PDF_ACCEPT
    ? f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    : f.type.startsWith('image/');

/** Click or drop files; files of the wrong type are ignored. */
export function DropZone({
  accept,
  multiple,
  onFiles,
  label,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => matches(f, accept));
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${s.drop}${over ? ` ${s.dropActive}` : ''}`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <span>{label}</span>
      <span className={s.dropHint}>
        Drop {multiple ? 'files' : 'a file'} here or click to choose · stays on this computer
      </span>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Ordered file list with move up/down and remove. */
export function FileOrderList({
  files,
  onChange,
  meta,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  meta?: (f: File) => ReactNode;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (i: number, d: number) => {
    const next = [...files];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const moveTo = (from: number, to: number) => {
    const next = [...files];
    const [f] = next.splice(from, 1);
    next.splice(to, 0, f!);
    onChange(next);
  };
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };
  return (
    <ul className={s.files}>
      {files.map((f, i) => (
        <li
          className={`${s.fileRow} ${s.fileRowDrag}${dragging === i ? ` ${s.pageDragging}` : ''}${over === i && dragging !== null && dragging !== i ? ` ${s.pageOver}` : ''}`}
          key={`${f.name}-${f.size}-${i}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            setDragging(i);
          }}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            if (dragging !== i) moveTo(dragging, i);
            endDrag();
          }}
          onDragEnd={endDrag}
        >
          <span className={s.grip} aria-hidden>
            ⠿
          </span>
          <span className={s.fileMeta}>{i + 1}.</span>
          <span className={s.fileName} title={f.name}>
            {f.name}
          </span>
          <span className={s.fileMeta}>{meta?.(f) ?? fmtFileSize(f.size)}</span>
          <button
            type="button"
            className={s.iconBtn}
            disabled={i === 0}
            onClick={() => move(i, -1)}
            aria-label={`Move ${f.name} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className={s.iconBtn}
            disabled={i === files.length - 1}
            onClick={() => move(i, 1)}
            aria-label={`Move ${f.name} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            aria-label={`Remove ${f.name}`}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The selected single file, with a way to pick another. */
export function ChosenFile({
  file,
  extra,
  onClear,
}: {
  file: File;
  extra?: ReactNode;
  onClear: () => void;
}) {
  return (
    <ul className={s.files}>
      <li className={s.fileRow}>
        <span className={s.fileName} title={file.name}>
          {file.name}
        </span>
        <span className={s.fileMeta}>
          {fmtFileSize(file.size)}
          {extra}
        </span>
        <button
          type="button"
          className={s.iconBtn}
          onClick={onClear}
          aria-label="Choose another file"
        >
          ✕
        </button>
      </li>
    </ul>
  );
}

/** Output files with per-file download and, for several, one zip. */
export function Results({
  files,
  summary,
  zipName: zipNameProp,
}: {
  files: OutFile[];
  summary?: ReactNode;
  zipName?: string;
}) {
  const [zipping, setZipping] = useState(false);
  if (!files.length) return null;
  const zipName = zipNameProp ?? files[0]!.name.replace(/(-p\d+(-\d+)?)?\.[^.]+$/, '') + '.zip';
  return (
    <div className={s.results}>
      <div className={s.resultsHead}>
        <span>Done — {files.length === 1 ? '1 file' : `${files.length} files`}</span>
        {files.length > 1 && (
          <button
            type="button"
            className="new-shipment-btn"
            disabled={zipping}
            onClick={async () => {
              setZipping(true);
              try {
                saveBlob(await zipFiles(files), zipName);
              } finally {
                setZipping(false);
              }
            }}
          >
            {zipping ? 'Zipping…' : 'Download all (.zip)'}
          </button>
        )}
      </div>
      {summary && <div className={s.note}>{summary}</div>}
      <ul className={s.files}>
        {files.map((f) => (
          <li className={s.fileRow} key={f.name}>
            <span className={s.fileName} title={f.name}>
              {f.name}
            </span>
            <span className={s.fileMeta}>{fmtFileSize(f.blob.size)}</span>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => {
                const url = URL.createObjectURL(f.blob);
                window.open(url, '_blank', 'noopener');
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }}
            >
              Open
            </button>
            <button type="button" className={ui.ghostBtn} onClick={() => saveBlob(f.blob, f.name)}>
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Opens `file` for page previews; `count` is known at once, previews come per page. */
export function usePdfThumbs(file: File | null) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [urls, setUrls] = useState<Record<number, string>>({});
  const renderer = useRef<ThumbRenderer | null>(null);

  useEffect(() => {
    setCount(0);
    setUrls({});
    setError('');
    if (!file) return;
    let live = true;
    let r: ThumbRenderer | null = null;
    setLoading(true);
    openThumbs(file)
      .then((x) => {
        if (!live) return x.destroy();
        r = renderer.current = x;
        setCount(x.count);
      })
      .catch(() => live && setError('This PDF could not be opened (it may be damaged).'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      r?.destroy();
      renderer.current = null;
    };
  }, [file]);

  const request = useCallback(
    (index: number) =>
      renderer.current?.request(index, (url) => setUrls((u) => ({ ...u, [index]: url }))),
    [],
  );
  return { count, loading, error, urls, request };
}

/** A page preview that asks for its image only when it scrolls near the view. */
export function LazyThumb({
  index,
  url,
  request,
  alt = '',
  style,
  children,
}: {
  index: number;
  url?: string;
  request: (index: number) => (() => void) | undefined;
  alt?: string;
  style?: CSSProperties;
  /** Drawn over the preview. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (url || !box.current) return;
    let cancel: (() => void) | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) cancel ??= request(index);
        else {
          cancel?.();
          cancel = undefined;
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(box.current);
    return () => {
      io.disconnect();
      cancel?.();
    };
  }, [index, url, request]);
  return (
    <div ref={box} className={s.thumbBox}>
      {url ? (
        <img src={url} alt={alt} style={style} draggable={false} />
      ) : (
        <span className={s.thumbPending} aria-label={`Loading page ${index + 1}`} />
      )}
      {children}
    </div>
  );
}

/** Runs a tool action with busy / progress / error state. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setProgress('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong with this file');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  return { busy, progress, setProgress, error, run };
}

export function RunRow({
  label,
  disabled,
  state,
}: {
  label: string;
  disabled: boolean;
  state: ReturnType<typeof useRun> & { onRun: () => void };
}) {
  return (
    <>
      <div className={s.runRow}>
        <button
          type="button"
          className="new-shipment-btn"
          disabled={disabled || state.busy}
          onClick={state.onRun}
        >
          {state.busy ? 'Working…' : label}
        </button>
        {state.busy && state.progress && <span className={s.progress}>{state.progress}</span>}
      </div>
      {state.error && (
        <div className={s.error} role="alert">
          {state.error}
        </div>
      )}
    </>
  );
}
