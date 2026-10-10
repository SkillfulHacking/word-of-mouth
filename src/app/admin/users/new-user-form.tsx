"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewUserForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setBusy(true);
    setError("");
    const form = new FormData(formEl);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    setBusy(false);
    if (res.ok) {
      formEl.reset();
      router.refresh();
    } else {
      setError((await res.json().catch(() => null))?.error ?? "Could not create user.");
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <label htmlFor="nu-username">Username</label>
      <input id="nu-username" name="username" required />
      <label htmlFor="nu-password">Temporary password (8+ characters)</label>
      <input id="nu-password" name="password" type="password" minLength={8} required />
      <label htmlFor="nu-role">Role</label>
      <select id="nu-role" name="role" defaultValue="attendee">
        <option value="admin">admin – everything, plus users</option>
        <option value="coordinator">coordinator – events, shards, invites</option>
        <option value="promoter">promoter – hands out invites</option>
        <option value="attendee">attendee – holds a ticket</option>
      </select>
      {error && <p className="error">{error}</p>}
      <p>
        <button disabled={busy}>{busy ? "Adding…" : "Add user"}</button>
      </p>
    </form>
  );
}
