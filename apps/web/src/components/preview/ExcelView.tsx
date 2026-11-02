import { useEffect, useState, type CSSProperties } from 'react';
import type { Cell, Workbook, Worksheet } from 'exceljs';
import s from './ExcelView.module.css';

const MAX_ROWS = 1000; // per sheet; the download has the rest
const MAX_COLS = 60;

interface GridCell {
  text: string;
  style: CSSProperties;
  rowSpan?: number;
  colSpan?: number;
}
interface Sheet {
  name: string;
  colWidths: number[];
  rowHeights: (number | undefined)[];
  rows: (GridCell | null)[][]; // null = covered by a merged cell
  cut: boolean;
}

/** Excel-like read-only grid: column letters, row numbers, cell formatting, sheet tabs. */
export function ExcelView({
  blob,
  zoom,
  onError,
}: {
  blob: Blob;
  zoom: number;
  onError: () => void;
}) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Loaded on first Excel preview only.
      const { default: ExcelJS } = await import('exceljs');
      const wb: Workbook = new ExcelJS.Workbook();
      await wb.xlsx.load(await blob.arrayBuffer());
      const out = wb.worksheets.filter((ws) => ws.state === 'visible').map(readSheet);
      if (!cancelled) setSheets(out);
    })().catch(() => !cancelled && onError());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on a new file
  }, [blob]);

  if (!sheets) return <div className={s.loading}>Loading preview…</div>;
  if (sheets.length === 0)
    return <div className={s.loading}>This workbook has no visible sheets.</div>;
  const sheet = sheets[active]!;

  return (
    <div className={s.wrap}>
      <div className={s.scroll}>
        <table className={s.grid} style={{ zoom }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {sheet.colWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={s.corner} />
              {sheet.colWidths.map((_, i) => (
                <th key={i} className={s.colHead}>
                  {colLetter(i + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} style={{ height: sheet.rowHeights[r] }}>
                <th className={s.rowHead}>{r + 1}</th>
                {row.map((c, i) =>
                  c ? (
                    <td key={i} rowSpan={c.rowSpan} colSpan={c.colSpan} style={c.style}>
                      {c.text}
                    </td>
                  ) : null,
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.cut && (
          <p className={s.more}>
            Showing the first {MAX_ROWS} rows and {MAX_COLS} columns. Download for the full sheet.
          </p>
        )}
      </div>
      {sheets.length > 1 && (
        <div className={s.tabs} role="tablist">
          {sheets.map((sh, i) => (
            <button
              key={sh.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={i === active ? s.tabActive : s.tab}
              onClick={() => setActive(i)}
            >
              {sh.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function readSheet(ws: Worksheet): Sheet {
  const totalRows = ws.rowCount;
  const totalCols = ws.columnCount;
  const nRows = Math.min(Math.max(totalRows, 1), MAX_ROWS);
  const nCols = Math.min(Math.max(totalCols, 1), MAX_COLS);

  // Merged ranges: the top-left cell spans, the rest are skipped.
  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
  for (const m of merges) {
    const [a, b] = m.split(':');
    if (!a || !b) continue;
    const [r1, c1] = addr(a);
    const [r2, c2] = addr(b);
    spans.set(`${r1}:${c1}`, { rowSpan: r2 - r1 + 1, colSpan: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
  }

  const colWidths = Array.from({ length: nCols }, (_, i) => {
    const w = ws.getColumn(i + 1).width;
    return ws.getColumn(i + 1).hidden ? 0 : Math.round((w ?? 8.43) * 7 + 5);
  });
  const rowHeights: (number | undefined)[] = [];
  const rows: (GridCell | null)[][] = [];
  for (let r = 1; r <= nRows; r++) {
    const row = ws.getRow(r);
    rowHeights.push(row.height ? Math.round((row.height * 4) / 3) : undefined);
    const cells: (GridCell | null)[] = [];
    for (let c = 1; c <= nCols; c++) {
      if (covered.has(`${r}:${c}`)) {
        cells.push(null);
        continue;
      }
      const cell = row.getCell(c);
      cells.push({ text: cellText(cell), style: cellStyle(cell), ...spans.get(`${r}:${c}`) });
    }
    rows.push(cells);
  }
  return {
    name: ws.name,
    colWidths,
    rowHeights,
    rows,
    cut: totalRows > MAX_ROWS || totalCols > MAX_COLS,
  };
}

/** Display text, applying the common number formats (decimals, thousands, %, dates). */
function cellText(cell: Cell): string {
  let v: unknown = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v)
      v = (v as { result: unknown }).result; // formula
    else if ('richText' in v || 'text' in v || 'hyperlink' in v) return cell.text;
    else if ('error' in v) return String((v as { error: unknown }).error);
  }
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDate(v, cell.numFmt);
  if (typeof v === 'number') return fmtNumber(v, cell.numFmt);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function fmtNumber(n: number, fmt: string | undefined): string {
  if (!fmt || fmt === 'General') return String(Math.round(n * 1e10) / 1e10);
  const section = fmt.split(';')[0]!.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  const pct = section.includes('%');
  const decimals = /\.(0+)/.exec(section)?.[1]?.length ?? 0;
  const value = pct ? n * 100 : n;
  const text = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: section.includes(','),
  });
  const currency = /\$|USD/.test(fmt) ? '$' : '';
  return `${value < 0 && currency ? '-' : ''}${currency}${currency ? text.replace('-', '') : text}${pct ? '%' : ''}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d: Date, fmt: string | undefined): string {
  // Excel dates carry no zone; exceljs gives them as UTC.
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const f = (fmt ?? '').toLowerCase();
  if (f.includes('mmm'))
    return `${day}-${MON[mon]}-${f.includes('yyyy') ? year : String(year).slice(2)}`;
  return `${day}/${String(mon + 1).padStart(2, '0')}/${year}`;
}

function cellStyle(cell: Cell): CSSProperties {
  const st: CSSProperties = {};
  const { font, fill, alignment, border } = cell;
  if (font) {
    if (font.bold) st.fontWeight = 700;
    if (font.italic) st.fontStyle = 'italic';
    if (font.underline) st.textDecoration = 'underline';
    if (font.size) st.fontSize = `${Math.round((font.size * 4) / 3)}px`;
    const color = argb(font.color?.argb);
    if (color) st.color = color;
  }
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argb(fill.fgColor?.argb);
    if (bg) st.background = bg;
  }
  if (alignment) {
    const h = alignment.horizontal;
    if (h)
      st.textAlign =
        h === 'centerContinuous' ? 'center' : h === 'fill' || h === 'distributed' ? 'justify' : h;
    const v = alignment.vertical;
    if (v) st.verticalAlign = v === 'justify' || v === 'distributed' ? 'middle' : v;
    if (alignment.wrapText) st.whiteSpace = 'pre-wrap';
  }
  if (!st.textAlign && typeof cell.value === 'number') st.textAlign = 'right';
  if (border) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const b = border[side];
      if (b?.style) {
        const w = b.style === 'medium' || b.style === 'thick' ? 2 : 1;
        const kind = b.style.includes('dash')
          ? 'dashed'
          : b.style === 'dotted'
            ? 'dotted'
            : 'solid';
        const prop = `border${side[0]!.toUpperCase()}${side.slice(1)}` as 'borderTop';
        st[prop] = `${w}px ${kind} ${argb(b.color?.argb) ?? '#000'}`;
      }
    }
  }
  return st;
}

/** "FF1F4E79" → "#1F4E79" (alpha dropped); theme/indexed colours fall back to defaults. */
function argb(v: string | undefined): string | undefined {
  return v && /^[0-9a-f]{8}$/i.test(v) ? `#${v.slice(2)}` : undefined;
}

function addr(a: string): [number, number] {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a);
  if (!m) return [0, 0];
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]), col];
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
