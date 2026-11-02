import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ui } from '../../../components/ui';
import { baseName, openForRender, type OutFile } from '../../../lib/pdfEngine';
import { applyEdits, type EditItem, type InkItem, type RectItem } from '../../../lib/pdfEdit';
import { ChosenFile, DropZone, PDF_ACCEPT, Results, RunRow, useRun } from '../parts';
import { SignatureModal } from './SignatureModal';
import s from './Editor.module.css';

type Mode = 'select' | 'text' | 'draw' | 'highlight' | 'whiteout' | 'box';
type ColorKey = 'text' | 'draw' | 'highlight' | 'box';
interface PageSize {
  width: number;
  height: number;
}

const newId = () => Math.random().toString(36).slice(2, 10);

const svg = (d: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);

const MODES: { id: Mode; label: string; icon: ReactNode; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    icon: svg(<path d="M4 3l7 17 2.5-7.5L21 10z" />),
    hint: 'Click an item to select it, drag to move, use the corner to resize. Double-click text to edit. Delete removes it.',
  },
  {
    id: 'text',
    label: 'Text',
    icon: svg(<path d="M4 7V4h16v3M9 20h6M12 4v16" />),
    hint: 'Click on the page where the text should start, then type. Click outside to finish.',
  },
  {
    id: 'draw',
    label: 'Draw',
    icon: svg(
      <path d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.6 7.6" />,
    ),
    hint: 'Drag on the page to draw freehand.',
  },
  {
    id: 'highlight',
    label: 'Highlight',
    icon: svg(
      <path d="M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />,
    ),
    hint: 'Drag over text to highlight it.',
  },
  {
    id: 'whiteout',
    label: 'Whiteout',
    icon: svg(
      <>
        <rect x="3" y="6" width="18" height="12" rx="1" />
        <path d="M7 10h6" />
      </>,
    ),
    hint: 'Drag over something to cover it with white — then add new text on top to replace it.',
  },
  {
    id: 'box',
    label: 'Box',
    icon: svg(<rect x="3" y="5" width="18" height="14" rx="1" />),
    hint: 'Drag to draw a rectangle outline.',
  },
];

const DEFAULT_COLORS: Record<ColorKey, string> = {
  text: '#111827',
  draw: '#1e3a8a',
  highlight: '#facc15',
  box: '#dc2626',
};

/** Read an image file as a PNG/JPEG data URL plus its pixel size. */
async function loadImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  if (file.type === 'image/png' || file.type === 'image/jpeg') {
    const src = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error('Could not read the image'));
      r.readAsDataURL(file);
    });
    return { src, w: bmp.width, h: bmp.height };
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return { src: c.toDataURL('image/png'), w: bmp.width, h: bmp.height };
}

export function EditPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  if (!file)
    return (
      <DropZone accept={PDF_ACCEPT} label="Choose a PDF to edit" onFiles={([f]) => setFile(f!)} />
    );
  return <Editor key={`${file.name}-${file.size}`} file={file} onClear={() => setFile(null)} />;
}

