const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-08-25" → "25-AUG-26" (the prototype's date style). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${MON[Number(m) - 1]}-${y.slice(2)}`;
}

/** Numbers with thousands separators; trailing zeros of NUMERIC strings removed. */
export function fmtNum(v: string | number | null | undefined, maxDecimals = 3): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

export function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Byte count → "512 B", "84 KB", "6.4 MB". */
export function fmtFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtPct(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  return `${Math.round(Number(v) * 100)}%`;
}
