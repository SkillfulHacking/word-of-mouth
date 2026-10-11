import type { LatLon } from "./geo";

/** Parse two text fields into a coordinate, or null if either is empty, not a number, or out of range. */
export function parseCoords(lat: string, lon: string): LatLon | null {
  if (lat.trim() === "" || lon.trim() === "") return null;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lon: b };
}

/** Five decimals is about 1 m, which is as precise as a map click can be. */
export function formatCoord(n: number): string {
  return n.toFixed(5);
}

/** Leaflet can report longitudes outside -180..180 after panning across the date line. */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** "lat,lon,zoom" (zoom optional) from an environment variable, for where the map first opens. */
export function parseMapCenter(value: string | undefined): { lat: number; lon: number; zoom: number } | null {
  if (!value) return null;
  const [a, b, z] = value.split(",").map((s) => s.trim());
  const c = parseCoords(a ?? "", b ?? "");
  if (!c) return null;
  const zoom = z ? Number(z) : 13;
  return { ...c, zoom: Number.isFinite(zoom) ? Math.min(18, Math.max(1, Math.round(zoom))) : 13 };
}

/** The default tile server needs {z}/{x}/{y}; anything else is a typo we should not silently load. */
export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function resolveTileUrl(value: string | undefined): string {
  const v = value?.trim();
  if (!v) return DEFAULT_TILE_URL;
  return /^https?:\/\//.test(v) && v.includes("{z}") && v.includes("{x}") && v.includes("{y}") ? v : DEFAULT_TILE_URL;
}
