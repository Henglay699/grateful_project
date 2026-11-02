import { Suspense, lazy, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useAccounts,
  useByCountry,
  useClearanceStatus,
  useForwarders,
  useMonthlyVolume,
  usePorts,
  useTransportShare,
  type AnalyticsFilters,
} from '../features/analytics';
import { useAuth } from '../auth/AuthProvider';
import { DirectionToggle } from '../components/DirectionToggle';
import { useLookups } from '../features/hooks';
import { AccountsBreakdown } from './analytics/AccountsBreakdown';
import { ClientRevenueCards } from './analytics/ClientRevenueCards';
import { ClearanceCard, FlowShareCard } from './analytics/ShareCards';
import { MonthlyVolumeCard } from './analytics/TrendCards';
import { PortsCard } from './analytics/PortsCard';
import { ForwarderFunnelCard } from './analytics/ForwarderFunnelCard';
import { ChartState, HBarList, dash, monthLabel } from './dashboard/parts';
// Leaflet and its map tiles load only with the Analytics page.
const ShipmentsMap = lazy(() =>
  import('./analytics/ShipmentsMap').then((m) => ({ default: m.ShipmentsMap })),
);

const MODES = {
  '': { label: 'All transport', mode: undefined, load: undefined },
  FCL: { label: 'Sea CY/CY', mode: 'SEA', load: 'FCL' },
  LCL: { label: 'Sea LCL', mode: 'SEA', load: 'LCL' },
  AIR: { label: 'Air', mode: 'AIR', load: undefined },
  ROAD: { label: 'Road / truck', mode: 'ROAD', load: undefined },
} as const;
type ModeKey = keyof typeof MODES;

