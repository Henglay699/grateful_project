import { useEffect, useRef, useState } from 'react';
import type { ShipmentStatus } from '@gs/shared';
import type { PlanColumn } from './columns';

export interface PlansFilterValue {
  status: '' | ShipmentStatus;
  expandAll: boolean;
  frozen: string[];
}

/** The prototype's "Filter Shipments" dropdown (client, month and Import/Export sit in the toolbar). */
export function PlansFilter({
  value,
  onApply,
  columnsFor,
}: {
  value: PlansFilterValue;
  onApply: (v: PlansFilterValue) => void;
  columnsFor: (expandAll: boolean) => PlanColumn[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(value), [value, open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = (value.status ? 1 : 0) + (value.expandAll ? 1 : 0) + (value.frozen.length ? 1 : 0);
  const hint = value.status ? value.status.replace('_', ' ').toLowerCase() : 'All shipments';

  return (
    <div className={`card-dropdown filter-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button
        className={`filter-btn${count ? ' active' : ''}`}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
        <span className="filter-count" style={count ? { display: 'inline-flex' } : undefined}>
          {count}
        </span>
      </button>
      <div className="filter-dropdown-menu" role="dialog" aria-label="Filter shipments">
        <div className="filter-menu-header">
          <div className="filter-menu-title">Filter Shipments</div>
          <button
            type="button"
            className="filter-menu-close"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="filter-menu-body">
          <div className="filter-section">
            <div className="filter-col">
              <div className="filter-col-title">
                <span>Status</span>
              </div>
              <div className="filter-seg-group">
                {(
                  [
                    ['', 'All Shipment'],
                    ['COMPLETED', 'Completed'],
                    ['IN_PROGRESS', 'In Progress'],
                    ['PENDING', 'Pending'],
                  ] as const
                ).map(([v, l]) => (
                  <label className="filter-seg-item" key={v}>
                    <input
                      type="radio"
                      name="plansStatus"
                      checked={draft.status === v}
                      onChange={() => setDraft({ ...draft, status: v })}
                    />
                    <span className="seg-dot" />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="filter-section filter-expand-row">
            <label className="filter-check-item">
              <input
                type="checkbox"
                checked={draft.expandAll}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    expandAll: e.target.checked,
                    frozen: draft.frozen.filter((k) =>
                      columnsFor(e.target.checked).some((c) => c.key === k),
                    ),
                  })
                }
              />
              <span>
                Expand All<em>Show full shipment details as extra columns</em>
              </span>
            </label>
          </div>
          <div className="filter-section">
            <div className="filter-col">
              <div className="filter-col-title">
                <span>Freeze Columns</span>
                <span className="filter-col-hint">Pin while scrolling</span>
              </div>
              <div className="filter-freeze-list">
                {columnsFor(draft.expandAll).map((c) => (
                  <label className="filter-check-item" key={c.key}>
                    <input
                      type="checkbox"
                      checked={draft.frozen.includes(c.key)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          frozen: e.target.checked
                            ? [...draft.frozen, c.key]
                            : draft.frozen.filter((k) => k !== c.key),
                        })
                      }
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <span className="filter-actions-hint">{hint}</span>
          <div className="filter-actions-buttons">
            <button
              type="button"
              className="filter-reset-btn"
              onClick={() =>
                setDraft({
                  status: '',
                  expandAll: false,
                  frozen: [],
                })
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="filter-apply-btn"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
