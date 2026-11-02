import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GlobalSearchResponse, SearchHitKind } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { icons, type IconName } from './icons';
import { NAV } from './nav';
import s from './GlobalSearch.module.css';

const RECENT_KEY = 'gs:recent-searches';
const RECENT_MAX = 6;

const KIND: Record<SearchHitKind, { label: string; icon: IconName }> = {
  shipment: { label: 'Shipment', icon: 'plans' },
  client: { label: 'Client', icon: 'clients' },
  'tax-invoice': { label: 'Tax Invoice', icon: 'accounting' },
  disbursement: { label: 'Disbursement', icon: 'accounting' },
  'debit-note': { label: 'Debit Note', icon: 'accounting' },
  'credit-note': { label: 'Credit Noted', icon: 'creditnote' },
  'record-summary': { label: 'Record Summary', icon: 'recordsummary' },
  quotation: { label: 'Quotation', icon: 'quotations' },
};

const history = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <polyline points="3 3 3 8 8 8" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
);

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* private window: recent searches just aren't kept */
  }
}

/** Bold the part of `text` that matches what was typed, like a browser's suggestions. */
function mark(text: string, term: string): ReactNode {
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <b>{text.slice(i, i + term.length)}</b>
      {text.slice(i + term.length)}
    </>
  );
}

interface Option {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  tag?: string;
  /** Recent searches can be removed from the list. */
  onRemove?: () => void;
  run: () => void;
}

/**
 * Top-bar search: suggestions from every record the user may open (shipments, clients,
 * billing documents, credit notes, record summaries, quotations) plus matching pages, with
 * recent searches when the box is empty. Enter without a pick searches Shipping Plans.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState(readRecent);
  const box = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Ask the server once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const typed = q.trim();
  const search = useQuery({
    queryKey: ['search', term],
    queryFn: () => api<GlobalSearchResponse>('/search', { query: { q: term } }),
    enabled: open && term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const remember = (text: string) => {
    const next = [text, ...recent.filter((x) => x.toLowerCase() !== text.toLowerCase())].slice(
      0,
      RECENT_MAX,
    );
    setRecent(next);
    writeRecent(next);
  };
  const go = (url: string, text = typed) => {
    if (text) remember(text);
    setOpen(false);
    setQ('');
    input.current?.blur();
    navigate(url);
  };
  const searchPlans = (text: string) => go(`/plans?q=${encodeURIComponent(text)}`, text);

  const options = useMemo<Option[]>(() => {
    if (!typed) {
      return recent.map((r) => ({
        key: `recent:${r}`,
        icon: history,
        title: r,
        onRemove: () => {
          const next = recent.filter((x) => x !== r);
          setRecent(next);
          writeRecent(next);
        },
        run: () => {
          setQ(r);
          input.current?.focus();
        },
      }));
    }
    const lower = typed.toLowerCase();
    const pages: Option[] = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]))
      .filter((i) => can(i.permission) && i.label.toLowerCase().includes(lower))
      .slice(0, 3)
      .map((i) => ({
        key: `page:${i.to}`,
        icon: icons[i.icon]({ width: 16, height: 16 }),
        title: mark(i.label, typed),
        subtitle: 'Go to page',
        tag: 'Page',
        run: () => go(i.to, ''),
      }));
    // Only show server hits for what's in the box now, not a stale earlier term.
    const fresh = term === typed ? (search.data?.hits ?? []) : [];
    const hits: Option[] = fresh.map((h) => ({
      key: `${h.kind}:${h.id}`,
      icon: icons[KIND[h.kind].icon]({ width: 16, height: 16 }),
      title: mark(h.title, typed),
      subtitle: h.subtitle ? mark(h.subtitle, typed) : undefined,
      tag: KIND[h.kind].label,
      run: () => go(h.url),
    }));
    const all: Option[] = can('shipments:read')
      ? [
          {
            key: 'all',
            icon: icons.search({ width: 16, height: 16 }),
            title: (
              <>
                Search Shipping Plans for “<b>{typed}</b>”
              </>
            ),
            run: () => searchPlans(typed),
          },
        ]
      : [];
    return [...hits, ...pages, ...all];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, term, search.data, recent, can]);

  useEffect(() => setActive(-1), [typed, search.data]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      if (!n) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
    }
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const picked = options[active];
    if (picked) picked.run();
    else if (typed && can('shipments:read')) searchPlans(typed);
  };

  const loading = typed.length >= 2 && (term !== typed || search.isFetching);
  const show = open && (options.length > 0 || loading || (typed.length >= 2 && !!search.data));
  const empty = typed.length >= 2 && !loading && term === typed && !search.data?.hits.length;
  return (
    <form
      className={`search-box ${s.box}${show ? ` ${s.boxOpen}` : ''}`}
      role="search"
      onSubmit={onSubmit}
      ref={box}
    >
      <input
        ref={input}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search invoices, containers, clients, documents…"
        aria-label="Search everything"
        role="combobox"
        aria-expanded={show}
        aria-controls="global-search-list"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `gs-opt-${active}` : undefined}
        autoComplete="off"
      />
      {icons.search({})}
      {show && (
        <div className={s.panel}>
          {!typed && <div className={s.head}>Recent searches</div>}
          {empty && <div className={s.note}>No matching records. Try another number or name.</div>}
          <ul id="global-search-list" role="listbox" className={s.list}>
            {options.map((o, i) => (
              <li
                key={o.key}
                id={`gs-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`${s.option}${i === active ? ` ${s.active}` : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={o.run}
              >
                <span className={s.icon}>{o.icon}</span>
                <span className={s.text}>
                  <span className={s.title}>{o.title}</span>
                  {o.subtitle && <span className={s.subtitle}>{o.subtitle}</span>}
                </span>
                {o.tag && <span className={s.tag}>{o.tag}</span>}
                {o.onRemove && (
                  <button
                    type="button"
                    className={s.remove}
                    aria-label={`Remove “${String(o.title)}” from recent searches`}
                    onClick={(e) => {
                      e.stopPropagation();
                      o.onRemove!();
                    }}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {loading && <div className={s.note}>Searching…</div>}
        </div>
      )}
    </form>
  );
}
