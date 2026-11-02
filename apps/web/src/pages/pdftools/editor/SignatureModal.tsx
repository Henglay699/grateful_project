import { useEffect, useRef, useState } from 'react';
import { Modal, ui } from '../../../components/ui';
import s from './Editor.module.css';

/** Crop a canvas to its drawn pixels and return a PNG data URL (null when blank). */
function trimmed(canvas: HTMLCanvasElement): { src: string; w: number; h: number } | null {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out
    .getContext('2d')!
    .drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width, h: out.height };
}

const INKS = ['#111827', '#1e3a8a', '#b91c1c'];
const SCRIPT_FONT = "'Brush Script MT', 'Segoe Script', cursive";

/** Draw or type a signature; returns a transparent PNG. */
export function SignatureModal({
  onClose,
  onUse,
}: {
  onClose: () => void;
  onUse: (sig: { src: string; w: number; h: number }) => void;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [ink, setInk] = useState(INKS[1]!);
  const [name, setName] = useState('');
  const [empty, setEmpty] = useState(true);
  const pad = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);

  useEffect(() => {
    const c = pad.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
    setEmpty(true);
  }, [mode]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2];
  };

  const use = () => {
    if (mode === 'draw') {
      const sig = pad.current && trimmed(pad.current);
      if (sig) onUse(sig);
      return;
    }
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = `120px ${SCRIPT_FONT}`;
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(name).width) + 40;
    c.height = 200;
    ctx.font = font;
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 20, 100);
    const sig = trimmed(c);
    if (sig) onUse(sig);
  };

  return (
    <Modal
      title="Add signature"
      sub="Placed on the page, then drag to position and resize."
      onClose={onClose}
      width={620}
    >
      <div className={s.padWrap}>
        <div className={s.tools}>
          {(['draw', 'type'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${s.toolBtn}${mode === m ? ` ${s.toolOn}` : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'draw' ? 'Draw' : 'Type'}
            </button>
          ))}
          <span className={s.spacer} />
          {INKS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Ink ${c}`}
              onClick={() => setInk(c)}
              className={s.toolBtn}
              style={{ padding: 0, width: 32, justifyContent: 'center' }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: c,
                  boxShadow: '0 0 0 1px var(--border-strong)',
                  outline: ink === c ? '2px solid var(--accent-primary)' : 'none',
                  outlineOffset: 2,
                }}
              />
            </button>
          ))}
        </div>
        {mode === 'draw' ? (
          <canvas
            ref={pad}
            className={s.pad}
            aria-label="Signature pad"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              last.current = point(e);
            }}
            onPointerMove={(e) => {
              if (!last.current) return;
              const ctx = e.currentTarget.getContext('2d')!;
              const p = point(e);
              ctx.strokeStyle = ink;
              ctx.lineWidth = 5;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.beginPath();
              ctx.moveTo(...last.current);
              ctx.lineTo(...p);
              ctx.stroke();
              last.current = p;
              setEmpty(false);
            }}
            onPointerUp={() => (last.current = null)}
          />
        ) : (
          <>
            <input
              className={ui.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your name"
              autoFocus
            />
            <div className={s.typed} style={{ color: ink }}>
              {name || ' '}
            </div>
          </>
        )}
        <div className={ui.actions}>
          {mode === 'draw' && (
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => {
                const c = pad.current!;
                c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
                setEmpty(true);
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="new-shipment-btn"
            disabled={mode === 'draw' ? empty : !name.trim()}
            onClick={use}
          >
            Use signature
          </button>
        </div>
      </div>
    </Modal>
  );
}
