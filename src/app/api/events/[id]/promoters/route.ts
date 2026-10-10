import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { setPromoterQuota } from "@/lib/invites";
import { failResponse } from "@/lib/respond";

const Body = z.object({ promoterId: z.number().int().positive(), quota: z.number().int().min(0).max(100) });

// quota 0 removes the promoter from the event
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a promoter and a quota from 0 to 100." }, { status: 400 });
  const { id } = await params;
  const r = setPromoterQuota(actor, id, parsed.data.promoterId, parsed.data.quota);
  return r.ok ? NextResponse.json({ ok: true }) : failResponse(r);
}
