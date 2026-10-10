import { db } from "./db";
import type { LatLon } from "./geo";
import { fetchCandidates, type Candidate } from "./osm";

const TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Cached wrapper around fetchCandidates. The key rounds the center to ~11 m so nudging the pin
 * a little still hits the cache. Parks change slowly, so a week is plenty.
 */
export async function fetchCandidatesCached(center: LatLon, radiusM: number): Promise<Candidate[]> {
  const key = `${center.lat.toFixed(4)},${center.lon.toFixed(4)},${Math.round(radiusM)}`;
  const hit = db
    .prepare("SELECT body FROM osm_cache WHERE key = ? AND fetched_at > unixepoch() - ?")
    .get(key, TTL_SECONDS) as { body: string } | undefined;
  if (hit) return JSON.parse(hit.body) as Candidate[];

  const fresh = await fetchCandidates(center, radiusM);
  db.prepare("INSERT OR REPLACE INTO osm_cache (key, body, fetched_at) VALUES (?, ?, unixepoch())").run(
    key,
    JSON.stringify(fresh),
  );
  return fresh;
}
