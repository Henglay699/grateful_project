import type { MouseEvent, ReactNode } from 'react';
import { printInPlace } from '../lib/printInPlace';

/**
 * A Print button: a click opens the print dialog right here; Ctrl/⌘/Shift/middle-click still
 * opens the printable page in a new tab.
 */
export function PrintLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string | undefined;
  title?: string;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    printInPlace(href);
  };
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
