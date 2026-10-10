import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { revokeInvite } from "@/lib/invites";
import { failResponse } from "@/lib/respond";

export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const actor = await apiUser("promoter", "coordinator");
  if (actor instanceof NextResponse) return actor;
  const { code } = await params;
  const r = revokeInvite(actor, code);
  return r.ok ? NextResponse.json({ ok: true }) : failResponse(r);
}
