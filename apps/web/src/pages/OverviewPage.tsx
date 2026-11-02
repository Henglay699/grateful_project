import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useAccounts, useOverviewSummary } from '../features/analytics';
import { ErrorBanner } from '../components/ui';
import {
  AccountsCard,
  ClientShareCard,
  CountryMapCard,
  ForwarderCard,
  KpiRow,
  LiveConsignmentsCard,
  PortCard,
  ProfitCard,
  ShipmentSummaryCard,
} from './dashboard/OverviewCards';
import { KpiRowSkeleton } from './dashboard/KpiRow';
import { currentMonth, monthRange, useOverviewMonth } from './dashboard/overviewMonth';
import { MONTHS, MONTHS_LONG } from './dashboard/parts';
import { useOverviewWidgets } from './dashboard/widgets';
import { CustomizeWidgets } from './dashboard/CustomizeWidgets';
import cw from './dashboard/CustomizeWidgets.module.css';

export function OverviewPage() {
  const { can, user } = useAuth();
  // Operators see one client at a time (as a user with one client does), picked on either card.
  const [clientId, setClientId] = useState('');
  const pick = user?.role === 'OPERATOR' ? { value: clientId, onChange: setClientId } : undefined;
  // The month picker beside the title (?month=YYYY-MM, or ?year=YYYY for a whole year);
  // the current month when absent.
  const { month, fullYear } = useOverviewMonth();
  const summary = useOverviewSummary(month, fullYear);
  const s = summary.data;
  const year = s?.year ?? new Date().getFullYear();
  const yearFilters = { from: `${year}-01-01`, to: `${year}-12-31` };
  // The cards below the KPIs show the header's period: a month, or January to it.
  const shown = s?.month ?? month ?? currentMonth();
  const wholeYear = s?.fullYear ?? !!fullYear;
  const periodFilters =
    s?.kpis.period ??
    (fullYear ? { from: `${fullYear}-01-01`, to: `${fullYear}-12-31` } : monthRange(shown));
  const period = wholeYear
    ? `Jan – ${MONTHS[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`
    : `${MONTHS_LONG[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`;
  // The year's clients are the ones to pick from; the period's figures fill the cards.
  const clients = useAccounts(yearFilters);
  const accounts = useAccounts(periodFilters);
  const today = s?.today ?? '';

  // Which widgets this person shows (Customize, opened from the top bar as ?customize=1).
  const canProfit = can('accounting:read');
  const widgets = useOverviewWidgets(user?.id ?? '', canProfit);
  const on = widgets.shown;
  const [params, setParams] = useSearchParams();
  const customizing = params.get('customize') === '1';
  const openCustomize = () => {
    const next = new URLSearchParams(params);
    next.set('customize', '1');
    setParams(next, { replace: true });
  };
  const closeCustomize = () => {
    const next = new URLSearchParams(params);
    next.delete('customize');
    setParams(next, { replace: true });
  };
  // Profit fills its slot once loaded; until then (or without figures) Shipments by Client
  // stands in, as it always has.
  const profitShown = on('profit') && !!s?.profit;
  const clientsShown = on('clients') || (on('profit') && !s?.profit);
  const cards = [
    on('shipments'),
    profitShown,
    clientsShown,
    on('map'),
    on('accounts'),
    on('ports'),
    on('forwarders'),
  ].filter(Boolean).length;
  // The six cards as they come fill the grid's named areas; any other set flows in order.
  const flow = cards !== 6 || (profitShown && clientsShown);
  const nothing = !on('kpis') && !cards && !on('live');

  return (
    <section className="view active" id="view-overview">
      <ErrorBanner error={summary.error} />
      {on('kpis') &&
        (s ? <KpiRow k={s.kpis} monthly={s.monthly} fullYear={s.fullYear} /> : <KpiRowSkeleton />)}

      {cards > 0 && (
        <div className={`ov-grid-3col${flow ? ' ov-flow' : ''}`}>
          {on('shipments') && (
            <ShipmentSummaryCard
              year={year}
              monthly={s?.monthly ?? []}
              currentMonth={today.slice(0, 7)}
              loading={summary.isLoading}
              error={summary.error}
            />
          )}
          {profitShown && s?.profit && (
            <ProfitCard
              key={`${s.month}${s.fullYear ? '-year' : ''}`}
              profit={s.profit}
              fullYear={s.fullYear}
              lastYearShipments={s.fullYear ? s.kpis.previous.total : undefined}
            />
          )}
          {clientsShown && (
            <ClientShareCard
              clients={clients.data ?? []}
              accounts={accounts.data ?? []}
              month={shown}
              fullYear={wholeYear}
              period={period}
              monthly={s?.monthly ?? []}
              pick={pick}
            />
          )}
          {on('map') && <CountryMapCard filters={periodFilters} />}
          {on('accounts') && (
            <AccountsCard
              filters={periodFilters}
              period={period}
              pick={pick}
              clients={clients.data ?? []}
            />
          )}
          {on('ports') && <PortCard filters={periodFilters} />}
          {on('forwarders') && <ForwarderCard filters={periodFilters} />}
        </div>
      )}

      {on('live') && <LiveConsignmentsCard />}

      {nothing && (
        <div className={cw.empty}>
          <b>Every widget is switched off</b>
          <span>Pick the ones you want on your Overview.</span>
          <button type="button" className="btn-create-submit" onClick={openCustomize}>
            Edit widgets
          </button>
        </div>
      )}

      {customizing && (
        <CustomizeWidgets canProfit={canProfit} {...widgets} onClose={closeCustomize} />
      )}
    </section>
  );
}