function Editor({ file, onClear }: { file: File; onClear: () => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<EditItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const undo = useRef<EditItem[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [textSize, setTextSize] = useState(14);
  const [bold, setBold] = useState(false);
  const [inkWidth, setInkWidth] = useState(2);
  const [zoom, setZoom] = useState(1);
  const [signing, setSigning] = useState(false);
  const [out, setOut] = useState<OutFile[]>([]);
  const activePage = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const save = useRun();

  useEffect(() => {
    let d: PDFDocumentProxy | null = null;
    let live = true;
    (async () => {
      d = await openForRender(file);
      const list: PageSize[] = [];
      for (let i = 1; i <= d.numPages; i++) {
        const vp = (await d.getPage(i)).getViewport({ scale: 1 });
        list.push({ width: vp.width, height: vp.height });
      }
      if (!live) return;
      const room = (stage.current?.clientWidth ?? 900) - 48;
      setZoom(Math.min(1.5, Math.max(0.5, room / Math.max(...list.map((p) => p.width)))));
      setSizes(list);
      setDoc(d);
    })().catch(
      () =>
        live &&
        setLoadError('This PDF could not be opened (it may be damaged or password-protected).'),
    );
    return () => {
      live = false;
      void d?.destroy();
    };
  }, [file]);

  /** Remember the current items so the next change can be undone. */
  const snapshot = useCallback(() => {
    undo.current.push(itemsRef.current);
    if (undo.current.length > 100) undo.current.shift();
    setUndoCount(undo.current.length);
    setOut([]);
  }, []);
  const commit = useCallback(
    (fn: (xs: EditItem[]) => EditItem[]) => {
      snapshot();
      setItems(fn(itemsRef.current));
    },
    [snapshot],
  );
  const patch = (id: string, p: Partial<EditItem>) =>
    setItems((xs) => xs.map((i) => (i.id === id ? ({ ...i, ...p } as EditItem) : i)));
  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    setUndoCount(undo.current.length);
    setItems(prev);
    setSelected(null);
    setEditing(null);
  }, []);
  const remove = useCallback(
    (id: string) => {
      commit((xs) => xs.filter((i) => i.id !== id));
      setSelected(null);
      setEditing(null);
    },
    [commit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        remove(selected);
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, doUndo, remove]);

  const sel = items.find((i) => i.id === selected) ?? null;

  /** Put an image in the middle of the page last worked on, scaled to fit. */
  const placeImage = (img: { src: string; w: number; h: number }, maxW: number) => {
    const page = activePage.current;
    const p = sizes[page];
    if (!p) return;
    const k = Math.min(1, maxW / img.w, (p.height * 0.5) / img.h);
    const w = img.w * k;
    const h = img.h * k;
    const item: EditItem = {
      id: newId(),
      page,
      kind: 'image',
      x: (p.width - w) / 2,
      y: (p.height - h) / 2,
      w,
      h,
      src: img.src,
    };
    commit((xs) => [...xs, item]);
    setSelected(item.id);
    setMode('select');
  };

  const colorKey: ColorKey | null = sel
    ? sel.kind === 'text'
      ? 'text'
      : sel.kind === 'ink'
        ? 'draw'
        : sel.kind === 'rect' && sel.style !== 'whiteout'
          ? sel.style
          : null
    : mode === 'text' || mode === 'draw' || mode === 'highlight' || mode === 'box'
      ? mode
      : null;
  const currentColor = sel && 'color' in sel ? sel.color : colorKey ? colors[colorKey] : '';
  const showText = sel ? sel.kind === 'text' : mode === 'text';
  const showWidth = sel ? sel.kind === 'ink' : mode === 'draw';
  const setProp = (p: Partial<EditItem>) => {
    if (sel) commit((xs) => xs.map((i) => (i.id === sel.id ? ({ ...i, ...p } as EditItem) : i)));
  };

  if (loadError)
    return (
      <>
        <ChosenFile file={file} onClear={onClear} />
        <div className={s.hint} role="alert" style={{ color: 'var(--status-exception-fg)' }}>
          {loadError}
        </div>
      </>
    );

  return (
    <>
      <ChosenFile
        file={file}
        extra={sizes.length ? ` · ${sizes.length} page${sizes.length === 1 ? '' : 's'}` : ''}
        onClear={onClear}
      />
      <div className={s.toolbar} role="toolbar" aria-label="Edit tools">
        <div className={s.tools}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${s.toolBtn}${mode === m.id ? ` ${s.toolOn}` : ''}`}
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id);
                if (m.id !== 'select') setSelected(null);
              }}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
          <button type="button" className={s.toolBtn} onClick={() => imageInput.current?.click()}>
            {svg(
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </>,
            )}
            Image
          </button>
          <button type="button" className={s.toolBtn} onClick={() => setSigning(true)}>
            {svg(<path d="M3 17c3-3 4-9 6-9s-1 9 2 9 3-5 5-5 1 4 3 4h2M3 21h18" />)}
            Signature
          </button>
          <input
            ref={imageInput}
            type="file"
            hidden
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f)
                placeImage(await loadImage(f), (sizes[activePage.current]?.width ?? 400) * 0.4);
            }}
          />
        </div>
      </div>
      {/* A second fixed row, so picking a tool never changes the toolbar's height. */}
      <div className={`${s.toolbar} ${s.propsRow}`}>
        {!colorKey && !showText && !showWidth && (
          <span className={s.prop} style={{ color: 'var(--text-tertiary)' }}>
            {sel ? 'Drag to move' : 'Pick a tool to see its options'}
          </span>
        )}
        {colorKey && (
          <label className={s.prop}>
            Color
            <input
              type="color"
              className={s.color}
              value={currentColor}
              onChange={(e) => {
                const v = e.target.value;
                setColors((c) => ({ ...c, [colorKey]: v }));
                if (sel) patch(sel.id, { color: v });
              }}
              onFocus={() => sel && snapshot()}
            />
          </label>
        )}
        {showText && (
          <>
            <label className={s.prop}>
              Size
              <select
                className={`${ui.input} ${s.small}`}
                value={sel?.kind === 'text' ? sel.size : textSize}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTextSize(v);
                  setProp({ size: v });
                }}
              >
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`${s.toolBtn}${(sel?.kind === 'text' ? sel.bold : bold) ? ` ${s.toolOn}` : ''}`}
              aria-pressed={sel?.kind === 'text' ? !!sel.bold : bold}
              onClick={() => {
                const v = !(sel?.kind === 'text' ? sel.bold : bold);
                setBold(v);
                setProp({ bold: v });
              }}
              style={{ fontWeight: 900 }}
            >
              B
            </button>
          </>
        )}
        {showWidth && (
          <label className={s.prop}>
            Width
            <select
              className={`${ui.input} ${s.small}`}
              value={sel?.kind === 'ink' ? sel.width : inkWidth}
              onChange={(e) => {
                const v = Number(e.target.value);
                setInkWidth(v);
                setProp({ width: v });
              }}
            >
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} pt
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={s.spacer} />
        <button
          type="button"
          className={s.toolBtn}
          disabled={!undoCount}
          onClick={doUndo}
          title="Undo (Ctrl+Z)"
        >
          {svg(<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />)}
          Undo
        </button>
        <button
          type="button"
          className={s.toolBtn}
          disabled={!sel}
          onClick={() => sel && remove(sel.id)}
          title="Delete (Del)"
        >
          {svg(<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />)}
          Delete
        </button>
        <span className={s.sep} />
        <button
          type="button"
          className={s.toolBtn}
          onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className={s.zoom}>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={s.toolBtn}
          onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
      <div className={s.hint}>{MODES.find((m) => m.id === mode)?.hint}</div>

      <div className={s.stage} ref={stage}>
        {!doc && (
          <div className={s.hint} style={{ textAlign: 'center' }}>
            Opening PDF…
          </div>
        )}
        {doc &&
          sizes.map((size, i) => (
            <EditorPage
              key={i}
              doc={doc}
              index={i}
              size={size}
              zoom={zoom}
              mode={mode}
              items={items.filter((it) => it.page === i)}
              selected={selected}
              editing={editing}
              style={{ colors, textSize, bold, inkWidth }}
              onActivate={() => (activePage.current = i)}
              // Editing ends on the text's own blur, which saves what was typed.
              onSelect={setSelected}
              onCreate={(item, edit) => {
                commit((xs) => [...xs, item]);
                if (edit) {
                  setSelected(item.id);
                  setEditing(item.id);
                  setMode('select');
                }
              }}
              onEdit={setEditing}
              onFinishText={(id, text) => {
                setEditing(null);
                const it = itemsRef.current.find((x) => x.id === id);
                if (!it || it.kind !== 'text') return;
                if (!text.trim()) {
                  // An empty new box just disappears; clearing an old one is an undoable delete.
                  if (it.text) remove(id);
                  else setItems((xs) => xs.filter((x) => x.id !== id));
                  setSelected(null);
                } else if (text !== it.text) {
                  if (it.text) snapshot();
                  patch(id, { text });
                }
              }}
              onDragStart={snapshot}
              onPatch={patch}
            />
          ))}
      </div>

      <RunRow
        label="Save PDF"
        disabled={!doc || !items.length}
        state={{
          ...save,
          onRun: () =>
            save.run(async () => {
              setSelected(null);
              setEditing(null);
              const blob = await applyEdits(file, itemsRef.current);
              setOut([{ name: `${baseName(file.name)}-edited.pdf`, blob }]);
            }),
        }}
      />
      {!items.length && doc && (
        <div className={s.hint}>Add something to the pages to save a copy.</div>
      )}
      <Results files={out} />
      {signing && (
        <SignatureModal
          onClose={() => setSigning(false)}
          onUse={(sig) => {
            setSigning(false);
            placeImage(sig, 170);
          }}
        />
      )}
    </>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  zoom: number;
  mode: Mode;
  items: EditItem[];
  selected: string | null;
  editing: string | null;
  style: { colors: Record<ColorKey, string>; textSize: number; bold: boolean; inkWidth: number };
  onActivate: () => void;
  onSelect: (id: string | null) => void;
  onCreate: (item: EditItem, edit?: boolean) => void;
  onEdit: (id: string) => void;
  onFinishText: (id: string, text: string) => void;
  onDragStart: () => void;
  onPatch: (id: string, p: Partial<EditItem>) => void;
}

function EditorPage(p: PageProps) {
  const { doc, index, size, zoom, mode, items, selected, editing } = p;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(index < 2);
  const [draft, setDraft] = useState<InkItem | RectItem | null>(null);
  const origin = useRef<[number, number]>([0, 0]);

  // Draw pages only once they scroll near the view.
  useEffect(() => {
    if (visible || !wrap.current) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), {
      rootMargin: '800px',
    });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let live = true;
    (async () => {
      const page = await doc.getPage(index + 1);
      const c = canvas.current;
      if (!live || !c) return;
      const vp = page.getViewport({ scale: zoom * (window.devicePixelRatio || 1) });
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      task = page.render({ canvasContext: c.getContext('2d')!, viewport: vp });
      await task.promise;
    })().catch(() => {});
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, index, zoom, visible]);

  const toView = (e: React.PointerEvent): [number, number] => {
    const r = overlay.current!.getBoundingClientRect();
    return [
      Math.min(size.width, Math.max(0, (e.clientX - r.left) / zoom)),
      Math.min(size.height, Math.max(0, (e.clientY - r.top) / zoom)),
    ];
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    p.onActivate();
    if (e.button !== 0) return;
    const [x, y] = toView(e);
    if (mode === 'select') return p.onSelect(null);
    if (mode === 'text') {
      e.preventDefault();
      return p.onCreate(
        {
          id: newId(),
          page: index,
          kind: 'text',
          x,
          y: Math.max(0, y - p.style.textSize * 0.6),
          text: '',
          size: p.style.textSize,
          color: p.style.colors.text,
          bold: p.style.bold,
        },
        true,
      );
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = [x, y];
    setDraft(
      mode === 'draw'
        ? {
            id: newId(),
            page: index,
            kind: 'ink',
            points: [[x, y]],
            color: p.style.colors.draw,
            width: p.style.inkWidth,
          }
        : {
            id: newId(),
            page: index,
            kind: 'rect',
            x,
            y,
            w: 0,
            h: 0,
            style: mode as RectItem['style'],
            color: mode === 'box' ? p.style.colors.box : p.style.colors.highlight,
          },
    );
  };

  const onMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const [x, y] = toView(e);
    if (draft.kind === 'ink') setDraft({ ...draft, points: [...draft.points, [x, y]] });
    else {
      const [ox, oy] = origin.current;
      setDraft({
        ...draft,
        x: Math.min(x, ox),
        y: Math.min(y, oy),
        w: Math.abs(x - ox),
        h: Math.abs(y - oy),
      });
    }
  };

  const onUp = () => {
    if (!draft) return;
    if (draft.kind === 'ink' ? draft.points.length > 1 : draft.w > 3 && draft.h > 3)
      p.onCreate(draft);
    setDraft(null);
  };

  /** Drag to move (or, from the corner handle, resize) an item. */
  const startDrag = (e: React.PointerEvent, item: EditItem, resize = false) => {
    if (mode !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    p.onActivate();
    p.onSelect(item.id);
    if (editing === item.id) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 2 / zoom) return;
        moved = true;
        p.onDragStart();
      }
      if (item.kind === 'ink')
        p.onPatch(item.id, { points: item.points.map(([x, y]) => [x + dx, y + dy]) });
      else if (resize && (item.kind === 'image' || item.kind === 'rect')) {
        const w = Math.max(8, item.w + dx);
        p.onPatch(
          item.id,
          item.kind === 'image'
            ? { w, h: (w * item.h) / item.w }
            : { w, h: Math.max(8, item.h + dy) },
        );
      } else p.onPatch(item.id, { x: item.x + dx, y: item.y + dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const z = zoom;
  const live = mode === 'select';
  const box = (it: { x: number; y: number; w: number; h: number }) => ({
    left: it.x * z,
    top: it.y * z,
    width: it.w * z,
    height: it.h * z,
  });
  const inks = [
    ...items.filter((i): i is InkItem => i.kind === 'ink'),
    ...(draft?.kind === 'ink' ? [draft] : []),
  ];

  return (
    <div className={s.pageWrap} ref={wrap}>
      <div className={s.pageLabel}>Page {index + 1}</div>
      <div className={s.page} style={{ width: size.width * z, height: size.height * z }}>
        <canvas ref={canvas} />
        <div
          ref={overlay}
          className={`${s.overlay}${mode === 'text' ? ` ${s.textCursor}` : mode !== 'select' ? ` ${s.crosshair}` : ''}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {[...items, ...(draft?.kind === 'rect' ? [draft] : [])].map((it) => {
            const isSel = selected === it.id;
            const cls = `${s.item}${live ? ` ${s.movable}` : ''}${isSel && editing !== it.id ? ` ${s.selected}` : ''}`;
            const events = {
              onPointerDown: (e: React.PointerEvent) => startDrag(e, it),
              style: { pointerEvents: live || editing === it.id ? undefined : 'none' } as const,
            };
            if (it.kind === 'rect')
              return (
                <div
                  key={it.id}
                  className={cls}
                  {...events}
                  style={{
                    ...events.style,
                    ...box(it),
                    background:
                      it.style === 'whiteout'
                        ? '#fff'
                        : it.style === 'highlight'
                          ? it.color
                          : undefined,
                    opacity: it.style === 'highlight' ? 0.4 : 1,
                    mixBlendMode: it.style === 'highlight' ? 'multiply' : undefined,
                    border: it.style === 'box' ? `${1.5 * z}px solid ${it.color}` : undefined,
                  }}
                >
                  {isSel && (
                    <span className={s.handle} onPointerDown={(e) => startDrag(e, it, true)} />
                  )}
                </div>
              );
            if (it.kind === 'image')
              return (
                <div
                  key={it.id}
                  className={cls}
                  {...events}
                  style={{ ...events.style, ...box(it) }}
                >
                  <img className={s.image} src={it.src} alt="" draggable={false} />
                  {isSel && (
                    <span className={s.handle} onPointerDown={(e) => startDrag(e, it, true)} />
                  )}
                </div>
              );
            if (it.kind === 'text') {
              const isEditing = editing === it.id;
              return (
                <div
                  // A fresh element while editing, so React never fights the browser over the text.
                  key={isEditing ? `${it.id}-edit` : it.id}
                  className={`${cls} ${s.text}`}
                  {...events}
                  onDoubleClick={() => p.onEdit(it.id)}
                  contentEditable={isEditing ? 'plaintext-only' : undefined}
                  suppressContentEditableWarning
                  ref={(el) => {
                    if (isEditing && el && document.activeElement !== el) {
                      el.textContent = it.text;
                      el.focus();
                      const r = document.createRange();
                      r.selectNodeContents(el);
                      r.collapse(false);
                      getSelection()?.removeAllRanges();
                      getSelection()?.addRange(r);
                    }
                  }}
                  onBlur={(e) =>
                    isEditing && p.onFinishText(it.id, e.currentTarget.innerText.replace(/\n$/, ''))
                  }
                  onKeyDown={(e) => {
                    if (isEditing && e.key === 'Escape') e.currentTarget.blur();
                  }}
                  style={{
                    ...events.style,
                    left: it.x * z,
                    top: it.y * z,
                    fontSize: it.size * z,
                    color: it.color,
                    fontWeight: it.bold ? 700 : 400,
                  }}
                >
                  {isEditing ? null : it.text}
                </div>
              );
            }
            return null;
          })}
        </div>
        {inks.length > 0 && (
          <svg
            className={s.ink}
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
          >
            {inks.map((it) => {
              const d = it.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
              const xs = it.points.map((pt) => pt[0]);
              const ys = it.points.map((pt) => pt[1]);
              return (
                <g key={it.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={it.color}
                    strokeWidth={it.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {live && (
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(10, it.width + 8)}
                      style={{ cursor: 'move', pointerEvents: 'stroke' }}
                      onPointerDown={(e) => startDrag(e, it)}
                    />
                  )}
                  {selected === it.id && (
                    <rect
                      x={Math.min(...xs) - 3}
                      y={Math.min(...ys) - 3}
                      width={Math.max(...xs) - Math.min(...xs) + 6}
                      height={Math.max(...ys) - Math.min(...ys) + 6}
                      fill="none"
                      stroke="var(--accent-blue)"
                      strokeDasharray="4 3"
                      strokeWidth={1.2 / z}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
