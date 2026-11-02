import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import './leafletGlobal';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'country-flag-icons/3x2/flags.css';
import type { CountryRow } from '@gs/shared';
import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import worldUrl from 'world-atlas/countries-50m.json?url';
import points from './countryPoints.json';
import s from './ShipmentsMap.module.css';

/** world-atlas's TopoJSON, as topojson-client takes it. */
type Topology = Parameters<typeof feature>[0];

type Base = 'map' | 'satellite';

// Esri's public tile services: free and keyless (CARTO's now return "API key required").
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const TILES = {
  /** Dark place names made for a light gray map: drawn over our white land. */
  mapLabels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  satellite: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
  /** Borders and place names for imagery. */
  satelliteLabels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
};
const ATTR = {
  map: 'Labels &copy; Esri &middot; Countries: Natural Earth',
  satellite: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
};
/** White land with light gray borders; the sea is the frame's gray background. */
const LAND_STYLE: L.PathOptions = {
  fillColor: '#ffffff',
  fillOpacity: 1,
  color: '#c9c9c4',
  weight: 0.8,
};

const PIN_POINTS = points as unknown as Record<string, [number, number]>;
/** The whole world, shown before there are pins to fit. */
const WORLD: L.LatLngTuple = [22, 60];

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'shipment' : 'shipments'}`;

/** A pin's shipments, kept on the marker so a cluster can add its pins up. */
interface PinMarker extends L.Marker {
  row: CountryRow;
}

/** Teardrop pin with the country's shipment count; the top three are filled. */
function pinIcon(r: CountryRow, rank: number) {
  const size = Math.round(30 + Math.min(12, Math.sqrt(r.count) * 2));
  return L.divIcon({
    className: s.pinWrap!,
    html: `<div class="${s.pin}" data-top="${rank < 3}" style="--size:${size}px"><span>${r.count}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size * 1.2],
    popupAnchor: [0, -size * 1.15],
    tooltipAnchor: [0, -size * 1.15],
  });
}

/** Round count bubble for several countries close together: their shipments added up. */
function clusterIcon(c: L.MarkerCluster) {
  const pins = c.getAllChildMarkers() as PinMarker[];
  const sum = pins.reduce((t, m) => t + m.row.count, 0);
  const size = Math.round(36 + Math.min(20, Math.sqrt(sum) * 2.4));
  return L.divIcon({
    className: s.pinWrap!,
    html: `<div class="${s.cluster}" style="--size:${size}px"><span>${sum}</span></div>`,
    iconSize: [size, size],
  });
}

function popupHtml(r: CountryRow, rank: number, total: number, flow: 'import' | 'export') {
  return `<div class="${s.pop}">
    <div class="${s.popHead}">
      <span class="${s.flag} flag:${esc(r.iso2.toUpperCase())}"></span>
      <b>${esc(r.name)}</b>
      <small>#${rank + 1} of ${total}</small>
    </div>
    <div class="${s.popFig}"><b>${r.count.toLocaleString()}</b> ${r.count === 1 ? 'shipment' : 'shipments'}</div>
    <div class="${s.popSub}">${r.pct}% of ${flow === 'import' ? 'imports (origin)' : 'exports (destination)'}</div>
    <div class="${s.popBar}"><span style="width:${Math.min(100, r.pct)}%"></span></div>
  </div>`;
}

/**
 * Analytics → Shipments by country on a real world map (Leaflet, no API key): white countries
 * on a gray sea with Esri place names, or Esri satellite imagery. One pin per country with its shipment count; nearby countries cluster into one
 * bubble with their total. Pins open a popup; the list beside the map flies to a country.
 */
