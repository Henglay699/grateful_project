import { clsx, type ClassValue } from 'clsx';

/** Joins class names. Bklit uses tailwind-merge here; this app has no Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
