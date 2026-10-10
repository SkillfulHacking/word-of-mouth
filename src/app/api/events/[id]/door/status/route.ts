import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { doorStatus } from "@/lib/door";
import { failResponse } from "@/lib/respond";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  const challenge = new URL(req.url).searchParams.get("c") ?? "";
  const r = doorStatus(actor, id, challenge);
  return r.ok ? NextResponse.json(r.status, { headers: { "cache-control": "no-store" } }) : failResponse(r);
}
