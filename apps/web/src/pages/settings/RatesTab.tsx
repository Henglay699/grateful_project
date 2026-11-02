import { useState, type ReactNode } from 'react';
import {
  GRAMS_PER_CHI,
  GRAMS_PER_DAMLUNG,
  GRAMS_PER_TROY_OZ,
  METAL_LABEL,
  type ExchangeRateSyncStatus,
  type FuelPriceRow,
  type MarketPrices,
  type MarketSyncStatus,
  type MetalQuote,
} from '@gs/shared';
import { useApiMutation, useMarketPrices, useSettings } from '../../features/admin';
import { ErrorBanner, TableState, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { api } from '../../lib/api';
import { fmtDate, fmtNum } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import { RateImportModal, RateRow } from './ExchangeRates';
import st from '../SettingsPage.module.css';
import r from './ExchangeRates.module.css';
import m from './RatesTab.module.css';

/*
 * Settings → Rates: three summary boxes (exchange rate, fuel, metals) with their current
 * figure, update status and actions. The selected box's history / detail shows below.
 */
/** Real metal icons, served from apps/web/public. */
const METAL_ICON: Record<MetalQuote['symbol'], string> = {
  XAU: '/gold.png',
  XAG: '/silver.png',
  XPT: '/platinum.png',
};
const INVALIDATE = [['settings'], queryKeys.lookups];
const MEF_RATE = 'https://data.mef.gov.kh/datasets/pd_66a0cd503e0bd300012638fb4';
const MEF_FUEL = 'https://data.mef.gov.kh/datasets/pd_681d89b4dbc953000126f5e7';
type Section = 'exchange' | 'fuel' | 'metals';

const usd = (v: number, digits = 2) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const riel = (v: number) => `${Math.round(v).toLocaleString('en-US')} ៛`;
const ppTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
/** "01-Oct-26 – 11-Oct-26", or "From 01-Oct-26" while the period is open. */
const period = (p: FuelPriceRow) =>
  p.endDate ? `${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}` : `From ${fmtDate(p.startDate)}`;

const svg = (children: ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const ICON = {
  exchange: svg(
    <>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </>,
  ),
  fuel: svg(
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M3 21h12" />
      <path d="M7 8h4" />
      <path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3" />
    </>,
  ),
  metals: svg(
    <>
      <path d="M6 10h12l3 8H3l3-8Z" />
      <path d="M9 10 10.5 4h3L15 10" />
    </>,
  ),
};

/** ▲ / ▼ change badge (up = amber, down = cyan). */
function Change({ diff, text }: { diff: number; text: string }) {
  if (!diff) return <span className={m.change}>No change</span>;
  return (
    <span className={m.change} data-dir={diff > 0 ? 'up' : 'down'}>
      {diff > 0 ? '▲' : '▼'} {text}
    </span>
  );
}

/** One-line update status at the foot of a box; the full error is in the tooltip. */
function SyncDot({
  status,
  auto,
  every,
  source,
}: {
  status: Pick<MarketSyncStatus, 'at' | 'ok' | 'error'> | null;
  auto: boolean;
  every: string;
  source: ReactNode;
}) {
  const failed = status && !status.ok;
  return (
    <div className={m.sync} data-tone={failed ? 'error' : undefined} title={status?.error}>
      <span className={m.dot} />
      <span>
        {auto ? `Auto ${every}` : 'Auto-update off'} · {source}
        {status &&
          (failed ? ` · check failed ${ppTime(status.at)}` : ` · checked ${ppTime(status.at)}`)}
      </span>
    </div>
  );
}

function Box({
  section,
  active,
  onSelect,
  title,
  sub,
  children,
  status,
  actions,
}: {
  section: Section;
  active: boolean;
  onSelect: (s: Section) => void;
  title: string;
  sub: string;
  children: ReactNode;
  status: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // The whole box selects it; the title button carries the keyboard / screen-reader role.
    <div className={m.box} data-active={active || undefined} onClick={() => onSelect(section)}>
      <div className={m.boxHead}>
        <span className={m.chip}>{ICON[section]}</span>
        <div className={m.boxTitles}>
          <button
            type="button"
            role="tab"
            id={`rates-tab-${section}`}
            aria-selected={active}
            aria-controls="rates-panel"
            className={m.boxTitle}
            onClick={() => onSelect(section)}
          >
            {title}
          </button>
          <span className={m.boxSub}>{sub}</span>
        </div>
      </div>
      <div className={m.boxBody}>{children}</div>
      <div className={m.boxFoot}>
        {status}
        {actions && <div className={m.boxActions}>{actions}</div>}
      </div>
    </div>
  );
}

/** Settings → Rates. */
export function RatesTab({ manage }: { manage: boolean }) {
  const s = useSettings().data!;
  const market = useMarketPrices();
  const toast = useToast();
  const [section, setSection] = useState<Section>('exchange');
  const [importing, setImporting] = useState(false);
  const md = market.data;
  const usdToKhr = s.exchangeRates[0] ? Number(s.exchangeRates[0].usdToKhr) : null;

  const rateSync = useApiMutation(
    () => api<ExchangeRateSyncStatus>('/settings/exchange-rates/sync', { method: 'POST' }),
    INVALIDATE,
  );
  const base = useApiMutation(
    (value: string) => api('/settings/base-exchange-rate', { method: 'PUT', json: { value } }),
    INVALIDATE,
  );
  const fuelSync = useApiMutation(
    () => api<MarketSyncStatus>('/settings/fuel-prices/sync', { method: 'POST' }),
    INVALIDATE,
  );
  const metalSync = useApiMutation(
    () => api<MarketSyncStatus>('/settings/metal-prices/sync', { method: 'POST' }),
    INVALIDATE,
  );

  /* ---------- Exchange box ---------- */
  const [rateNow, ratePrev] = s.exchangeRates;
  const rateDiff = rateNow && ratePrev ? Number(rateNow.usdToKhr) - Number(ratePrev.usdToKhr) : 0;

  /* ---------- Fuel box ---------- */
  const [fuelNow, fuelPrev] = md?.fuel ?? [];
  const fuelFigure = (label: string, key: 'gasoline92' | 'gasoil') => {
    const now = fuelNow ? Number(fuelNow[key]) : null;
    const diff = now !== null && fuelPrev ? now - Number(fuelPrev[key]) : 0;
    return (
      <div className={m.figure}>
        <span className={m.figureLabel}>{label}</span>
        <span className={m.figureValue}>
          {now === null ? '—' : riel(now)}
          {now !== null && <small>/ L</small>}
        </span>
        {fuelPrev && now !== null && <Change diff={diff} text={riel(Math.abs(diff))} />}
      </div>
    );
  };

  return (
    <>
      {importing && <RateImportModal onClose={() => setImporting(false)} />}
      <ErrorBanner
        error={rateSync.error ?? base.error ?? fuelSync.error ?? metalSync.error ?? market.error}
      />

      <div className={m.boxes} role="tablist" aria-label="Rates">
        <Box
          section="exchange"
          active={section === 'exchange'}
          onSelect={setSection}
          title="Exchange rate"
          sub="USD → KHR, used by new ledger rows"
          status={
            <SyncDot
              status={s.exchangeRateSync}
              auto={s.exchangeRateAutoSync}
              every="every 3 h"
              source={
                <a href={MEF_RATE} target="_blank" rel="noreferrer">
                  MEF official rate
                </a>
              }
            />
          }
          actions={
            manage && (
              <>
                <button
                  type="button"
                  className="filter-btn"
                  disabled={rateSync.isPending}
                  onClick={() =>
                    void rateSync
                      .mutateAsync(undefined)
                      .then((x) =>
                        toast(
                          x.result === 'same'
                            ? `Already up to date: ${fmtNum(x.usdToKhr)} KHR for ${fmtDate(x.effectiveDate)}.`
                            : `Official rate ${x.result === 'new' ? 'added' : 'updated'}: ${fmtNum(x.usdToKhr)} KHR for ${fmtDate(x.effectiveDate)}.`,
                        ),
                      )
                  }
                >
                  {rateSync.isPending ? 'Updating…' : 'Update'}
                </button>
                <button type="button" className="filter-btn" onClick={() => setImporting(true)}>
                  Import Excel
                </button>
                <button
                  type="button"
                  className="filter-btn"
                  onClick={() => {
                    const v = window.prompt(
                      'Base rate (1 USD = ? KHR)',
                      String(s.baseExchangeRate),
                    );
                    if (v) void base.mutateAsync(v).then(() => toast('Base rate saved.'));
                  }}
                >
                  Base rate
                </button>
              </>
            )
          }
        >
          <div className={m.figure}>
            <span className={m.figureLabel}>
              {rateNow ? `1 USD from ${fmtDate(rateNow.effectiveDate)}` : 'Base rate'}
            </span>
            <span className={m.figureValue} data-size="lg">
              {riel(rateNow ? Number(rateNow.usdToKhr) : s.baseExchangeRate)}
            </span>
            {ratePrev && <Change diff={rateDiff} text={riel(Math.abs(rateDiff))} />}
          </div>
        </Box>

        <Box
          section="fuel"
          active={section === 'fuel'}
          onSelect={setSection}
          title="Fuel prices"
          sub={fuelNow ? period(fuelNow) : 'Ministry of Commerce retail prices'}
          status={
            <SyncDot
              status={md?.fuelSync ?? null}
              auto={md?.fuelAutoSync ?? true}
              every="every 3 h"
              source={
                <a href={MEF_FUEL} target="_blank" rel="noreferrer">
                  MEF open data
                </a>
              }
            />
          }
          actions={
            manage && (
              <button
                type="button"
                className="filter-btn"
                disabled={fuelSync.isPending}
                onClick={() =>
                  void fuelSync
                    .mutateAsync(undefined)
                    .then((x) =>
                      toast(
                        x.added || x.updated
                          ? `Fuel prices updated: ${x.added ?? 0} added, ${x.updated ?? 0} changed.`
                          : 'Fuel prices are already up to date.',
                      ),
                    )
                }
              >
                {fuelSync.isPending ? 'Updating…' : 'Update'}
              </button>
            )
          }
        >
          <div className={m.figurePair}>
            {fuelFigure('Gasoline 92', 'gasoline92')}
            {fuelFigure('Gasoil 50ppm', 'gasoil')}
          </div>
        </Box>

        <Box
          section="metals"
          active={section === 'metals'}
          onSelect={setSection}
          title="Precious metals"
          sub="Spot price, USD per troy ounce"
          status={
            <SyncDot
              status={md?.metalSync ?? null}
              auto={md?.metalAutoSync ?? true}
              every="hourly"
              source={
                <a href="https://gold-api.com" target="_blank" rel="noreferrer">
                  gold-api.com
                </a>
              }
            />
          }
          actions={
            manage && (
              <button
                type="button"
                className="filter-btn"
                disabled={metalSync.isPending}
                onClick={() =>
                  void metalSync.mutateAsync(undefined).then(() => toast('Metal prices updated.'))
                }
              >
                {metalSync.isPending ? 'Updating…' : 'Update'}
              </button>
            )
          }
        >
          <ul className={m.metalList}>
            {(md?.metals ?? []).map((q) => {
              const now = q.latest ? Number(q.latest.usdPerOz) : null;
              const prev = q.previous ? Number(q.previous.usdPerOz) : null;
              const diff = now !== null && prev ? now - prev : 0;
              return (
                <li key={q.symbol} data-metal={q.symbol}>
                  <img className={m.metalIconSm} src={METAL_ICON[q.symbol]} alt="" />
                  <span className={m.metalName}>{METAL_LABEL[q.symbol]}</span>
                  <span className={m.metalValue}>{now === null ? '—' : usd(now)}</span>
                  {prev !== null && (
                    <Change diff={diff} text={`${((Math.abs(diff) / prev) * 100).toFixed(2)}%`} />
                  )}
                </li>
              );
            })}
          </ul>
        </Box>
      </div>

      <div
        className="card"
        id="rates-panel"
        role="tabpanel"
        aria-labelledby={`rates-tab-${section}`}
      >
        {section === 'exchange' && <ExchangePanel manage={manage} />}
        {section === 'fuel' && md && <FuelPanel data={md} manage={manage} />}
        {section === 'metals' && md && <MetalsPanel data={md} usdToKhr={usdToKhr} />}
        {section !== 'exchange' && !md && !market.error && (
          <div className={m.loading} aria-busy="true">
            Loading…
          </div>
        )}
      </div>
    </>
  );
}

function PanelHead({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <div className="card-header-row">
      <div>
        <h3>{title}</h3>
        <div className="create-header-desc" style={{ marginTop: 4 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Exchange-rate history ------------------------------ */

function ExchangePanel({ manage }: { manage: boolean }) {
  const s = useSettings().data!;
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState('');
  const add = useApiMutation(
    () =>
      api('/settings/exchange-rates', {
        method: 'POST',
        json: { effectiveDate: date, usdToKhr: rate },
      }),
    INVALIDATE,
  );
  return (
    <>
      <PanelHead
        title="USD → KHR exchange rates"
        sub={`New ledger rows use the rate in force on their invoice date. Before the first rate, the base rate (${fmtNum(s.baseExchangeRate)}) is used.`}
      />
      <ErrorBanner error={add.error} />
      {manage && (
        <div className={ui.toolbar} style={{ marginBottom: 14 }}>
          <input
            type="date"
            className={ui.input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Effective from"
          />
          <NumberInput
            className={ui.input}
            decimals={4}
            placeholder="e.g. 4,026"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-label="KHR per USD"
          />
          <button
            type="button"
            className="new-shipment-btn"
            disabled={!rate || add.isPending}
            onClick={() =>
              void add.mutateAsync(undefined).then(() => {
                setRate('');
                toast('Rate saved.');
              })
            }
          >
            Add rate
          </button>
        </div>
      )}
      <div className={st.tableScroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Effective from</th>
              <th>1 USD =</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <TableState
              cols={3}
              loading={false}
              error={null}
              empty={!s.exchangeRates.length}
              emptyText="No dated rates yet."
            />
            {s.exchangeRates.map((x) => (
              <RateRow key={x.id} rate={x} manage={manage} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------ Fuel history ------------------------------ */

function FuelPanel({ data, manage }: { data: MarketPrices; manage: boolean }) {
  const toast = useToast();
  const blank = () => ({ startDate: today(), endDate: '', gasoline92: '', gasoil: '' });
  const [draft, setDraft] = useState(blank);
  const add = useApiMutation(
    () => api('/settings/fuel-prices', { method: 'POST', json: draft }),
    INVALIDATE,
  );
  return (
    <>
      <PanelHead
        title="Fuel price history"
        sub="Retail price ceilings set by the Ministry of Commerce, in riel per litre. Add a period by hand when a notice is out before MEF publishes it."
      />
      <ErrorBanner error={add.error} />
      {manage && (
        <div className={ui.toolbar} style={{ marginBottom: 14 }}>
          <input
            type="date"
            className={ui.input}
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            aria-label="Period start"
          />
          <input
            type="date"
            className={ui.input}
            value={draft.endDate}
            min={draft.startDate}
            onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            aria-label="Period end (optional)"
          />
          <NumberInput
            className={ui.input}
            decimals={0}
            placeholder="Gasoline 92 (៛)"
            value={draft.gasoline92}
            onChange={(e) => setDraft({ ...draft, gasoline92: e.target.value })}
            aria-label="Gasoline 92, riel per litre"
          />
          <NumberInput
            className={ui.input}
            decimals={0}
            placeholder="Gasoil (៛)"
            value={draft.gasoil}
            onChange={(e) => setDraft({ ...draft, gasoil: e.target.value })}
            aria-label="Gasoil 50ppm, riel per litre"
          />
          <button
            type="button"
            className="new-shipment-btn"
            disabled={!draft.startDate || !draft.gasoline92 || !draft.gasoil || add.isPending}
            onClick={() =>
              void add.mutateAsync(undefined).then(() => {
                setDraft(blank());
                toast('Fuel price saved.');
              })
            }
          >
            Add period
          </button>
        </div>
      )}
      <div className={st.tableScroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Period</th>
              <th>Gasoline 92</th>
              <th>Gasoil 50ppm</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <TableState
              cols={5}
              loading={false}
              error={null}
              empty={!data.fuel.length}
              emptyText="No fuel prices yet. Use “Update” on the Fuel prices box to fetch them."
            />
            {data.fuel.map((p, i) => (
              <FuelRow key={p.id} row={p} prev={data.fuel[i + 1]} manage={manage} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FuelRow({
  row,
  prev,
  manage,
}: {
  row: FuelPriceRow;
  prev: FuelPriceRow | undefined;
  manage: boolean;
}) {
  const toast = useToast();
  const del = useApiMutation(
    () => api(`/settings/fuel-prices/${row.id}`, { method: 'DELETE' }),
    INVALIDATE,
  );
  const cell = (key: 'gasoline92' | 'gasoil') => {
    const diff = prev ? Number(row[key]) - Number(prev[key]) : 0;
    return (
      <td>
        <span className="val-bold">{fmtNum(row[key])} ៛</span>
        {prev && diff !== 0 && (
          <span className={m.rowDiff} data-dir={diff > 0 ? 'up' : 'down'}>
            {diff > 0 ? '+' : '−'}
            {fmtNum(Math.abs(diff))}
          </span>
        )}
      </td>
    );
  };
  return (
    <tr>
      <td>{period(row)}</td>
      {cell('gasoline92')}
      {cell('gasoil')}
      <td>
        {row.sourceLink ? (
          <a className={m.link} href={row.sourceLink} target="_blank" rel="noreferrer">
            MoC notice ↗
          </a>
        ) : (
          <span className={m.muted}>{row.source === 'manual' ? 'Entered by hand' : 'MEF'}</span>
        )}
      </td>
      <td>
        {manage && (
          <div className={r.actions}>
            <button
              type="button"
              className={`${r.icon} ${r.danger}`}
              title="Delete"
              aria-label={`Delete fuel price for ${period(row)}`}
              disabled={del.isPending}
              onClick={() =>
                window.confirm(`Delete the fuel price for ${period(row)}?`) &&
                void del.mutateAsync(undefined).then(() => toast('Fuel price deleted.'))
              }
            >
              {icons.trash({})}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------ Metals detail ------------------------------ */

function MetalsPanel({ data, usdToKhr }: { data: MarketPrices; usdToKhr: number | null }) {
  return (
    <>
      <PanelHead
        title="Gold, silver & platinum"
        sub={`International spot prices, not shop prices. Cambodian weights: 1 chi = ${GRAMS_PER_CHI} g, 1 damlung = ${GRAMS_PER_DAMLUNG} g.${usdToKhr ? ` Riel at ${fmtNum(usdToKhr)} ៛ per USD.` : ''}`}
      />
      <div className={m.metalTiles}>
        {data.metals.map((q) => (
          <MetalTile key={q.symbol} quote={q} usdToKhr={usdToKhr} />
        ))}
      </div>
    </>
  );
}

function MetalTile({ quote, usdToKhr }: { quote: MetalQuote; usdToKhr: number | null }) {
  const name = METAL_LABEL[quote.symbol];
  const head = (
    <div className={m.tileHead}>
      <img className={m.metalIcon} src={METAL_ICON[quote.symbol]} alt="" />
      <span className={m.tileName}>{name}</span>
      <span className={m.symbol}>{quote.symbol}</span>
    </div>
  );
  if (!quote.latest)
    return (
      <div className={m.tile} data-metal={quote.symbol}>
        {head}
        <div className={m.muted}>No price yet</div>
      </div>
    );
  const oz = Number(quote.latest.usdPerOz);
  const perGram = oz / GRAMS_PER_TROY_OZ;
  const prev = quote.previous ? Number(quote.previous.usdPerOz) : null;
  const diff = prev ? oz - prev : 0;
  const weights: [string, number][] = [
    ['1 troy oz', oz],
    ['1 gram', perGram],
    ['1 chi', perGram * GRAMS_PER_CHI],
    ['1 damlung', perGram * GRAMS_PER_DAMLUNG],
  ];
  return (
    <div className={m.tile} data-metal={quote.symbol}>
      {head}
      <div className={m.tileMeta}>
        {prev !== null && (
          <Change
            diff={diff}
            text={`${usd(Math.abs(diff))} (${((Math.abs(diff) / prev) * 100).toFixed(2)}%) vs ${fmtDate(quote.previous!.priceDate)}`}
          />
        )}
        <span>As of {ppTime(quote.latest.fetchedAt)}</span>
      </div>
      <table className={m.weights}>
        <tbody>
          {weights.map(([label, v]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{usd(v)}</td>
              <td>{usdToKhr ? riel(v * usdToKhr) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
