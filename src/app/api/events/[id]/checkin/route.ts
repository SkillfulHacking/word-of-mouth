import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCheckin } from "@/lib/door";
import { failResponse } from "@/lib/respond";

const Body = z.object({ challenge: z.string().max(64), proof: z.unknown() });

// Deliberately does NOT read the session cookie. The proof is the credential, and the server
// never learns which account made it, so a check-in can't be tied back to a ticket.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a door code and a pass." }, { status: 400 });
  const { id } = await params;
  const r = await verifyCheckin(id, parsed.data.challenge, parsed.data.proof);
  return r.ok ? NextResponse.json({ ok: true }) : failResponse(r);
}
