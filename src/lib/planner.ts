import { z } from "zod";
import { compass, distanceM, loopWalkM, walkOrder, type LatLon } from "./geo";
import { thin, type Candidate } from "./osm";

export const MIN_GAP_M = 40;
const MAX_OFFERED = 30;

export type PlannedSpot = { label: string; clue: string; lat: number; lon: number; osmRef: string };
export type Plan = {
  spots: PlannedSpot[];
  walkM: number;
  source: "model" | "fallback";
  warnings: string[];
};
export type PlanInput = {
  center: LatLon;
  count: number;
  /** Longest acceptable loop (start -> every spot -> start), in meters. */
  maxWalkM: number;
  /** Tone for the flavor lines, e.g. "cold-war spy thriller". */
  theme?: string;
  /** Event venue, address and title: the clues must not give these away. */
  secrets: { venue?: string; address?: string; title?: string };
};

// The model writes only `flavor`; the factual half of each public clue is built by code (see hint()).
const PickSchema = z.object({ spots: z.array(z.object({ id: z.string(), flavor: z.string() })) });
export type Ask = <T>(system: string, user: string, schema: z.ZodType<T>) => Promise<T>;

/** Strings a clue must never contain: the full secrets, plus long words from venue/address. */
export function leakTerms(s: PlanInput["secrets"]): string[] {
  const terms = new Set<string>();
  for (const full of [s.venue, s.address, s.title]) {
    const t = full?.trim().toLowerCase();
    if (t && t.length >= 3) terms.add(t);
  }
  for (const part of [s.venue, s.address]) {
    for (const w of part?.toLowerCase().split(/[^a-z0-9]+/) ?? []) {
      if (w.length >= 5 || /^\d{2,}$/.test(w)) terms.add(w);
    }
  }
  return [...terms];
}

export function findLeaks(text: string, terms: string[]): string[] {
  const hay = text.toLowerCase();
  return terms.filter((t) => hay.includes(t));
}

export function describe(c: Candidate, center: LatLon): string {
  const where = `${Math.round(distanceM(center, c) / 10) * 10} m ${compass(center, c)} of the start`;
  return `${c.kind}${c.name ? ` "${c.name}"` : ""}, ${where}`;
}

/**
 * Concrete things a small model likes to claim are at a spot. If one shows up in a flavor line and isn't in
 * the real data for that spot, we reject the line. This is a heuristic, not proof of grounding; the host still reviews clues.
 */
const INVENTED = ["oak", "maple", "pine", "willow", "tree", "trees", "river", "creek", "stream", "valley", "hill", "mountain", "forest", "meadow", "grass", "grasses", "squirrel", "dial", "antenna"];

const DIRECTION = /\b(north|south|east|west|northeast|southeast|northwest|southwest|left|right)\b/i;

export function inventedWords(flavor: string, allowed: string): string[] {
  const ok = allowed.toLowerCase();
  return flavor
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => INVENTED.includes(w) && !ok.includes(w));
}

/** The factual half of a public clue. Built by code, so it can't be hallucinated. */
export function hint(c: Candidate, center: LatLon): string {
  return `${c.kind}${c.name ? ` "${c.name}"` : ""}, about ${Math.round(distanceM(center, c) / 10) * 10} m ${compass(center, c)} of the start`;
}

/** Nearest different-kind thing within 70 m, as a grounded detail the model may use. */
export function nearby(c: Candidate, all: Candidate[]): string | undefined {
  let best: Candidate | undefined;
  for (const o of all) {
    if (o === c || o.kind === c.kind) continue;
    if (distanceM(c, o) <= 70 && (!best || distanceM(c, o) < distanceM(c, best))) best = o;
  }
  return best ? `${best.kind}${best.name ? ` "${best.name}"` : ""}` : undefined;
}

/** Everything a model pick must satisfy before we trust it. Returns human-readable problems. */
export function checkPick(
  pick: z.infer<typeof PickSchema>,
  byId: Map<string, Candidate>,
  input: PlanInput,
  terms: string[],
): string[] {
  const { count, center, maxWalkM } = input;
  const problems: string[] = [];
  if (pick.spots.length !== count) problems.push(`You returned ${pick.spots.length} spots; exactly ${count} are required.`);
  const seen = new Set<string>();
  const chosen: Candidate[] = [];
  const all = [...byId.values()];
  for (const s of pick.spots) {
    const c = byId.get(s.id);
    if (!c) {
      problems.push(`"${s.id}" is not in the candidate list. Use only ids you were given.`);
      continue;
    }
    if (seen.has(s.id)) problems.push(`"${s.id}" was chosen twice.`);
    seen.add(s.id);
    chosen.push(c);
    const leaks = findLeaks(s.flavor, terms);
    if (leaks.length) problems.push(`The line for ${s.id} contains secret text (${leaks.map((l) => `"${l}"`).join(", ")}). Rewrite it.`);
    if (s.flavor.trim().length < 12) problems.push(`The line for ${s.id} is too short.`);
    if (DIRECTION.test(s.flavor)) problems.push(`The line for ${s.id} mentions a direction. Do not; directions are added automatically.`);
    if (/\d/.test(s.flavor)) problems.push(`The line for ${s.id} contains a number. Remove it.`);
    const made = inventedWords(s.flavor, `${c.kind} ${c.name ?? ""} ${nearby(c, all) ?? ""}`);
    if (made.length) problems.push(`The line for ${s.id} mentions ${made.map((w) => `"${w}"`).join(", ")}, which is not in the data. Use only the facts given.`);
  }
  for (let i = 0; i < chosen.length; i++)
    for (let j = i + 1; j < chosen.length; j++)
      if (distanceM(chosen[i], chosen[j]) < MIN_GAP_M)
        problems.push(`${chosen[i].id} and ${chosen[j].id} are under ${MIN_GAP_M} m apart. Spread the spots out.`);
  if (chosen.length === count) {
    const walk = loopWalkM(center, walkOrder(center, chosen));
    if (walk > maxWalkM) problems.push(`That loop is about ${walk} m; the limit is ${maxWalkM} m. Pick spots closer together or closer to the start.`);
  }
  return problems;
}

