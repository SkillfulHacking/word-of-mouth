"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThemePicker } from "@/components/theme-picker";

export function LookAndFeel({ eventId, initial }: { eventId: string; initial: string }) {
  const router = useRouter();
  const [theme, setTheme] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function save() {
    setState("saving");
    setError("");
    const res = await fetch(`/api/events/${eventId}/theme`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme }),
    });
    if (res.ok) {
      setState("saved");
      router.refresh();
    } else {
      setState("idle");
      setError((await res.json().catch(() => null))?.error ?? "Couldn't save the theme.");
    }
  }

  return (
    <div className="card">
      <ThemePicker value={theme} onChange={(v) => { setTheme(v); setState("idle"); }} />
      <p style={{ marginBottom: 0 }}>
        <button type="button" onClick={save} disabled={state === "saving" || theme === initial && state !== "idle"}>
          {state === "saving" ? "Saving…" : "Save theme"}
        </button>{" "}
        {state === "saved" && <span role="status" className="muted">Saved. Guests see it right away.</span>}
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
