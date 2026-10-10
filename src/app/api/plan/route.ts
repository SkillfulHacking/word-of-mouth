import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { MAX_SPOTS } from "@/lib/limits";
import { chatJson, OLLAMA_MODEL } from "@/lib/ollama";
import { fetchCandidatesCached } from "@/lib/osm-cache";
import { planSpots } from "@/lib/planner";

const Body = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().int().min(100).max(2000).default(300),
  maxWalkM: z.number().int().min(200).max(5000).default(800),
  count: z.number().int().min(1).max(MAX_SPOTS),
  venue: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  title: z.string().max(120).optional(),
  theme: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { lat, lon, radiusM, maxWalkM, count, venue, address, title, theme } = parsed.data;
  const center = { lat, lon };

  let candidates;
  try {
    candidates = await fetchCandidatesCached(center, radiusM);
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't reach the map service: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  try {
    const plan = await planSpots(candidates, { center, count, maxWalkM, theme, secrets: { venue, address, title } }, (s, u, schema) =>
      chatJson(s, u, schema),
    );
    return NextResponse.json({ ...plan, model: plan.source === "model" ? OLLAMA_MODEL : null, candidates: candidates.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Planning failed." }, { status: 422 });
  }
}
