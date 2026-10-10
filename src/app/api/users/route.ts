import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, hashPassword } from "@/lib/auth";
import { db, ROLES } from "@/lib/db";

const Body = z.object({
  username: z.string().regex(/^[a-z0-9_.-]{3,32}$/i, "3–32 letters, numbers, . _ -"),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES),
});

export async function POST(req: Request) {
  const actor = await apiUser("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { username, password, role } = parsed.data;
  try {
    db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)").run(
      username.toLowerCase(),
      hashPassword(password),
      role,
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "That username is taken." }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