export function ShipmentsMap({ rows, flow }: { rows: CountryRow[]; flow: 'import' | 'export' }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef(new Map<string, PinMarker>());
  const landRef = useRef<L.GeoJSON | null>(null);
  const [base, setBase] = useState<Base>('map');
  const baseRef = useRef(base);
  baseRef.current = base;
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // The map itself: created once, removed on unmount.
  useEffect(() => {
    const map = L.map(elRef.current!, {
      center: WORLD,
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      zoomControl: false,
      // The land is drawn once (no copies of the world), so keep the view on it.
      maxBounds: [
        [-85, -200],
        [85, 200],
      ],
      maxBoundsViscosity: 0.8,
      preferCanvas: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    // Place names in their own pane: above the land (overlay pane), under the pins.
    map.createPane('labels').style.zIndex = '450';
    map.getPane('labels')!.style.pointerEvents = 'none';
    // Countries from world-atlas: loaded as their own file so the pins don't wait for them.
    // Shown on the Map view only; Satellite has its imagery instead.
    let live = true;
    void fetch(worldUrl)
      .then((r) => r.json() as Promise<Topology>)
      .then((topo) => {
        if (!live) return;
        const land = feature(topo, topo.objects.countries!) as unknown as FeatureCollection;
        landRef.current = L.geoJSON(land, { style: LAND_STYLE, interactive: false });
        if (baseRef.current === 'map') landRef.current.addTo(map);
      });
    const group = L.markerClusterGroup({
      maxClusterRadius: 48,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: clusterIcon,
    });
    // A cluster's tooltip names the countries in it, biggest first.
    group.on('clustermouseover', (e) => {
      const c = (e as unknown as { layer: L.MarkerCluster }).layer;
      const pins = (c.getAllChildMarkers() as PinMarker[])
        .map((m) => m.row)
        .sort((a, b) => b.count - a.count);
      c.bindTooltip(
        pins.map((r) => `${esc(r.name)} <b>${r.count}</b>`).join('<br>') +
          '<br><small>Click to zoom in</small>',
        { direction: 'top', className: s.tip!, offset: [0, -12] },
      ).openTooltip();
    });
    group.addTo(map);
    mapRef.current = map;
    groupRef.current = group;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current!);
    return () => {
      live = false;
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
      landRef.current = null;
    };
  }, []);

  // Map: white land on the gray sea with gray labels. Satellite: imagery with its labels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sat = base === 'satellite';
    const layers = [
      ...(sat ? [L.tileLayer(TILES.satellite, { attribution: ATTR.satellite, maxZoom: 18 })] : []),
      L.tileLayer(sat ? TILES.satelliteLabels : TILES.mapLabels, {
        attribution: sat ? undefined : ATTR.map,
        maxZoom: 18,
        pane: 'labels',
      }),
    ];
    layers.forEach((l) => l.addTo(map));
    const land = landRef.current;
    if (land && sat) land.remove();
    else if (land && !map.hasLayer(land)) land.addTo(map);
    return () => layers.forEach((l) => l.remove());
  }, [base]);

  const fitAll = () => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    const b = group.getBounds();
    if (b.isValid()) map.flyToBounds(b, { padding: [60, 60], maxZoom: 4, duration: 0.8 });
    else map.flyTo(WORLD, 2, { duration: 0.8 });
  };

  // Pins: rebuilt when the period or Import/Export changes.
  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    markersRef.current.clear();
    setSelected(null);
    rows.forEach((r, rank) => {
      const at = PIN_POINTS[r.iso2.toUpperCase()];
      if (!at) return;
      const m = L.marker(at, { icon: pinIcon(r, rank), title: r.name, riseOnHover: true });
      (m as PinMarker).row = r;
      m.bindTooltip(`${esc(r.name)} · <b>${plural(r.count)}</b>`, {
        direction: 'top',
        className: s.tip!,
      });
      m.bindPopup(popupHtml(r, rank, rows.length, flow), {
        className: s.popup!,
        closeButton: true,
        maxWidth: 260,
      });
      m.on('popupopen', () => setSelected(r.iso2));
      m.on('popupclose', () => setSelected((v) => (v === r.iso2 ? null : v)));
      markersRef.current.set(r.iso2, m as PinMarker);
      group.addLayer(m);
    });
    const b = group.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [60, 60], maxZoom: 4 });
    else map.setView(WORLD, 2);
  }, [rows, flow]);

  // Fullscreen on the map frame; Leaflet re-measures when it changes.
  useEffect(() => {
    const onChange = () => {
      setFull(document.fullscreenElement === frameRef.current);
      setTimeout(() => mapRef.current?.invalidateSize(), 50);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen();
  };

  /** From the list: zoom until the country's pin is out of its cluster, then open it. */
  const focus = (iso2: string) => {
    const m = markersRef.current.get(iso2);
    const group = groupRef.current;
    if (!m || !group) return;
    group.zoomToShowLayer(m, () => {
      mapRef.current?.panTo(m.getLatLng(), { animate: true });
      m.openPopup();
    });
  };

  const unmapped = rows.filter((r) => !PIN_POINTS[r.iso2.toUpperCase()]);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className={s.wrap}>
      <div className={s.frame} ref={frameRef} data-full={full || undefined}>
        <div className={s.map} ref={elRef} />
        <div className={s.base} role="group" aria-label="Map type">
          {(['map', 'satellite'] as const).map((b) => (
            <button key={b} type="button" aria-pressed={base === b} onClick={() => setBase(b)}>
              {b === 'map' ? 'Map' : 'Satellite'}
            </button>
          ))}
        </div>
        <div className={s.tools}>
          <button
            type="button"
            onClick={toggleFull}
            title={full ? 'Exit full screen' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={fitAll}
            title="Show all countries"
            aria-label="Show all countries"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              <circle cx="12" cy="12" r="7" />
            </svg>
          </button>
        </div>
      </div>

      <ol
        className={s.list}
        aria-label={flow === 'import' ? 'Origin countries' : 'Destination countries'}
      >
        {rows.map((r, i) => {
          const onMap = !!PIN_POINTS[r.iso2.toUpperCase()];
          return (
            <li key={r.iso2}>
              <button
                type="button"
                data-on={selected === r.iso2 || undefined}
                disabled={!onMap}
                title={onMap ? `Show ${r.name} on the map` : 'No map position for this country'}
                onClick={() => focus(r.iso2)}
              >
                <span className={s.rank}>{i + 1}</span>
                <span className={`${s.flag} flag:${r.iso2.toUpperCase()}`} aria-hidden="true" />
                <span className={s.name}>{r.name}</span>
                <span className={s.val}>
                  <b>{r.count.toLocaleString()}</b> {r.pct}%
                </span>
                <span className={s.bar}>
                  <span style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
              </button>
            </li>
          );
        })}
        {unmapped.length > 0 && (
          <li className={s.note}>Not on the map: {unmapped.map((r) => r.name).join(', ')}</li>
        )}
      </ol>
    </div>
  );
}
