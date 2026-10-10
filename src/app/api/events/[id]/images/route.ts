import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { ASPECTS } from "@/lib/comfy";
import { listImages, MAX_PER_REQUEST, startImages } from "@/lib/event-images";
import { failResponse } from "@/lib/respond";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  const r = listImages(actor, id);
  return r.ok ? NextResponse.json({ images: r.images }, { headers: { "cache-control": "no-store" } }) : failResponse(r);
}

const Body = z.object({
  prompt: z.string().min(1).max(800),
  aspect: z.enum(Object.keys(ASPECTS) as [keyof typeof ASPECTS, ...(keyof typeof ASPECTS)[]]),
  count: z.number().int().min(1).max(MAX_PER_REQUEST),
  negative: z.string().max(400).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the scene, pick a shape, and choose 1 to 4 pictures." }, { status: 400 });
  const { id } = await params;
  const r = await startImages(actor, id, parsed.data);
  return r.ok ? NextResponse.json({ ids: r.ids }, { status: 202 }) : failResponse(r);
}
