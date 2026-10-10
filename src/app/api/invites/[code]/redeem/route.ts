import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, hashPassword, startSession } from "@/lib/auth";
import { redeemInvite, signUpAndRedeem } from "@/lib/invites";
import { failResponse } from "@/lib/respond";

const Signup = z.object({
  username: z.string().regex(/^[a-z0-9_.-]{3,32}$/i, "Username: 3–32 letters, numbers, . _ -"),
  password: z.string().min(8, "Password needs at least 8 characters.").max(200),
});

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await currentUser();

  // Signed in: claim the ticket for this account.
  if (user) {
    const r = redeemInvite(code, user.id);
    return r.ok ? NextResponse.json({ ticketId: r.ticketId }) : failResponse(r);
  }

  // Not signed in: the invite doubles as sign-up. No account is made unless the invite is good.
  const parsed = Signup.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a username and password." }, { status: 400 });
  }
  const r = signUpAndRedeem(code, parsed.data.username, hashPassword(parsed.data.password));
  if (!r.ok) return failResponse(r);
  await startSession(r.userId);
  return NextResponse.json({ ticketId: r.ticketId }, { status: 201 });
}
