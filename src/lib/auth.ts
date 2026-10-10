import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, type Role, type User } from "./db";
import { hashPassword, verifyPassword } from "./password";

export { hashPassword, verifyPassword };

const COOKIE = "wom_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function startSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    sha256(token),
    userId,
    expires,
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > unixepoch()`,
    )
    .get(sha256(token)) as User | undefined;
  return row ?? null;
}

/** Admin can do everything; everyone else needs one of the listed roles. */
export function can(user: User | null, ...roles: Role[]): user is User {
  return !!user && (user.role === "admin" || roles.includes(user.role));
}

/** For route handlers: returns the user, or a ready-made error response. */
export async function apiUser(...roles: Role[]): Promise<User | NextResponse> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(user, ...roles)) return NextResponse.json({ error: "Not allowed for your role." }, { status: 403 });
  return user;
}
