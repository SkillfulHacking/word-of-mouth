export type LatLon = { lat: number; lon: number };

const R = 6371008.8; // mean Earth radius, meters
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Compass word for the direction of `to` as seen from `from`. */
export function compass(from: LatLon, to: LatLon): string {
  const y = Math.sin(rad(to.lon - from.lon)) * Math.cos(rad(to.lat));
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
    Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lon - from.lon));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return POINTS[Math.round(deg / 45) % 8];
}

/** Order points as a nearest-neighbour walk out from `start`. */
export function walkOrder<T extends LatLon>(start: LatLon, points: T[]): T[] {
  const left = [...points];
  const out: T[] = [];
  let here = start;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (distanceM(here, left[i]) < distanceM(here, left[best])) best = i;
    const [next] = left.splice(best, 1);
    out.push(next);
    here = next;
  }
  return out;
}

/** Straight-line loop length start -> points -> start, inflated for paths not being straight. */
export function loopWalkM(start: LatLon, ordered: LatLon[], detour = 1.3): number {
  let total = 0;
  let here = start;
  for (const p of ordered) {
    total += distanceM(here, p);
    here = p;
  }
  total += distanceM(here, start);
  return Math.round(total * detour);
}
