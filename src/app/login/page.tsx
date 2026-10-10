"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError((await res.json().catch(() => null))?.error ?? "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Sign in</h1>
      <form onSubmit={submit} className="card">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error && <p className="error">{error}</p>}
        <p>
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </p>
      </form>
    </>
  );
}
