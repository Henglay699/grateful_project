import { useSearchParams } from 'react-router-dom';

/** This month as YYYY-MM on the viewer's clock. */
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** A month (YYYY-MM) as a from/to date range, first to last day. */
export const monthRange = (ym: string) => ({
  from: `${ym}-01`,
  to: new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10),
});

/**
 * The Overview's month, kept in the address (?month=YYYY-MM) so a refresh or a shared link
 * shows the same month. `month` is undefined for the live (current) month. A whole year
 * (January to this month for the current year) is ?year=YYYY, given as `fullYear`.
 */
export function useOverviewMonth() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month') ?? '';
  const askedYear = params.get('year') ?? '';
  const fullYear =
    /^\d{4}$/.test(askedYear) && askedYear <= currentMonth().slice(0, 4) ? askedYear : undefined;
  const valid = !fullYear && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked < currentMonth();
  const month = valid ? asked : undefined;
  const setMonth = (m: string | undefined) => {
    const next = new URLSearchParams(params);
    next.delete('year');
    if (m && m < currentMonth()) next.set('month', m);
    else next.delete('month');
    setParams(next, { replace: true });
  };
  const setFullYear = (y: string) => {
    const next = new URLSearchParams(params);
    next.delete('month');
    next.set('year', y);
    setParams(next, { replace: true });
  };
  return { month, fullYear, setMonth, setFullYear };
}
