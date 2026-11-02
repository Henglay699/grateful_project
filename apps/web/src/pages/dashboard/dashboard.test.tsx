import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { KpiResponse, PortRow } from '@gs/shared';
import { changePct, niceMax, HBarList } from './parts';

const portsData: { data: PortRow[] | undefined } = { data: undefined };
vi.mock('../../features/analytics', () => ({
  usePorts: () => ({ data: portsData.data, isLoading: false, error: null }),
}));
// Recharts needs a sized container; the KPI sparkline is decorative, so stub it out in jsdom.
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: () => null,
}));

const { PortCard, KpiRow } = await import('./OverviewCards');

describe('dashboard helpers', () => {
  it('changePct', () => {
    expect(changePct(110, 100)).toEqual({ text: '↗ 10.0%', up: true });
    expect(changePct(90, 100)).toEqual({ text: '↘ 10.0%', up: false });
    expect(changePct(5, 0)).toEqual({ text: 'new', up: true });
    expect(changePct(0, 0)).toBeNull();
  });
  it('niceMax', () => {
    expect([3, 7, 12, 37, 120, 430].map(niceMax)).toEqual([5, 10, 20, 50, 200, 500]);
  });
  it('HBarList scales bars to the largest value', () => {
    const { container } = render(
      <HBarList
        rows={[
          { key: 'a', name: 'China', value: 50, display: '50' },
          { key: 'b', name: 'Japan', value: 25, display: '25' },
        ]}
      />,
    );
    const fills = container.querySelectorAll<HTMLElement>('.an-hbar-fill');
    expect([fills[0]!.style.width, fills[1]!.style.width]).toEqual(['100%', '50%']);
  });
});

describe('PortCard', () => {
  it('groups ports beyond the top 3 into OTHERS and shows percentages', () => {
    const p = (shortName: string, imports: number): PortRow => ({
      id: shortName,
      code: shortName,
      name: shortName,
      shortName,
      imports,
      exports: 0,
      total: imports,
    });
    portsData.data = [
      p('SIHANOUKVILLE', 50),
      p('OLAIR', 20),
      p('KTI', 10),
      p('PNH PORT', 15),
      p('UNION', 5),
    ];
    render(<PortCard filters={{ from: '2026-01-01', to: '2026-12-31' }} />);
    const labels = [...document.querySelectorAll('.port-bar-label')].map((e) => e.textContent);
    expect(labels).toEqual(['SIHANOUKVILLE', 'OLAIR', 'PNH PORT', 'OTHERS']);
    const values = [...document.querySelectorAll('.port-bar-value')].map((e) => e.textContent);
    expect(values).toEqual(['50%', '20%', '15%', '15%']);
  });
  it('shows an empty state when there are no shipments', () => {
    portsData.data = [];
    render(<PortCard filters={{ from: '2026-01-01', to: '2026-12-31' }} />);
    expect(screen.getByText('No shipments in this period')).toBeInTheDocument();
  });
});

describe('KpiRow', () => {
  it('renders values from the API with change vs last month', () => {
    const k: KpiResponse = {
      period: { from: '2026-10-01', to: '2026-10-31' },
      previousPeriod: { from: '2026-09-01', to: '2026-09-30' },
      total: 20,
      imports: 9,
      exports: 11,
      cleared: 2,
      clearancePending: 17,
      exceptions: 1,
      previous: { total: 21, imports: 6, exports: 14, cleared: 18 },
    };
    render(
      <MemoryRouter>
        <KpiRow k={k} monthly={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('↘ 4.8%')).toBeInTheDocument();
    expect(screen.getByText('↗ 50.0%')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('still pending')).toBeInTheDocument();
  });
  it('drops the year-on-year change when last year had too few shipments', () => {
    const k: KpiResponse = {
      period: { from: '2026-01-01', to: '2026-10-31' },
      previousPeriod: { from: '2025-01-01', to: '2025-10-31' },
      total: 460,
      imports: 211,
      exports: 249,
      cleared: 452,
      clearancePending: 8,
      exceptions: 0,
      previous: { total: 3, imports: 3, exports: 0, cleared: 3 },
    };
    render(
      <MemoryRouter>
        <KpiRow k={k} monthly={[]} fullYear />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('not enough data last year')).toHaveLength(3);
    expect(screen.queryByText(/15233/)).not.toBeInTheDocument();
  });
});
