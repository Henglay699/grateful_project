import { useState } from 'react';
import { icons } from '../layout/icons';
import s from './InlineName.module.css';

/**
 * A name in a table cell that can be renamed in place: click (or Enter) to edit,
 * Enter / click away to save, Esc to cancel. Read-only when `onSave` is missing.
 */
export function InlineName({
  value,
  label,
  onSave,
}: {
  value: string;
  /** What is being named, for screen readers ("Port name"). */
  label: string;
  onSave?: ((next: string) => void) | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (!onSave) return <span className={s.text}>{value}</span>;

  if (draft !== null) {
    const commit = () => {
      const next = draft.trim();
      setDraft(null);
      if (next.length >= 2 && next !== value) onSave(next);
    };
    return (
      <input
        className={s.input}
        value={draft}
        autoFocus
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={s.name}
      onClick={() => setDraft(value)}
      title={`Rename ${value}`}
    >
      <span className={s.text}>{value}</span>
      <span className={s.pencil} aria-hidden="true">
        {icons.edit({})}
      </span>
    </button>
  );
}
