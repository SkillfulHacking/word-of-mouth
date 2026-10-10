import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { LogoutButton } from "./logout-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Word of Mouth",
  description: "Private events you can only find by walking to them.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Word of Mouth
          </Link>
          {user ? (
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="muted">
                {user.username} <span className="pill">{user.role}</span>
              </span>
              <LogoutButton />
            </span>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
