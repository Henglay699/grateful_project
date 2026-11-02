import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ErrorBanner } from '../../components/ui';
import cs from '../../components/CountrySelect.module.css';
import s from './AddNewSelect.module.css';

type Option = { value: string; label: string };
const ADD = '__add__';

/**
 * A dropdown with type-to-search (as the country picker) and a "+ Add new…" row that opens the
 * prototype's small add-new modal, pre-filled with what was typed. With `addFirst` the add row
 * is first, "+ Add New", as in the MoC CO system's lists. Keyboard: ↑ ↓, Enter, Esc.
 */
export function AddNewSelect({
  id,
  label,
  options,
  value,
  onChange,
  onBlur,
  onCreate,
  placeholder,
  addFirst = false,
}: {
  id: string;
  label: string;
  options: Option[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onCreate?: ((name: string) => Promise<string>) | undefined;
  placeholder: string;
  addFirst?: boolean;
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
  // The one just added shows by name until the refreshed list arrives.
  const [created, setCreated] = useState<Option | null>(null);
  const selected =
    options.find((o) => o.value === value) ?? (created?.value === value ? created : undefined);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // The rows shown: matches (those starting with the text first), plus the add row.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? options
          .filter((o) => o.label.toLowerCase().includes(q))
          .sort(
            (a, b) =>
              Number(!a.label.toLowerCase().startsWith(q)) -
              Number(!b.label.toLowerCase().startsWith(q)),
          )
      : options;
    if (!onCreate) return hits;
    const add = { value: ADD, label: '' };
    return addFirst ? [add, ...hits] : [...hits, add];
  }, [options, query, onCreate, addFirst]);

  const show = (initial = '') => {
    const r = trigger.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 340 && r.top > 340);
    setQuery(initial);
    const at = rows.findIndex((o) => o.value === value);
    setActive(initial ? 0 : Math.max(0, at));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (o: Option | undefined) => {
    if (!o) return;
    if (o.value === ADD) {
      setName(query.trim());
      setError(null);
      setAdding(true);
      setOpen(false);
      return;
    }
    onChange(o.value);
    close();
  };

  const save = async () => {
    if (!onCreate || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const newId = await onCreate(name.trim());
      setCreated({ value: newId, label: name.trim() });
      onChange(newId);
      setAdding(false);
      setName('');
      trigger.current?.focus();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
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

  // Keep the highlighted row in view.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const addText = query.trim()
    ? `+ Add “${query.trim()}”`
    : addFirst
      ? '+ Add New'
      : `+ Add new ${label.toLowerCase()}…`;

  return (
    <div className={cs.wrap} ref={wrap}>
      <button
        type="button"
        id={id}
        ref={trigger}
        className={`form-select-box ${cs.trigger}`}
        aria-haspopup="listbox"
        aria-expanded={open}
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
          <span className={s.label}>{selected.label}</span>
        ) : (
          <span className={cs.placeholder}>{placeholder}</span>
        )}
      </button>
      {open && (
        <div className={cs.pop} data-up={up || undefined}>
          <input
            className={cs.search}
            autoFocus
            placeholder={`Search ${label.toLowerCase()}…`}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
            aria-label={`Search ${label.toLowerCase()}`}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(rows[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'Tab') {
                close(false);
                onBlur?.();
              }
            }}
          />
          <ul className={cs.list} id={listId} role="listbox" ref={list} aria-label={label}>
            {rows.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                className={o.value === ADD ? s.add : undefined}
                aria-selected={o.value === value}
                data-active={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                // mousedown, so the search box keeps focus until the pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                <span className={s.label}>{o.value === ADD ? addText : o.label}</span>
              </li>
            ))}
            {rows.length === 0 && <li className={cs.none}>No {label.toLowerCase()} matches “{query}”</li>}
          </ul>
        </div>
      )}
      {/* Portalled to <body> so the fixed overlay covers the screen (see Modal in ui.tsx). */}
      {createPortal(
        <div
          className={`addnew-modal-overlay${adding ? ' open' : ''}`}
          onMouseDown={(e) => e.target === e.currentTarget && setAdding(false)}
        >
          {adding && (
            <div
              className="addnew-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${id}-add-title`}
            >
              <h4 id={`${id}-add-title`}>Add New {label}</h4>
              <p>Enter a {label.toLowerCase()} name to add it to the list.</p>
              <ErrorBanner error={error} />
              <input
                type="text"
                autoFocus
                value={name}
                placeholder={`e.g. ${label} name`}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                  if (e.key === 'Escape') setAdding(false);
                }}
              />
              <div className="addnew-modal-actions">
                <button
                  type="button"
                  className="addnew-modal-cancel"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="addnew-modal-save"
                  disabled={busy || name.trim().length < 2}
                  onClick={() => void save()}
                >
                  {busy ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
