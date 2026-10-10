import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { passStatus, registerPass } from "@/lib/door";
import { failResponse } from "@/lib/respond";

// Any signed-in ticket holder. Only the PUBLIC commitment ever reaches the server.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  return NextResponse.json(passStatus(user.id, id));
}

const Body = z.object({ commitment: z.string().max(100) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a valid pass." }, { status: 400 });
  const { id } = await params;
  const r = registerPass(user.id, id, parsed.data.commitment);
  return r.ok ? NextResponse.json({ ok: true }, { status: 201 }) : failResponse(r);
}
