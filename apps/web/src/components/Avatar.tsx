import { useState } from 'react';
import s from './Avatar.module.css';

/** "Aden Whitfield" → "AW". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** Calm tints for the initials fallback; the same name always gets the same one. */
const TONES = ['cyan', 'sky', 'blue', 'teal', 'indigo', 'slate'] as const;
const toneFor = (name: string) =>
  TONES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

/**
 * Round profile picture, or the person's initials when they have none (or it fails to load).
 * Decorative: the name always sits next to it, so the image has empty alt text.
 */
export function Avatar({
  name,
  src,
  size = 36,
  muted = false,
}: {
  name: string;
  src: string | null | undefined;
  size?: number;
  muted?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={s.avatar}
      data-tone={toneFor(name)}
      data-muted={muted || undefined}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