/** Farthest-point sampling: a spread-out set with no model involved. */
export function spreadPick(offered: Candidate[], center: LatLon, count: number, maxWalkM: number): Candidate[] {
  if (offered.length === 0) return [];
  const picked: Candidate[] = [offered[0]];
  while (picked.length < Math.min(count, offered.length)) {
    let best: Candidate | null = null;
    let bestScore = -1;
    for (const c of offered) {
      if (picked.includes(c)) continue;
      // Only consider spots that keep the loop inside the budget.
      if (loopWalkM(center, walkOrder(center, [...picked, c])) > maxWalkM) continue;
      const score = Math.min(...picked.map((p) => distanceM(p, c)));
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked;
}

const SYSTEM = `You help a host hide QR codes and NFC tags for a private-party scavenger hunt.
You are given real map points near a starting spot. Pick some and write one short themed "flavor" line for each.
Rules:
- Choose ONLY ids from the list. Never invent a place.
- Keep the walk short: the loop from the start through every pick and back must stay within the walk limit. Prefer picks near the start, spread in different directions, with a mix of kinds.
- A flavor line is ONE short sentence, 6 to 15 words, written in the requested theme. It is atmosphere only: do NOT describe the surroundings, the object, the view, the weather, or where anything is. No directions, no numbers, no scenery. The location facts are added separately.
- Good lines make no claim about the place, for example: "The courier never signs the ledger." / "Whoever finds this was meant to." / "Keep your voice low and your eyes lower." Match the theme in the same way.
- Vary the lines. Never repeat the same opening words.
- Never include any of the forbidden words.
- Do not mention ids or the party.`;

function userPrompt(offered: Candidate[], input: PlanInput, terms: string[], problems: string[]): string {
  const { center, count, maxWalkM } = input;
  const lines = offered.map((c) => {
    const near = nearby(c, offered);
    return {
      id: c.id,
      kind: c.kind,
      ...(c.name ? { name: c.name } : {}),
      ...(near ? { near } : {}),
      meters_from_start: Math.round(distanceM(center, c)),
      direction_from_start: compass(center, c),
    };
  });
  return [
    `Theme: ${input.theme?.trim() || "cold-war spy thriller"}`,
    `Pick exactly ${count} points. The loop (start -> all picks -> start) must be under ${maxWalkM} meters of walking; assume paths are about 30% longer than straight lines.`,
    `Forbidden words: ${terms.length ? terms.join(", ") : "(none)"}`,
    problems.length ? `Your previous answer had problems. Fix them:\n- ${problems.join("\n- ")}` : "",
    `Candidates:\n${JSON.stringify(lines)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Public clue = model flavor + a factual hint written by code, so a bad line can't make the hunt unsolvable.
 * The hint is built after the model's answer is checked, so it gets its own leak check: map features are often
 * named after the very place the event is secretly at (e.g. a mall's own information board).
 */
function toSpot(c: Candidate, center: LatLon, flavor: string, terms: string[]): PlannedSpot {
  const named = hint(c, center);
  const safe = findLeaks(named, terms).length ? hint({ ...c, name: undefined }, center) : named;
  const clue = flavor ? `${flavor.trim().replace(/[.!?]*$/, ".")} (${safe})` : `Find the ${safe}.`;
  return { label: describe(c, center), clue, lat: c.lat, lon: c.lon, osmRef: c.id };
}

function finish(spots: PlannedSpot[], center: LatLon, source: Plan["source"], warnings: string[]): Plan {
  const ordered = walkOrder(center, spots);
  return { spots: ordered, walkM: loopWalkM(center, ordered), source, warnings };
}

export async function planSpots(candidates: Candidate[], input: PlanInput, ask: Ask): Promise<Plan> {
  const { center, count } = input;
  const offered = thin(candidates, center, MIN_GAP_M, MAX_OFFERED);
  if (offered.length < count) {
    throw new Error(
      `Only ${offered.length} usable map points found near there (need ${count}). Try a bigger radius or fewer spots.`,
    );
  }
  const byId = new Map(offered.map((c) => [c.id, c]));
  const terms = leakTerms(input.secrets);

  let problems: string[] = [];
  const warnings: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const pick = await ask(SYSTEM, userPrompt(offered, input, terms, problems), PickSchema);
      problems = checkPick(pick, byId, input, terms);
      if (problems.length === 0) {
        return finish(pick.spots.map((s) => toSpot(byId.get(s.id)!, center, s.flavor, terms)), center, "model", warnings);
      }
      warnings.push(`Model attempt ${attempt} rejected: ${problems.join(" ")}`);
    } catch (e) {
      warnings.push(`Model attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
      break; // a connection or parse error won't fix itself on retry
    }
  }

  // Fallback keeps the feature usable with the model offline: real spots, plain factual clues.
  const picked = spreadPick(offered, center, count, input.maxWalkM);
  if (picked.length < count) {
    throw new Error(
      `Couldn't fit ${count} spots inside a ${input.maxWalkM} m walk here. Allow a longer walk, use a bigger radius, or fewer spots.` +
        (warnings.length ? ` (${warnings.join(" ")})` : ""),
    );
  }
  warnings.push("Used the plain fallback: clues are plain facts, no riddles. Edit them before printing.");
  return finish(picked.map((c) => toSpot(c, center, "", terms)), center, "fallback", warnings);
}
