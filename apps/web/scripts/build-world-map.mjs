// Generates src/pages/dashboard/worldMap.json: one SVG path per country, keyed by ISO
// alpha-2 code, so the dashboard map can colour the countries shipments come from.
// Run after changing the projection or size: `node scripts/build-world-map.mjs`.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-110m.json');

const WIDTH = 365;
const HEIGHT = 185;
const ANTARCTICA = '010';

const all = feature(topo, topo.objects.countries).features.filter((f) => f.id !== ANTARCTICA);
const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], {
  type: 'FeatureCollection',
  features: all,
});
const path = geoPath(projection);
// One decimal place is plenty at this size and keeps the file small.
const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));

const out = [];
for (const f of all) {
  const d = path(f);
  if (!d) continue;
  // Some areas (e.g. N. Cyprus, Kosovo) have no numeric code; keep them as plain land.
  const iso2 = (f.id && countries.numericToAlpha2(f.id)) || '';
  // Centre point, where the dashboard draws a marker on the top countries.
  const c = path.centroid(f).map((n) => Math.round(n * 10) / 10);
  out.push({ iso2, name: f.properties.name, d: round(d), c });
}

const file = new URL('../src/pages/dashboard/worldMap.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify({ width: WIDTH, height: HEIGHT, countries: out }));
console.log(`${out.length} countries, ${fs.statSync(file).size} bytes`);
