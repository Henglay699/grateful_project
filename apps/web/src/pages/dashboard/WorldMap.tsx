import type { CountryRow } from '@gs/shared';
import map from './worldMap.json';

/** How many of the top countries get a pulsing marker. */
const MARKERS = 3;

/**
 * World map with every country that has shipments filled in the accent cyan (the bigger
 * its share, the stronger the fill) and a pulsing marker on the top few. Paths come from
 * scripts/build-world-map.mjs.
 */
export function WorldMap({ rows }: { rows: CountryRow[] }) {
  const byIso = new Map(rows.map((r, i) => [r.iso2.toUpperCase(), { ...r, rank: i }]));
  const max = Math.max(1, ...rows.map((r) => r.pct));
  const hits = map.countries.flatMap((c) => {
    const r = c.iso2 ? byIso.get(c.iso2) : undefined;
    return r ? [{ ...c, r }] : [];
  });
  return (
    <svg
      className="world-map-svg"
      viewBox={`0 0 ${map.width} ${map.height}`}
      role="img"
      aria-label={
        rows.length ? `Map highlighting ${rows.map((r) => r.name).join(', ')}` : 'World map'
      }
    >
      <g className="land">
        {map.countries.map((c, i) =>
          c.iso2 && byIso.has(c.iso2) ? null : <path key={i} d={c.d} />,
        )}
      </g>
      {/* Drawn last so the glow sits above neighbouring land. */}
      <g className="hits">
        {hits.map(({ iso2, d, r }) => (
          <path key={iso2} d={d} style={{ fillOpacity: 0.45 + 0.55 * (r.pct / max) }}>
            <title>{`${r.name}: ${r.pct}% · ${r.count} shipments`}</title>
          </path>
        ))}
      </g>
      <g className="markers" aria-hidden="true">
        {hits
          .filter(({ r }) => r.rank < MARKERS)
          .map(({ iso2, c: [x, y] }) => (
            <g key={iso2} transform={`translate(${x} ${y})`}>
              <circle className="pulse" r={3} />
              <circle className="dot" r={2} />
            </g>
          ))}
      </g>
    </svg>
  );
}
