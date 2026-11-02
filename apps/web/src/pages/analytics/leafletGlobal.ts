import L from 'leaflet';

// leaflet.markercluster is a UMD plugin that extends the global `L`; import this module
// before it so the plugin finds Leaflet.
(window as unknown as { L: typeof L }).L = L;
