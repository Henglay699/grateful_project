import { useEffect, useId, useMemo, useRef, useState } from 'react';
import 'country-flag-icons/3x2/flags.css';
import s from './CountrySelect.module.css';

export interface CountryOption {
  iso2: string;
  name: string;
}

/** A country's flag (SVG, so it shows on Windows too, where flag emoji don't). */
export function Flag({ iso2 }: { iso2: string }) {
  return <span className={`${s.flag} flag:${iso2.toUpperCase()}`} aria-hidden="true" />;
}

/**
 * A country dropdown with each country's flag on the left and type-to-search (by name or
 * ISO code). Keyboard: ↑ ↓ to move, Enter to pick, Esc to close.
 */
export function CountrySelect({
  id,
  value,
  onChange,
  onBlur,
  countries,
  placeholder = 'Select country',
  invalid,
  disabled,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (iso2: string) => void;
  onBlur?: () => void;
  countries: CountryOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Opens upward when there's no room below (the sticky action bar sits at the bottom).
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = countries.find((c) => c.iso2 === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    const hits = countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.iso2.toLowerCase() === q,
    );
    // Names starting with the text first: "ca" → Cambodia, Canada… before Africa.
    return hits.sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)),
    );
  }, [countries, query]);

  const show = (initial = '') => {
    if (disabled) return;
    const r = trigger.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 340 && r.top > 340);
    setQuery(initial);
    setActive(Math.max(0, initial ? 0 : countries.findIndex((c) => c.iso2 === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (c: CountryOption | undefined) => {
    if (!c) return;
    onChange(c.iso2);
    close();
  };

  // Close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, onBlur]);

  // Keep the highlighted country in view.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  return (
    <div className={s.wrap} ref={wrap}>
      <button
        type="button"
        id={id}
        ref={trigger}
        className={`form-select-box ${s.trigger}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onBlur={() => !open && onBlur?.()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
            // Typing on the closed field starts a search.
            e.preventDefault();
            show(e.key);
          }
        }}
      >
        {selected ? (
          <>
            <Flag iso2={selected.iso2} />
            <span className={s.name}>{selected.name}</span>
          </>
        ) : (
          <span className={s.placeholder}>{placeholder}</span>
        )}
      </button>
      {open && (
        <div className={s.pop} data-up={up || undefined}>
          <input
            className={s.search}
            autoFocus
            placeholder="Search country…"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${shown[active].iso2}` : undefined}
            aria-label="Search country"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(shown[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'Tab') {
                close(false);
                onBlur?.();
              }
            }}
          />
          <ul className={s.list} id={listId} role="listbox" ref={list} aria-label="Countries">
            {shown.map((c, i) => (
              <li
                key={c.iso2}
                id={`${listId}-${c.iso2}`}
                role="option"
                aria-selected={c.iso2 === value}
                data-active={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                // mousedown, so the search box keeps focus until the pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
              >
                <Flag iso2={c.iso2} />
                <span className={s.name}>{c.name}</span>
                <span className={s.code}>{c.iso2}</span>
              </li>
            ))}
            {shown.length === 0 && <li className={s.none}>No country matches “{query}”</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
