import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { createChallenge } from "@/lib/door";
import { failResponse } from "@/lib/respond";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  const r = createChallenge(actor, id);
  return r.ok ? NextResponse.json({ challenge: r.challenge, expiresAt: r.expiresAt }, { status: 201 }) : failResponse(r);
}
