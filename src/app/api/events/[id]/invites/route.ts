import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { mintInvite } from "@/lib/invites";
import { failResponse } from "@/lib/respond";

const Body = z.object({ note: z.string().max(80).default("") });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("promoter", "coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Note must be 80 characters or fewer." }, { status: 400 });
  const { id } = await params;
  const r = mintInvite(actor, id, parsed.data.note);
  return r.ok ? NextResponse.json({ code: r.code }, { status: 201 }) : failResponse(r);
}
