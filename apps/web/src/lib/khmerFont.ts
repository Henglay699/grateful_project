import khmerFont from '@fontsource/khmer/files/khmer-khmer-400-normal.woff2';

// Google's "Khmer" font, self-hosted (the CSP blocks Google Fonts). Registered for Khmer
// characters only, so it sits first in --font-main and English keeps Helvetica. Only
// downloaded when a page actually shows Khmer text.
if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
  document.fonts.add(
    new FontFace('GS Khmer', `url(${khmerFont}) format('woff2')`, {
      unicodeRange: 'U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC',
      display: 'swap',
    }),
  );
}
