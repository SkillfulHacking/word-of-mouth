"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptForm({ code, signedInAs }: { code: string; signedInAs: string | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/invites/${code}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedInAs ? {} : { username: f.get("username"), password: f.get("password") }),
    });
    if (res.ok) {
      router.push("/tickets");
      router.refresh();
    } else {
      setError((await res.json().catch(() => null))?.error ?? "Couldn't accept the invite.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      {signedInAs ? (
        <p>
          Accepting as <strong>{signedInAs}</strong>.
        </p>
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>Make an account to claim your ticket</h2>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required />
          <label htmlFor="password">Password (8+ characters)</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <p className="muted">
            Already have an account? <a href="/login">Sign in</a> first, then open this link again.
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{busy ? "Claiming…" : "Accept invitation"}</button>
    </form>
  );
}
