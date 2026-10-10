import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { guestListFor } from "@/lib/door";
import { failResponse } from "@/lib/respond";

// The guest list is a list of public commitments. Ticket holders need it to build their proof.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const r = guestListFor(user.id, id);
  return r.ok ? NextResponse.json({ commitments: r.commitments }, { headers: { "cache-control": "no-store" } }) : failResponse(r);
}
