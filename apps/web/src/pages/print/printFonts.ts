import moul from '@fontsource/moul/files/moul-khmer-400-normal.woff2';
import siemreap from '@fontsource/siemreap/files/siemreap-khmer-400-normal.woff2';

// The faces of the accounting engine's tax invoice / disbursement: Moul for the Khmer titles
// and customer name, Siemreap for the Khmer body text. Self-hosted (the CSP blocks Google
// Fonts) and registered for Khmer characters only; an installed "Khmer OS Muol Light" /
// "Khmer OS Siemreap" (as on the Excel sheets) is used first when the computer has it.
const KHMER = 'U+1780-17FF, U+19E0-19FF, U+200B-200D, U+25CC';

/**
 * Registers the faces in a document. Script-added fonts aren't in the page's stylesheets, so
 * a print frame (Credit Noted / Record Summary "Print" and "PDF File") needs its own copy.
 */
export function addPrintFonts(doc: Document): FontFace[] {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win || typeof win.FontFace === 'undefined' || !doc.fonts) return [];
  return (
    [
      ['GS Moul', moul],
      ['GS Siemreap', siemreap],
    ] as const
  ).map(([family, url]) => {
    const face = new win.FontFace(
      family,
      `url(${new URL(url, window.location.href).href}) format('woff2')`,
      { unicodeRange: KHMER, display: 'swap' },
    );
    doc.fonts.add(face);
    return face;
  });
}

if (typeof document !== 'undefined') addPrintFonts(document);
