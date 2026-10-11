"use client";

import { useCallback, useEffect, useState } from "react";

type Img = { id: string; prompt: string; width: number; height: number; status: "running" | "done" | "failed"; error: string | null; selected: number };
type Status = { ok: true; device: string; vramGb: number | null; checkpoint: string; checkpoints: string[]; fast: boolean } | { ok: false; error: string };

// Same rule the server uses to pick sampler settings: distilled models need only a few steps.
const isFast = (name: string) => /lightning|hyper|turbo|lcm|schnell/i.test(name);

const ASPECTS = [
  ["landscape", "Landscape banner (wide)"],
  ["portrait", "Portrait poster (tall)"],
  ["square", "Square"],
] as const;

async function errorOf(res: Response, fallback: string) {
  return (await res.json().catch(() => null))?.error ?? fallback;
}

export function ImageStudio({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [idea, setIdea] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number][0]>("landscape");
  const [count, setCount] = useState(2);
  const [checkpoint, setCheckpoint] = useState(""); // empty = the server's default
  const [writing, setWriting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/images`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setImages((await res.json()).images);
  }, [eventId]);

  useEffect(() => {
    void load();
    fetch("/api/comfy/status", { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => setStatus({ ok: false, error: "Couldn't check ComfyUI." }));
  }, [load]);

  // While anything is being made, check back every couple of seconds.
  const working = images.some((i) => i.status === "running");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [working, load]);

  async function writePrompt() {
    setWriting(true);
    setError("");
    const res = await fetch(`/api/events/${eventId}/images/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea }) });
    if (res.ok) setPrompt((await res.json()).prompt);
    else setError(await errorOf(res, "Couldn't write a prompt."));
    setWriting(false);
  }

  async function generate() {
    setStarting(true);
    setError("");
    const res = await fetch(`/api/events/${eventId}/images`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, aspect, count, ...(checkpoint ? { checkpoint } : {}) }) });
    if (!res.ok) setError(await errorOf(res, "Couldn't start."));
    await load();
    setStarting(false);
  }

  async function act(id: string, what: "select" | "unselect" | "delete") {
    setError("");
    const res = what === "delete"
      ? await fetch(`/api/events/${eventId}/images/${id}`, { method: "DELETE" })
      : await fetch(`/api/events/${eventId}/images/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: what }) });
    if (!res.ok) setError(await errorOf(res, "That didn't work."));
    await load();
  }

  return (
    <div className="card">
      {status === null && <p className="muted">Checking ComfyUI…</p>}
      {status?.ok && (
        <p className="muted" style={{ marginTop: 0 }}>
          Connected to ComfyUI on <strong>{status.device}</strong>{status.vramGb ? ` (${status.vramGb} GB)` : ""}.
        </p>
      )}
      {status && !status.ok && (
        <p className="error" role="alert" style={{ marginTop: 0 }}>
          {status.error} Set <code>COMFYUI_URL</code> to where ComfyUI is running.
        </p>
      )}

      <p role="note" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
        The picture you choose is shown to <strong>everyone</strong> on the invite, hunt and unlock pages, and on printed invites. Don&apos;t describe the venue or
        put the address in the prompt: the app doesn&apos;t keep those after you create the event, so it can&apos;t check for you. AI pictures can also contain
        garbled lettering, so look closely before you choose one. Words like &ldquo;poster&rdquo;, &ldquo;banner&rdquo; and &ldquo;invitation&rdquo; are removed
        automatically because they make the model paint fake text.
      </p>

      <label htmlFor="idea">Mood, in a few words (your local model writes the prompt)</label>
      <div className="row">
        <input id="idea" value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={300} placeholder="spooky but fun, candlelight, pumpkins" />
        <button type="button" className="secondary" onClick={writePrompt} disabled={writing || idea.trim().length < 3} style={{ flex: "none" }}>
          {writing ? "Writing…" : "Write the prompt"}
        </button>
      </div>

      <label htmlFor="prompt">Prompt (edit it however you like)</label>
      <textarea id="prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={800} placeholder="glowing carved pumpkins on a dark candlelit table, drifting mist, purple and orange lighting, digital illustration, wide scene" />

      {status?.ok && status.checkpoints.length > 0 && (
        <>
          <label htmlFor="checkpoint">Model on your ComfyUI</label>
          <select id="checkpoint" value={checkpoint || status.checkpoint} onChange={(e) => setCheckpoint(e.target.value)}>
            {status.checkpoints.map((c) => (
              <option key={c} value={c}>
                {c}
                {isFast(c) ? " (fast)" : " (slower, more steps)"}
                {c === status.checkpoint ? " - default" : ""}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: 4, fontSize: "0.85rem" }}>
            Read from ComfyUI just now. Picture sizes are set for SDXL-style models. To change the default, set <code>COMFYUI_CHECKPOINT</code>.
          </p>
        </>
      )}

      <div className="row">
        <div>
          <label htmlFor="aspect">Shape</label>
          <select id="aspect" value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
            {ASPECTS.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="count">How many to try</label>
          <select id="count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={generate} disabled={starting || prompt.trim().length < 10 || !(status?.ok ?? false)} style={{ flex: "none", alignSelf: "end" }}>
          {starting ? "Starting…" : `Make ${count} picture${count === 1 ? "" : "s"}`}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 16 }}>
          {images.map((img) => (
            <figure key={img.id} className="card" style={{ margin: 0, padding: 10 }}>
              <div style={{ aspectRatio: `${img.width} / ${img.height}`, background: "var(--line)", borderRadius: 8, overflow: "hidden", display: "grid", placeItems: "center", maxHeight: 320 }}>
                {img.status === "done" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/images/${img.id}?v=web`} alt={`Generated picture: ${img.prompt.slice(0, 90)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : img.status === "running" ? (
                  <span role="status" className="muted">Making this one…</span>
                ) : (
                  <span className="error" style={{ padding: 8, fontSize: "0.85rem" }}>{img.error ?? "Failed."}</span>
                )}
              </div>
              <figcaption style={{ marginTop: 8 }}>
                {img.selected === 1 && <span className="pill">Event image</span>}
                <div className="row" style={{ marginTop: 6 }}>
                  {img.status === "done" && (img.selected === 1 ? (
                    <button type="button" className="secondary" onClick={() => act(img.id, "unselect")}>Remove from event</button>
                  ) : (
                    <button type="button" onClick={() => act(img.id, "select")}>Use as event image</button>
                  ))}
                  {img.status === "done" && (
                    <a className="btn secondary" href={`/api/images/${img.id}?v=full`} download={`event-image-${img.id}.png`}>Download</a>
                  )}
                  {img.status !== "running" && <button type="button" className="secondary" onClick={() => act(img.id, "delete")}>Delete</button>}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
