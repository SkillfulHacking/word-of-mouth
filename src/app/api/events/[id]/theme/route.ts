import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { setEventTheme } from "@/lib/event-admin";
import { failResponse } from "@/lib/respond";

const Body = z.object({ theme: z.string().max(60) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a theme." }, { status: 400 });
  const { id } = await params;
  const r = setEventTheme(actor, id, parsed.data.theme);
  return r.ok ? NextResponse.json({ ok: true }) : failResponse(r);
}
