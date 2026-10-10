import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { mintBatch } from "@/lib/invites";
import { MAX_BATCH } from "@/lib/limits";
import { failResponse } from "@/lib/respond";

const Body = z.object({ count: z.number().int().min(1).max(MAX_BATCH), note: z.string().max(80).default("") });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("promoter", "coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Choose between 1 and ${MAX_BATCH} invites.` }, { status: 400 });
  const { id } = await params;
  const r = mintBatch(actor, id, parsed.data.count, parsed.data.note);
  return r.ok ? NextResponse.json({ batch: r.batch, count: r.codes.length }, { status: 201 }) : failResponse(r);
}
