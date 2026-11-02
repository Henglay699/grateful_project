/** CN26-001 → "1": credit notes are shown by their sequence number, not the stored code. */
export function cnSeq(number: string | null | undefined): string {
  if (!number) return '';
  const m = /(\d+)$/.exec(number);
  return m ? String(Number(m[1])) : number;
}
