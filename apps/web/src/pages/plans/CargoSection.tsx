import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import {
  CUT_STOCK_CATEGORIES,
  CUT_STOCK_CATEGORY_LABEL,
  invoiceHtsCodes,
  type CargoExcelParseResult,
  type CutStockRow,
  type ImportCargoExcelParseResult,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCutStock } from '../../features/hooks';
import { downloadFile, uploadFile } from '../../lib/files';
import { ApiError } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { icons } from '../../layout/icons';
import c from './CargoSection.module.css';
import { fi } from './formIcons';
import { blankInvoice, blankLine, toNum, type FormValues, type InvoiceValues } from './formModel';

const CHEVRON = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** The invoice's HTS codes (one invoice = one code; more than one is flagged). */
const htsCodesOf = (lines: InvoiceValues['lines'] | undefined) => invoiceHtsCodes(lines ?? []);

export type MenuAction = {
  label: string;
  icon: React.ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  title?: string | undefined;
  danger?: boolean;
  /** Starts a new group: a thin line above it (not before the first item). */
  separated?: boolean;
};

/**
 * A ⋯ button and its menu of actions. The menu is fixed to the viewport so a scroll box (the
 * line table's) can't clip it.
 */
export function DotsMenu({
  label,
  actions,
  className = c.dotsBtn,
}: {
  label: string;
  actions: MenuAction[];
  className?: string;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const inside = (t: EventTarget | null) =>
      box.current?.contains(t as Node) || menu.current?.contains(t as Node);
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside(e.target)) setPos(null);
    };
    const shut = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
    };
  }, [pos]);
  const toggle = (ev: React.MouseEvent<HTMLButtonElement>) => {
    if (pos) return setPos(null);
    const r = ev.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const pick = (fn: () => void) => () => {
    setPos(null);
    fn();
  };
  return (
    <div className={c.menuWrap} ref={box}>
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={toggle}
      >
        {icons.dots({ width: 16, height: 16 })}
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className={c.menu} role="menu" style={{ top: pos.top, right: pos.right }}>
            {actions.map((a, i) => (
              <Fragment key={a.label}>
                {a.separated && i > 0 && <div className={c.menuSep} role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={a.danger ? `${c.menuItem} ${c.menuDanger}` : c.menuItem}
                  disabled={a.disabled || !a.onClick}
                  title={a.title}
                  onClick={a.onClick && pick(a.onClick)}
                >
                  {a.icon}
                  {a.label}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A description row's ⋯ menu: add a line to that description, or remove it with its lines. */
function DescMenu({ onAddLine, onRemove }: { onAddLine: () => void; onRemove?: () => void }) {
  return (
    <DotsMenu
      label="Description actions"
      actions={[
        { label: 'Add Line', icon: fi.plus({}), onClick: onAddLine },
        {
          label: 'Remove Description',
          icon: fi.trash({}),
          onClick: onRemove,
          danger: true,
          title: onRemove ? undefined : 'An invoice needs at least one description',
        },
      ]}
    />
  );
}

/** CDC numbers compare without case, spaces or dashes ("II-125" = "ii 125"), as on the server. */
const cdcKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s\-–—_]+/g, '');

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Cargo, Pricing & FOB" — one row per invoice; open a row for its line items (prototype layout). */
export function CargoSection({ shipmentId }: { shipmentId?: string | undefined }) {
  const {
    control,
    register,
    setValue,
    getValues,
    formState: { errors, defaultValues },
  } = useFormContext<FormValues>();
  const invoices = useFieldArray({ control, name: 'invoices' });
  const watched = useWatch({ control, name: 'invoices' });
  // Imports follow the import schedule: CDC items instead of PO / style / HTS.
  const isImport = useWatch({ control, name: 'direction' }) === 'IMPORT';
  const clientId = useWatch({ control, name: 'clientId' });
  const cut = useCutStock({ clientId, pageSize: 500, sort: 'lineNo' }, isImport && !!clientId);
  const cdcItems = cut.data?.data ?? [];
  // Each import item's PCS come off its master-list balance. The balance already excludes this
  // shipment's saved items (saving replaces them), so those are added back before the form's.
  const remainingAfter = new Map<string, number>();
  if (isImport) {
    const byKey = new Map(cdcItems.map((it) => [cdcKey(it.declareRef), it]));
    const add = (cdcNo: string | null | undefined, qty: number) => {
      const it = cdcNo ? byKey.get(cdcKey(cdcNo)) : undefined;
      if (it) remainingAfter.set(it.id, (remainingAfter.get(it.id) ?? Number(it.balance)) + qty);
    };
    defaultValues?.invoices?.forEach((inv) =>
      inv?.lines?.forEach((l) => add(l?.cdcNo, toNum(l?.pcs))),
    );
    watched?.forEach((inv) => inv.lines?.forEach((l) => add(l.cdcNo, -toNum(l.pcs))));
  }
  // Every invoice starts folded: the user opens the one they need ("+ Add Invoice" opens the new one).
  const [openIdx, setOpenIdx] = useState<Set<number>>(() => new Set());
  const [status, setStatus] = useState<{
    text: string;
    warnings: CargoExcelParseResult['warnings'];
    /** The upload was refused: the list shows why. */
    error?: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (i: number) =>
    setOpenIdx((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const allOpen = invoices.fields.length > 0 && invoices.fields.every((_, i) => openIdx.has(i));

  // All invoices of a shipment share one invoice date (prototype rule).
  const setSharedDate = (date: string) =>
    (getValues('invoices') ?? []).forEach((_, i) =>
      setValue(`invoices.${i}.invoiceDate`, date, { shouldDirty: true }),
    );

  const onExcel = async (file: File) => {
    setUploading(true);
    setStatus(null);
    try {
      // Imports use the import schedule layout; each ITEM is matched to the client's master list.
      const res = isImport
        ? await uploadFile<ImportCargoExcelParseResult>(
            '/shipments/parse-import-cargo-excel',
            file,
            { clientId, shipmentId },
          )
        : await uploadFile<CargoExcelParseResult>('/shipments/parse-cargo-excel', file, {
            shipmentId,
          });
      const errs = 'errors' in res ? res.errors : [];
      if (errs.length) {
        // Nothing is filled in until every row matches the CDC master list.
        setStatus({
          text: `Nothing imported from ${file.name}: fix ${errs.length === 1 ? 'this row' : `these ${errs.length} rows`} and upload it again.`,
          warnings: errs,
          error: true,
        });
        return;
      }
      const current = getValues('invoices') ?? [];
      const blank = current.every(
        (i) => !i.invoiceNo && i.lines.every((l) => !l.pcs && !l.poNo && !l.styleNo && !l.cdcNo),
      );
      const imported: InvoiceValues[] = isImport
        ? (res as ImportCargoExcelParseResult).invoices.map((i) => ({
            ...blankInvoice(i.invoiceDate ?? ''),
            invoiceNo: i.invoiceNo,
            lines: i.lines.map((l) => ({
              ...blankLine(),
              cdcNo: l.cdcNo ?? '',
              description: l.description ?? '',
              material: l.material ?? '',
              unit: l.unit ?? '',
              pcs: l.pcs,
              netWeightKg: l.netWeightKg,
              grossWeightKg: l.grossWeightKg,
              fobUnitPrice: l.fobUnitPrice,
            })),
          }))
        : (res as CargoExcelParseResult).invoices.map((i) => ({
            invoiceNo: i.invoiceNo,
            invoiceDate: i.invoiceDate ?? '',
            description: i.description ?? '',
            lines: i.lines.map((l) => ({
              ...l,
              poNo: l.poNo ?? '',
              styleNo: l.styleNo ?? '',
              htsCode: l.htsCode ?? '',
              description: l.description ?? '',
            })),
          }));
      if (blank) invoices.replace(imported);
      else invoices.append(imported);
      setOpenIdx(new Set());
      const lines = res.invoices.reduce((n, i) => n + i.lines.length, 0);
      const noun = isImport ? 'item' : 'line';
      setStatus({
        text: `Imported ${res.invoices.length} invoice${res.invoices.length === 1 ? '' : 's'}, ${lines} ${noun}${lines === 1 ? '' : 's'} from ${file.name}`,
        warnings: res.warnings,
      });
    } catch (e) {
      setStatus({
        text: e instanceof ApiError ? e.message : 'The file could not be read.',
        warnings: [],
        error: true,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const totals = (watched ?? []).reduce(
    (t, inv) => {
      inv.lines.forEach((l) => {
        t.ctns += toNum(l.ctns);
        t.pcs += toNum(l.pcs);
        t.nw += toNum(l.netWeightKg);
        t.gw += toNum(l.grossWeightKg);
        t.cbm += toNum(l.cbm);
        t.fob += toNum(l.pcs) * toNum(l.fobUnitPrice);
      });
      return t;
    },
    { ctns: 0, pcs: 0, nw: 0, gw: 0, cbm: 0, fob: 0 },
  );
  const invErr = errors.invoices;

  return (
    <>
      <div className="cx-card">
        <div className="cx-card-head">
          <div className="cx-title">
            <span className="cx-title-icon">{fi.dollar({ width: 18, height: 18 })}</span>
            <h3>{isImport ? 'Cargo Invoices & CDC Items' : 'Cargo, Pricing & FOB'}</h3>
          </div>
          <div className="cargo-actions">
            {status && (
              <span
                className="cargo-status"
                style={status.error ? { color: 'var(--status-exception-fg)' } : undefined}
              >
                {status.text}
              </span>
            )}
            {uploading && <span className="cargo-status">Reading…</span>}
            <button
              type="button"
              className="cargo-btn"
              onClick={() =>
                setOpenIdx(allOpen ? new Set() : new Set(invoices.fields.map((_, i) => i)))
              }
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
            <button
              type="button"
              className="cargo-btn cargo-btn-primary"
              onClick={() => {
                invoices.append(blankInvoice(getValues('invoices.0.invoiceDate') ?? ''));
                setOpenIdx((s) => new Set(s).add(invoices.fields.length));
              }}
            >
              + Add Invoice
            </button>
            {/* The Excel template: download it, fill it in, upload it. Imports have their own
                template, listing the client's CDC master list. */}
            <DotsMenu
              label="Excel template"
              className={`cargo-btn ${c.dotsToolbar}`}
              actions={[
                {
                  label: 'Download Template',
                  icon: icons.download({}),
                  disabled: isImport && !clientId,
                  title: isImport && !clientId ? 'Choose the client first' : undefined,
                  onClick: () =>
                    void (
                      isImport
                        ? downloadFile('/shipments/import-cargo-template.xlsx', { clientId })
                        : downloadFile('/shipments/cargo-template.xlsx')
                    ).catch(() =>
                      setStatus({ text: 'The template could not be downloaded.', warnings: [] }),
                    ),
                },
                {
                  label: 'Upload Excel Template',
                  icon: icons.upload({}),
                  disabled: uploading || (isImport && !clientId),
                  title: isImport && !clientId ? 'Choose the client first' : undefined,
                  onClick: () => fileRef.current?.click(),
                },
              ]}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              hidden
              onChange={(e) => e.target.files?.[0] && void onExcel(e.target.files[0])}
            />
          </div>
        </div>
        {status?.warnings.length ? (
          <ul
            style={{
              margin: '0 0 12px 18px',
              fontSize: 12,
              color: status.error ? 'var(--status-exception-fg)' : 'var(--status-pending-fg)',
              fontWeight: 600,
            }}
          >
            {status.warnings.slice(0, status.error ? 50 : 8).map((w, i) => (
              <li key={i}>
                {w.row ? `Row ${w.row}: ` : ''}
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
        {typeof invErr?.message === 'string' && <FieldError message={invErr.message} />}
        <div className="cargo-list">
          <div className="cargo-list-inner">
            <div className="cargo-head">
              <div className="cargo-head-cell">Invoice No</div>
              <div className="cargo-head-cell">Inv Date</div>
              <div className="cargo-head-cell cargo-r">PCS</div>
              <div className="cargo-head-cell cargo-r">CTNS</div>
              <div className="cargo-head-cell cargo-r">Total FOB</div>
              <div className="cargo-head-cell">Description</div>
              <div className="cargo-head-cell" />
            </div>
            <div className="cargo-invoices">
              {invoices.fields.map((f, gi) =>
                isImport ? (
                  <ImportInvoiceCard
                    key={f.id}
                    gi={gi}
                    control={control}
                    open={openIdx.has(gi)}
                    onToggle={() => toggle(gi)}
                    onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                    register={register}
                    onDate={setSharedDate}
                    cdcItems={cdcItems}
                    remainingAfter={remainingAfter}
                    errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                  />
                ) : (
                  <InvoiceCard
                    key={f.id}
                    gi={gi}
                    control={control}
                    open={openIdx.has(gi)}
                    onToggle={() => toggle(gi)}
                    onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                    register={register}
                    onDate={setSharedDate}
                    errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
      {isImport ? (
        <div className="cargo-totals cargo-totals-import">
          <div className="cargo-totals-label">Shipment Total</div>
          <div className="cargo-total-item">
            <span>Quantity</span>
            <span>{fmtNum(totals.pcs, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Net Wt (kg)</span>
            <span>{fmtNum(totals.nw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Gross Wt (kg)</span>
            <span>{fmtNum(totals.gw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Items</span>
            <span>{fmtNum((watched ?? []).reduce((n, i) => n + i.lines.length, 0))}</span>
          </div>
          <div className="cargo-total-item cargo-total-fob">
            <span>Amount</span>
            <span>{money(totals.fob)} USD</span>
          </div>
        </div>
      ) : (
        <div className="cargo-totals">
          <div className="cargo-totals-label">Shipment Total</div>
          <div className="cargo-total-item">
            <span>CTNS</span>
            <span>{fmtNum(totals.ctns)}</span>
          </div>
          <div className="cargo-total-item">
            <span>PCS</span>
            <span>{fmtNum(totals.pcs)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Net Wt (kg)</span>
            <span>{fmtNum(totals.nw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Gross Wt (kg)</span>
            <span>{fmtNum(totals.gw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>CBM</span>
            <span>{fmtNum(totals.cbm)}</span>
          </div>
          <div className="cargo-total-item cargo-total-fob">
            <span>Total FOB</span>
            <span>{money(totals.fob)} USD</span>
          </div>
        </div>
      )}
    </>
  );
}

type InvErrors =
  | {
      invoiceNo?: { message?: string };
      htsCode?: { message?: string };
      lines?: { message?: string } | Record<number, Record<string, { message?: string }>>;
    }
  | undefined;

/**
 * An invoice card's head: the arrow, the invoice and how many lines it has. A click anywhere
 * on it (but Remove) opens or closes its lines. Export and import invoices share it.
 */
function InvoiceHead({
  gi,
  open,
  onToggle,
  onRemove,
  count,
  fields,
}: {
  gi: number;
  open: boolean;
  onToggle: () => void;
  onRemove: (() => void) | undefined;
  count: string;
  /** Fields typed on the head's own line (Import: invoice no. and date). */
  fields?: React.ReactNode;
}) {
  return (
    <div
      className={c.head}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      title={open ? 'Hide line items' : 'Show line items'}
      onClick={(ev) => !(ev.target as HTMLElement).closest('button, label, input') && onToggle()}
      onKeyDown={(ev) => {
        if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
        ev.preventDefault();
        onToggle();
      }}
    >
      <span className={c.toggle} aria-hidden="true">
        {CHEVRON}
      </span>
      <span className={c.headIcon}>{fi.file({})}</span>
      <b className={c.headTitle}>Invoice {gi + 1}</b>
      {fields}
      <span className={c.tags}>
        <span className={c.tag}>{count}</span>
      </span>
      {onRemove && (
        <button
          type="button"
          className={c.removeBtn}
          aria-label={`Remove invoice ${gi + 1}`}
          onClick={onRemove}
        >
          {fi.trash({})}
          Remove Invoice
        </button>
      )}
    </div>
  );
}

function InvoiceCard({
  gi,
  control,
  open,
  onToggle,
  onRemove,
  register,
  onDate,
  errors,
}: {
  gi: number;
  control: Control<FormValues>;
  open: boolean;
  onToggle: () => void;
  onRemove: (() => void) | undefined;
  register: ReturnType<typeof useFormContext<FormValues>>['register'];
  onDate: (d: string) => void;
  errors: unknown;
}) {
  const { setValue, getValues } = useFormContext<FormValues>();
  const lines = useFieldArray({ control, name: `invoices.${gi}.lines` });
  const watchedLines = useWatch({ control, name: `invoices.${gi}.lines` });
  const invDesc = useWatch({ control, name: `invoices.${gi}.description` }) ?? '';

  // Lines are grouped under descriptions. A group starts at a line whose (stable) field id
  // is in `starts`, seeded from where the saved descriptions change.
  const [starts, setStarts] = useState<Set<string>>(() => {
    const saved = getValues(`invoices.${gi}.lines`) ?? [];
    return new Set(
      lines.fields
        .filter(
          (_, i) => i === 0 || (saved[i]?.description ?? '') !== (saved[i - 1]?.description ?? ''),
        )
        .map((f) => f.id),
    );
  });
  const newGroup = useRef(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // "+ Add Description" appends a line; once it has an id, make it start a new group.
  useEffect(() => {
    if (!newGroup.current) return;
    newGroup.current = false;
    const last = lines.fields.at(-1);
    if (!last) return;
    setStarts((s) => new Set(s).add(last.id));
    setFocusId(last.id);
  }, [lines.fields]);
  const groups: { start: number; idx: number[] }[] = [];
  lines.fields.forEach((f, i) => {
    if (i === 0 || starts.has(f.id)) groups.push({ start: i, idx: [i] });
    else groups.at(-1)!.idx.push(i);
  });
  // Older invoices kept one description on the invoice only; show it on the first group.
  const descOf = (g: { start: number }) =>
    watchedLines?.[g.start]?.description || (g.start === 0 ? invDesc : '');
  const setDesc = (g: { start: number; idx: number[] }, v: string) => {
    g.idx.forEach((i) =>
      setValue(`invoices.${gi}.lines.${i}.description`, v, { shouldDirty: true }),
    );
    // The invoice's own description mirrors the first group (used on printed documents).
    if (g.start === 0) setValue(`invoices.${gi}.description`, v, { shouldDirty: true });
  };
  const blank = (description: string) => ({
    ...blankLine(),
    htsCode: htsCodesOf(getValues(`invoices.${gi}.lines`))[0] ?? '',
    description,
  });
  const addLine = () => lines.append(blank(descOf(groups.at(-1)!)));
  // A new line at the end of one description's group (the ⋯ menu on its row).
  const addLineTo = (g: { start: number; idx: number[] }) =>
    lines.insert(g.idx.at(-1)! + 1, blank(descOf(g)));
  const addDescription = () => {
    newGroup.current = true;
    lines.append(blank(''));
  };
  const removeLine = (li: number) => {
    // Removing a group's first line: the next line of that group takes over as its start.
    const id = lines.fields[li]!.id;
    const next = lines.fields[li + 1];
    if (starts.has(id) && next && !starts.has(next.id)) setStarts((s) => new Set(s).add(next.id));
    lines.remove(li);
  };
  const removeGroup = (g: { start: number; idx: number[] }) => {
    if (g.start === 0) {
      const second = groups[1];
      setValue(`invoices.${gi}.description`, second ? descOf(second) : '', {
        shouldDirty: true,
      });
    }
    lines.remove(g.idx);
  };
  const e = errors as InvErrors;
  const htsCodes = htsCodesOf(watchedLines);
  const setHts = (code: string) =>
    lines.fields.forEach((_, li) =>
      setValue(`invoices.${gi}.lines.${li}.htsCode`, code, { shouldDirty: true }),
    );
  // Invoice totals under the line items.
  type Sum = { pcs: number; ctns: number; nw: number; gw: number; cbm: number; fob: number };
  const lineSum = (watchedLines ?? []).reduce<Sum>(
    (t, l) => ({
      pcs: t.pcs + toNum(l.pcs),
      ctns: t.ctns + toNum(l.ctns),
      nw: t.nw + toNum(l.netWeightKg),
      gw: t.gw + toNum(l.grossWeightKg),
      cbm: t.cbm + toNum(l.cbm),
      fob: t.fob + toNum(l.pcs) * toNum(l.fobUnitPrice),
    }),
    { pcs: 0, ctns: 0, nw: 0, gw: 0, cbm: 0, fob: 0 },
  );
  const lineErr = (li: number, f: string) =>
    e?.lines && !('message' in e.lines)
      ? (e.lines as Record<number, Record<string, { message?: string }>>)[li]?.[f]?.message
      : undefined;
  // A line cell: a borderless box inside the table that shows its border on hover / focus.
  const cell = (
    li: number,
    field:
      | 'poNo'
      | 'styleNo'
      | 'pcs'
      | 'ctns'
      | 'netWeightKg'
      | 'grossWeightKg'
      | 'cbm'
      | 'fobUnitPrice',
    label: string,
    ph: string,
    num = false,
  ) => (
    <td>
      {num ? (
        <NumberInput
          decimals={field === 'fobUnitPrice' ? 4 : 3}
          className={`${c.cell} ${c.num}`}
          placeholder={ph}
          aria-label={label}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      ) : (
        <input
          type="text"
          className={c.cell}
          placeholder={ph}
          aria-label={label}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      )}
    </td>
  );

  const renderLine = (li: number) => {
    const l = watchedLines?.[li];
    const total = l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
    return (
      <tr key={lines.fields[li]!.id}>
        {cell(li, 'poNo', 'PO No.', 'PO No.')}
        {cell(li, 'styleNo', 'Style', 'Style No.')}
        {cell(li, 'pcs', 'PCS', '0', true)}
        {cell(li, 'ctns', 'CTNS', '0', true)}
        {cell(li, 'netWeightKg', 'Net Wt (kg)', '0.00', true)}
        {cell(li, 'grossWeightKg', 'Gross Wt (kg)', '0.00', true)}
        {cell(li, 'cbm', 'CBM', '0.00', true)}
        {cell(li, 'fobUnitPrice', 'Unit price (USD)', '0.00', true)}
        <td className={c.lineTotal}>{total !== null ? money(total) : '—'}</td>
        <td className={c.act}>
          {lines.fields.length > 1 && (
            <button
              type="button"
              className={c.iconBtn}
              title="Remove line"
              aria-label="Remove line"
              onClick={() => removeLine(li)}
            >
              {fi.trash({})}
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className={`cargo-inv ${c.inv}${open ? ' open' : ''}`}>
      <InvoiceHead
        gi={gi}
        open={open}
        onToggle={onToggle}
        onRemove={onRemove}
        count={`${lines.fields.length} ${lines.fields.length === 1 ? 'line' : 'lines'}`}
      />

      {/* Summary boxes: what is typed once per invoice, then the line totals. */}
      <div className={c.boxes}>
        <label className={c.box}>
          <span>Invoice No.</span>
          <input
            type="text"
            className={`${c.boxInput} ${c.strong}`}
            placeholder="Invoice No."
            {...register(`invoices.${gi}.invoiceNo`)}
            aria-invalid={!!e?.invoiceNo}
            title={e?.invoiceNo?.message}
          />
        </label>
        <label className={c.box}>
          <span>Invoice Date</span>
          <input
            type="date"
            className={c.boxInput}
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </label>
        <label className={c.box}>
          <span>HTS Code</span>
          {/* One invoice = one HTS code: shown once here and written to every line. */}
          <input
            type="text"
            className={c.boxInput}
            placeholder={htsCodes.length > 1 ? 'Choose one' : 'HTS Code'}
            value={htsCodes.length === 1 ? htsCodes[0] : ''}
            onChange={(ev) => setHts(ev.target.value)}
            aria-invalid={htsCodes.length > 1 || !!e?.htsCode}
            title={e?.htsCode?.message}
          />
        </label>
        <div className={c.box}>
          <span>N.W (KGS)</span>
          <b>{lineSum.nw ? fmtNum(lineSum.nw, 2) : '—'}</b>
        </div>
        <div className={c.box}>
          <span>G.W (KGS)</span>
          <b>{lineSum.gw ? fmtNum(lineSum.gw, 2) : '—'}</b>
        </div>
        <div className={c.box}>
          <span>PCS</span>
          <b>{lineSum.pcs ? fmtNum(lineSum.pcs) : '—'}</b>
        </div>
        <div className={c.box}>
          <span>CTNS</span>
          <b>{lineSum.ctns ? fmtNum(lineSum.ctns) : '—'}</b>
        </div>
        <div className={c.box}>
          <span>CBM</span>
          <b>{lineSum.cbm ? fmtNum(lineSum.cbm, 3) : '—'}</b>
        </div>
        <div className={`${c.box} ${c.fobBox}`}>
          <span>Total FOB</span>
          <b>{lineSum.fob ? `${money(lineSum.fob)} USD` : '—'}</b>
        </div>
      </div>
      {e?.invoiceNo?.message && (
        <div className={c.err}>
          <FieldError message={e.invoiceNo.message} />
        </div>
      )}
      {htsCodes.length > 1 && (
        <div className={c.err}>
          <FieldError
            message={`The lines have different HTS codes (${htsCodes.join(', ')}). One invoice uses one HTS code — enter it above.`}
          />
        </div>
      )}

      {/* Packaging / line items: one table, a description row above each group of lines. */}
      <div className="cargo-inv-details">
        <div className="cargo-inv-details-inner">
          <div className={c.panel}>
            <div className={c.panelTitle}>Packaging / line items</div>
            <div className={c.tableWrap}>
              <table className={c.table}>
                <thead>
                  <tr>
                    <th>PO No.</th>
                    <th>Style</th>
                    <th className={c.r}>PCS</th>
                    <th className={c.r}>CTNS</th>
                    <th className={c.r}>Net Wt (kg)</th>
                    <th className={c.r}>Gross Wt (kg)</th>
                    <th className={c.r}>CBM</th>
                    <th className={c.r}>Unit (USD)</th>
                    <th className={c.r}>Line Total (USD)</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                {groups.map((g) => {
                  const id = lines.fields[g.start]!.id;
                  return (
                    <tbody key={id}>
                      <tr className={c.descRow}>
                        <td colSpan={10}>
                          <div className={c.descInner}>
                            <span className={c.descLbl}>Description</span>
                            <input
                              type="text"
                              className={c.cell}
                              placeholder="e.g. Mens woven shorts 100 nylon"
                              aria-label="Description"
                              value={descOf(g)}
                              onChange={(ev) => setDesc(g, ev.target.value)}
                              autoFocus={focusId === id}
                            />
                            <DescMenu
                              onAddLine={() => addLineTo(g)}
                              onRemove={groups.length > 1 ? () => removeGroup(g) : undefined}
                            />
                          </div>
                        </td>
                      </tr>
                      {g.idx.map(renderLine)}
                    </tbody>
                  );
                })}
                {/* No total row: the invoice's totals are in the summary boxes above. */}
              </table>
            </div>
            <div className={c.foot}>
              {/* New line under the latest description. */}
              <button type="button" className={c.addBtn} onClick={addLine}>
                {fi.plus({})}
                Add Line
              </button>
              {/* New description row with its first line. */}
              <button type="button" className={c.addBtn} onClick={addDescription}>
                {fi.plus({})}
                Add Description
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "II. Raw Material" → "II. RAW MATERIAL", as the import schedule writes it. */
const materialOf = (it: CutStockRow) => CUT_STOCK_CATEGORY_LABEL[it.category].toUpperCase();

/**
 * An import invoice, laid out like the import schedule: INV · DATE, then one line
 * per item (CDC NO · ITEM · MATERIAL · QUANTITY · CDC UNIT · NW · GW · UNIT PRICE · AMOUNT).
 * Choosing a CDC NO from the client's master list fills in its item, material, unit and price.
 */
function ImportInvoiceCard({
  gi,
  control,
  open,
  onToggle,
  onRemove,
  register,
  onDate,
  cdcItems,
  remainingAfter,
  errors,
}: {
  gi: number;
  control: Control<FormValues>;
  open: boolean;
  onToggle: () => void;
  onRemove: (() => void) | undefined;
  register: ReturnType<typeof useFormContext<FormValues>>['register'];
  onDate: (d: string) => void;
  cdcItems: CutStockRow[];
  remainingAfter: Map<string, number>;
  errors: unknown;
}) {
  const { setValue, getValues } = useFormContext<FormValues>();
  const { can } = useAuth();
  const lines = useFieldArray({ control, name: `invoices.${gi}.lines` });
  const watchedLines = useWatch({ control, name: `invoices.${gi}.lines` });
  const e = errors as InvErrors;
  const lineErr = (li: number, f: string) =>
    e?.lines && !('message' in e.lines)
      ? (e.lines as Record<number, Record<string, { message?: string }>>)[li]?.[f]?.message
      : undefined;

  // The item is chosen from the client's CDC master list; its CDC no., material and unit follow.
  const itemOf = (cdcNo: string | null | undefined) =>
    cdcNo ? cdcItems.find((x) => cdcKey(x.declareRef) === cdcKey(cdcNo)) : undefined;
  const pickItem = (li: number, cdcNo: string) => {
    const it = itemOf(cdcNo);
    const path = `invoices.${gi}.lines.${li}` as const;
    const opts = { shouldDirty: true };
    setValue(`${path}.cdcNo`, it?.declareRef ?? '', opts);
    setValue(`${path}.description`, it?.name ?? '', opts);
    setValue(`${path}.material`, it ? materialOf(it) : '', opts);
    setValue(`${path}.unit`, it?.unit ?? '', opts);
    if (it && !toNum(getValues(`${path}.fobUnitPrice`)))
      setValue(`${path}.fobUnitPrice`, String(Number(it.unitPrice)), opts);
  };
  /** CDC no., material and unit come from the chosen item: shown, not typed. */
  const Auto = (li: number, field: 'cdcNo' | 'material' | 'unit', label: string) => (
    <td>
      <input
        type="text"
        className={`${c.cell} ${c.auto}`}
        placeholder="—"
        aria-label={label}
        readOnly
        tabIndex={-1}
        {...register(`invoices.${gi}.lines.${li}.${field}`)}
      />
    </td>
  );
  const Num = (
    li: number,
    field: 'pcs' | 'netWeightKg' | 'grossWeightKg' | 'fobUnitPrice',
    label: string,
    ph: string,
  ) => (
    <td>
      <NumberInput
        decimals={field === 'fobUnitPrice' ? 4 : 3}
        className={`${c.cell} ${c.num}`}
        placeholder={ph}
        aria-label={label}
        {...register(`invoices.${gi}.lines.${li}.${field}`)}
        aria-invalid={!!lineErr(li, field)}
        title={lineErr(li, field)}
      />
    </td>
  );

  return (
    <div className={`cargo-inv ${c.inv}${open ? ' open' : ''}`}>
      <InvoiceHead
        gi={gi}
        open={open}
        onToggle={onToggle}
        onRemove={onRemove}
        count={`${lines.fields.length} ${lines.fields.length === 1 ? 'item' : 'items'}`}
        fields={
          // Typed once per invoice, on the head's line; the totals are in Shipment Total.
          <span className={c.headFields}>
            <label className={c.headField}>
              <span>Invoice No.</span>
              <input
                type="text"
                className={`${c.boxInput} ${c.strong}`}
                placeholder="e.g. CNQ26044"
                {...register(`invoices.${gi}.invoiceNo`)}
                aria-invalid={!!e?.invoiceNo}
                title={e?.invoiceNo?.message}
              />
            </label>
            <label className={c.headField}>
              <span>Invoice Date</span>
              <input
                type="date"
                className={c.boxInput}
                {...register(`invoices.${gi}.invoiceDate`, {
                  onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
                })}
              />
            </label>
          </span>
        }
      />
      {e?.invoiceNo?.message && (
        <div className={c.err}>
          <FieldError message={e.invoiceNo.message} />
        </div>
      )}

      {/* Items, as on the import schedule: one row each. */}
      <div className="cargo-inv-details">
        <div className="cargo-inv-details-inner">
          <div className={c.panel}>
            <div className={c.panelTitle}>Items</div>
            <div className={c.tableWrap}>
              <table className={`${c.table} ${c.tableImport}`}>
                {/* Fixed widths, so the columns share the row evenly whatever the values. */}
                <colgroup>
                  {[20, 8, 14, 9, 7, 9, 9, 10, 10, 4].map((w, i) => (
                    <col key={i} style={{ width: `${w}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>CDC No.</th>
                    <th>Material</th>
                    <th className={c.r}>Quantity</th>
                    <th>CDC Unit</th>
                    <th className={c.r}>NW (kg)</th>
                    <th className={c.r}>GW (kg)</th>
                    <th className={c.r}>Unit Price (USD)</th>
                    <th className={c.r}>Amount (USD)</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {lines.fields.map((f, li) => {
                    const l = watchedLines?.[li];
                    const amount =
                      l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
                    const it = itemOf(l?.cdcNo);
                    const after = it ? remainingAfter.get(it.id) : undefined;
                    const over = after !== undefined && after < -1e-9;
                    return [
                      <tr key={f.id}>
                        <td>
                          <select
                            className={c.cell}
                            aria-label="Item"
                            value={it?.declareRef ?? l?.cdcNo ?? ''}
                            onChange={(ev) => pickItem(li, ev.target.value)}
                            aria-invalid={!!lineErr(li, 'cdcNo')}
                          >
                            <option value="">
                              {cdcItems.length ? 'Choose item…' : 'No CDC master list items'}
                            </option>
                            {/* A saved item no longer on the list stays shown as it was. */}
                            {l?.cdcNo && !it && (
                              <option value={l.cdcNo}>{l.description || l.cdcNo}</option>
                            )}
                            {CUT_STOCK_CATEGORIES.map((cat) => {
                              const items = cdcItems.filter((x) => x.category === cat);
                              return items.length ? (
                                <optgroup key={cat} label={CUT_STOCK_CATEGORY_LABEL[cat]}>
                                  {items.map((x) => (
                                    <option key={x.id} value={x.declareRef}>
                                      {x.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null;
                            })}
                          </select>
                          {after !== undefined && (
                            <span className={c.balance} data-over={over}>
                              Balance after saving: {fmtNum(after)} {it?.unit}
                            </span>
                          )}
                        </td>
                        {Auto(li, 'cdcNo', 'CDC No.')}
                        {Auto(li, 'material', 'Material')}
                        {Num(li, 'pcs', 'Quantity', '0')}
                        {Auto(li, 'unit', 'CDC Unit')}
                        {Num(li, 'netWeightKg', 'NW (kg)', '0.00')}
                        {Num(li, 'grossWeightKg', 'GW (kg)', '0.00')}
                        {Num(li, 'fobUnitPrice', 'Unit Price (USD)', '0.00')}
                        <td className={c.lineTotal}>{amount !== null ? money(amount) : '—'}</td>
                        <td className={c.act}>
                          {lines.fields.length > 1 && (
                            <button
                              type="button"
                              className={c.iconBtn}
                              title="Remove item"
                              aria-label="Remove item"
                              onClick={() => lines.remove(li)}
                            >
                              {fi.trash({})}
                            </button>
                          )}
                        </td>
                      </tr>,
                      over && (
                        <tr key={`${f.id}-over`} className={c.overRow}>
                          <td colSpan={10}>
                            {can('cutstock:override') ? (
                              <input
                                type="text"
                                className={c.cell}
                                placeholder="Reason for importing over the balance (required)"
                                aria-label="Reason for importing over the balance"
                                {...register(`invoices.${gi}.lines.${li}.overrideReason`)}
                              />
                            ) : (
                              <FieldError message="More than the remaining balance. A Manager must approve this item." />
                            )}
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
                {/* No total row: the invoice's totals are in the summary boxes above. */}
              </table>
            </div>
            <div className={c.foot}>
              <button type="button" className={c.addBtn} onClick={() => lines.append(blankLine())}>
                {fi.plus({})}
                Add Item
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