/** Today in Phnom Penh as YYYY-MM-DD. */
function ppToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
}
function presetRange(preset: string, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: iso(new Date(Date.UTC(y, m, 0))) };
    case '3m':
      return { from: iso(new Date(Date.UTC(y, m - 3, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case 'ytd':
      return { from: `${y}-01-01`, to: today };
    case 'lastyear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const { can } = useAuth();
  const today = ppToday();
  const preset = params.get('period') ?? 'year';
  const fromP = params.get('from');
  const toP = params.get('to');
  const range = useMemo(
    () =>
      preset === 'custom'
        ? { from: fromP ?? `${today.slice(0, 4)}-01-01`, to: toP ?? today }
        : presetRange(preset, today),
    [preset, fromP, toP, today],
  );
  const modeKey = (params.get('mode') ?? '') as ModeKey;
  const clientKey = params.getAll('clientId').join(',');
  const direction = params.get('direction') || undefined;
  // Stable object so TanStack Query keys only change when a filter really changes.
  const filters: AnalyticsFilters = useMemo(
    () => ({
      ...range,
      clientId: clientKey ? clientKey.split(',') : [],
      direction,
      transportMode: MODES[modeKey]?.mode,
      loadType: MODES[modeKey]?.load,
    }),
    [range, clientKey, direction, modeKey],
  );

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'period' && v === 'custom') {
      next.set('from', range.from);
      next.set('to', range.to);
    }
    setParams(next, { replace: true });
  };

  const monthly = useMonthlyVolume(filters);
  const share = useTransportShare(filters);
  const clearance = useClearanceStatus(filters);
  const [countryFlow, setCountryFlow] = useState<'import' | 'export'>('import');
  const countries = useByCountry(filters, countryFlow);
  const fwd = useForwarders(filters);
  const ports = usePorts(filters);
  const accounts = useAccounts(filters);

  const monthlyData = (monthly.data ?? []).map((m) => ({
    ...m,
    label:
      monthly.data!.length > 12
        ? `${monthLabel(m.month)} ${m.month.slice(2, 4)}`
        : monthLabel(m.month),
  }));
  const periodLabel = `${range.from} → ${range.to}`;

  return (
    <section className="view active" id="view-analytics">
      <div className="an-head-row">
        <p className="an-sub">
          Every figure is calculated from the shipments in the database for the filters below (by
          ETA month).
        </p>
        <div className={dash.filters} role="group" aria-label="Analytics filters">
          <select
            className={dash.filterInput}
            value={preset}
            onChange={(e) => set('period', e.target.value)}
            aria-label="Period"
          >
            <option value="month">This month</option>
            <option value="3m">Last 3 months</option>
            <option value="ytd">Year to date ({today.slice(0, 4)})</option>
            <option value="year">Full year {today.slice(0, 4)}</option>
            <option value="lastyear">{Number(today.slice(0, 4)) - 1}</option>
            <option value="custom">Custom dates…</option>
          </select>
          {preset === 'custom' && (
            <>
              <input
                type="date"
                className={dash.filterInput}
                value={range.from}
                max={range.to}
                onChange={(e) => set('from', e.target.value)}
                aria-label="From"
              />
              <input
                type="date"
                className={dash.filterInput}
                value={range.to}
                min={range.from}
                onChange={(e) => set('to', e.target.value)}
                aria-label="To"
              />
            </>
          )}
          <select
            className={dash.filterInput}
            value={params.get('clientId') ?? ''}
            onChange={(e) => set('clientId', e.target.value)}
            aria-label="Client"
          >
            <option value="">All clients</option>
            {lookups.data?.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <DirectionToggle value={direction} onChange={(d) => set('direction', d)} />
          <select
            className={dash.filterInput}
            value={modeKey}
            onChange={(e) => set('mode', e.target.value)}
            aria-label="Transport mode"
          >
            {Object.entries(MODES).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <MonthlyVolumeCard
        data={monthlyData}
        loading={monthly.isLoading}
        error={monthly.error}
        periodLabel={periodLabel}
      />

      <div className="an-grid-2col">
        <FlowShareCard data={share.data} loading={share.isLoading} error={share.error} />
        <ClearanceCard
          rows={clearance.data}
          loading={clearance.isLoading}
          error={clearance.error}
        />
      </div>

      {can('accounting:read') && <ClientRevenueCards filters={filters} periodLabel={periodLabel} />}

      <div className="an-grid-2col-rev">
        <div className="card">
          <div className="an-section-title-row">
            <div>
              <h3>Forwarder Performance Ranking</h3>
              <div className="an-section-sub">
                Ranked by shipments; on-time = arrived on or before ETA.
              </div>
            </div>
          </div>
          <ChartState
            loading={fwd.isLoading}
            error={fwd.error}
            empty={!fwd.data?.length}
            height={150}
          >
            {/* Every forwarder, scrolling inside the card's chart height. */}
            <div className="an-scroll-list">
              <HBarList
                rows={(fwd.data ?? []).map((f) => ({
                  key: f.id,
                  name: f.name,
                  value: f.shipments,
                  display: `${f.shipments} shipments · ${f.onTimePct === null ? 'no arrivals yet' : `${f.onTimePct}% on time`}${f.avgDelayDays ? ` · ${f.avgDelayDays}d avg delay` : ''}`,
                  color:
                    f.onTimePct === null
                      ? 'var(--text-tertiary)'
                      : f.onTimePct >= 85
                        ? 'var(--accent-emerald)'
                        : f.onTimePct >= 70
                          ? 'var(--accent-amber)'
                          : 'var(--accent-rose)',
                }))}
              />
            </div>
          </ChartState>
        </div>
        <PortsCard rows={ports.data} loading={ports.isLoading} error={ports.error} />
      </div>

      <ForwarderFunnelCard rows={fwd.data} loading={fwd.isLoading} error={fwd.error} />

      <AccountsBreakdown rows={accounts.data} loading={accounts.isLoading} error={accounts.error} />

      <div className="card" style={{ marginTop: 18 }}>
        <div className="an-section-title-row">
          <div>
            <h3>Shipments by {countryFlow === 'import' ? 'Origin' : 'Destination'} Country</h3>
            <div className="an-section-sub">
              Imports by country of origin, exports by destination country. Click a pin or a country
              for its figures; nearby countries group into one bubble with their total.
            </div>
          </div>
          <div className="an-seg-control" role="tablist">
            {(['import', 'export'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={countryFlow === f}
                className={`an-seg-btn${countryFlow === f ? ' active' : ''}`}
                onClick={() => setCountryFlow(f)}
              >
                {f === 'import' ? 'Import' : 'Export'}
              </button>
            ))}
          </div>
        </div>
        <ChartState
          loading={countries.isLoading}
          error={countries.error}
          empty={!countries.data?.length}
          height={460}
        >
          <Suspense fallback={<div className={dash.skeleton} style={{ minHeight: 460 }} />}>
            <ShipmentsMap rows={countries.data ?? []} flow={countryFlow} />
          </Suspense>
        </ChartState>
      </div>
    </section>
  );
}
