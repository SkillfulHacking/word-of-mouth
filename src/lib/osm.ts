import { distanceM, type LatLon } from "./geo";

export type Candidate = LatLon & { id: string; kind: string; name?: string };

type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: LatLon;
  tags?: Record<string, string>;
};

/** Public mirrors, tried in order. Set OVERPASS_URL (comma-separated) to use your own instance. */
const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const endpoints = () => (process.env.OVERPASS_URL ? process.env.OVERPASS_URL.split(",").map((s) => s.trim()) : DEFAULT_ENDPOINTS);

/**
 * OSM tags that make a good, public, stationary place to leave a sticker or tag.
 * `nwr` matches nodes, ways and relations: pavilions and playgrounds are usually areas, not points.
 */
const SELECTORS = [
  "[amenity=bench]",
  "[leisure=picnic_table]",
  "[tourism=picnic_site]",
  "[amenity=shelter]",
  "[leisure=playground]",
  "[leisure=fitness_station]",
  "[tourism=information]",
  "[tourism=viewpoint]",
  "[tourism=artwork]",
  "[historic]",
  "[amenity=drinking_water]",
  "[sport=disc_golf]",
];

export function kindOf(tags: Record<string, string>): string {
  if (tags.amenity === "bench") return "bench";
  if (tags.leisure === "picnic_table") return "picnic table";
  if (tags.tourism === "picnic_site") return "picnic area";
  if (tags.amenity === "shelter") return tags.shelter_type === "picnic_shelter" ? "picnic shelter" : "shelter";
  if (tags.leisure === "playground") return "playground";
  if (tags.leisure === "fitness_station") return "fitness station";
  if (tags.tourism === "information") return tags.information === "guidepost" ? "guidepost" : "information board";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.tourism === "artwork") return "artwork";
  if (tags.historic) return "historic marker";
  if (tags.amenity === "drinking_water") return "water fountain";
  if (tags.sport === "disc_golf") return "disc golf feature";
  return "landmark";
}

/** Closed or private things are bad places to ask people to go. */
export function isPublic(tags: Record<string, string>): boolean {
  return !/^(private|no|customers|permit)$/.test(tags.access ?? "") && tags.disused !== "yes";
}

export function toCandidates(elements: Element[]): Candidate[] {
  const out: Candidate[] = [];
  for (const e of elements) {
    if (!e.tags || !isPublic(e.tags)) continue;
    const pos = e.type === "node" ? { lat: e.lat, lon: e.lon } : e.center;
    if (pos?.lat === undefined || pos?.lon === undefined) continue;
    out.push({
      id: `${e.type}/${e.id}`,
      lat: pos.lat,
      lon: pos.lon,
      kind: kindOf(e.tags),
      ...(e.tags.name ? { name: e.tags.name } : {}),
    });
  }
  return out;
}

/** Keep one candidate per `minGapM` so ten benches in a row don't crowd out everything else. */
export function thin(candidates: Candidate[], center: LatLon, minGapM: number, max: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => distanceM(center, a) - distanceM(center, b));
  const kept: Candidate[] = [];
  for (const c of sorted) {
    if (kept.every((k) => distanceM(k, c) >= minGapM)) kept.push(c);
    if (kept.length >= max) break;
  }
  return kept;
}

export async function fetchCandidates(center: LatLon, radiusM: number): Promise<Candidate[]> {
  const around = `(around:${Math.round(radiusM)},${center.lat},${center.lon})`;
  const query = `[out:json][timeout:25];(${SELECTORS.map((s) => `nwr${around}${s};`).join("")});out center tags 500;`;
  const errors: string[] = [];
  // Two passes over the mirrors with a pause between: a busy server often recovers within seconds.
  for (let pass = 1; pass <= 2; pass++) {
    if (pass === 2) await new Promise((r) => setTimeout(r, 4000));
    for (const url of endpoints()) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "word-of-mouth/0.1 (hacktoberfest demo)" },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(30_000),
        });
        // A busy Overpass can answer 200 with an HTML error page, so check what actually came back.
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.includes("json")) {
          if (pass === 2) errors.push(`${new URL(url).host}: ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { elements?: Element[] };
        return toCandidates(json.elements ?? []);
      } catch (e) {
        if (pass === 2) errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  throw new Error(`all map servers failed twice (${errors.join("; ")})`);
}
