// Generates src/pages/analytics/countryPoints.json: a [lat, lng] pin for every country,
// keyed by ISO alpha-2, for the Analytics shipments map. The pin sits at the centre of the
// country's largest landmass, so overseas islands (France, US) don't pull it into the sea.
// Run after updating world-atlas: `node scripts/build-country-points.mjs`.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { geoArea, geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-50m.json');

const round = (n) => Math.round(n * 100) / 100;
const out = {};
for (const f of feature(topo, topo.objects.countries).features) {
  const iso2 = f.id && countries.numericToAlpha2(f.id);
  if (!iso2) continue;
  let shape = f;
  if (f.geometry.type === 'MultiPolygon') {
    const parts = f.geometry.coordinates.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: p },
    }));
    shape = parts.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
  }
  const [lng, lat] = geoCentroid(shape);
  out[iso2] = [round(lat), round(lng)];
}

const file = new URL('../src/pages/analytics/countryPoints.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${Object.keys(out).length} countries, ${fs.statSync(file).size} bytes`);
