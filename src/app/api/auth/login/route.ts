import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, startSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";

const Body = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });

// Verified against this when the username doesn't exist, so timing doesn't reveal valid usernames.
const DUMMY_HASH = hashPassword("not-a-real-password");

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Username and password required." }, { status: 400 });

  const row = db
    .prepare("SELECT id, pass_hash FROM users WHERE username = ?")
    .get(parsed.data.username.toLowerCase()) as { id: number; pass_hash: string } | undefined;
  const ok = verifyPassword(parsed.data.password, row?.pass_hash ?? DUMMY_HASH);
  if (!row || !ok) return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });

  await startSession(row.id);
  return NextResponse.json({ ok: true });
}
