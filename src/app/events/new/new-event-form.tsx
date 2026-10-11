"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MapPicker } from "@/components/map-picker";
import { OsmCredit } from "@/components/osm-credit";
import { ThemePicker } from "@/components/theme-picker";
import { parseCoords } from "@/lib/map-input";
import { MAX_SPOTS } from "@/lib/limits";

// lat/lon are strings while editing so a half-typed number doesn't fight the user.
type Spot = { label: string; clue: string; lat: string; lon: string; osmRef: string };
type PlannedSpot = { label: string; clue: string; lat: number; lon: number; osmRef: string };
type PlanResult = { spots: PlannedSpot[]; walkM: number; source: "model" | "fallback"; model: string | null; warnings: string[] };

const blank = (): Spot => ({ label: "", clue: "", lat: "", lon: "", osmRef: "" });

const WALKS = [
  { m: 600, name: "Short: about 600 m" },
  { m: 1200, name: "Medium: about 1.2 km" },
  { m: 2400, name: "Long: about 2.4 km" },
];

const mapLink = (s: Spot) =>
  s.lat && s.lon && !Number.isNaN(Number(s.lat)) && !Number.isNaN(Number(s.lon))
    ? `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=19/${s.lat}/${s.lon}`
    : null;

// A fictional party at a real public mall. Nothing here is a real event or a real tenant.
const DEMO = {
  codename: "Operation Pumpkin Ledger",
  zip: "13204",
  title: "Halloween Costume Party",
  startsAt: "2026-10-31T19:00",
  venue: "Freddy Fazbear's Pizza (fictional demo venue), Destiny USA",
  address: "9090 Destiny USA Dr, Syracuse, NY 13204",
  notes: "Costumes required. Show your ticket at the door. This is a demo event, not a real party.",
  lat: "43.0693",
  lon: "-76.1727",
  theme: "spooky Halloween costume party",
};

export function NewEventForm({ tileUrl, fallbackCenter }: { tileUrl: string; fallbackCenter: { lat: number; lon: number; zoom: number } }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [spots, setSpots] = useState<Spot[]>([blank(), blank(), blank()]);
  const [threshold, setThreshold] = useState(2);
  const [eventTheme, setEventTheme] = useState("default"); // the look of the event pages (not the AI clue theme below)
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // AI planner state
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radiusM, setRadiusM] = useState(600);
  const [maxWalkM, setMaxWalkM] = useState(1200);
  const [theme, setTheme] = useState("cold-war spy thriller");
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [fitKey, setFitKey] = useState(0); // bumped to zoom the map to the suggested spots

  const setSpot = (i: number, patch: Partial<Spot>) =>
    setSpots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  // Editing a coordinate by hand means it's no longer the map point the planner found.
  const setCoord = (i: number, patch: Partial<Pick<Spot, "lat" | "lon">>) => setSpot(i, { ...patch, osmRef: "" });

  function resize(n: number) {
    setSpots((all) => (n <= all.length ? all.slice(0, n) : [...all, ...Array.from({ length: n - all.length }, blank)]));
    setThreshold((t) => Math.min(t, n));
  }

  function locate(apply: (lat: string, lon: string) => void, fail: (msg: string) => void) {
    if (!navigator.geolocation) return fail("This browser can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => apply(p.coords.latitude.toFixed(5), p.coords.longitude.toFixed(5)),
      () => fail("Couldn't get your location. Enter coordinates by hand."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function fillDemo() {
    const form = formRef.current!;
    for (const k of ["codename", "zip", "title", "startsAt", "venue", "address", "notes"] as const) {
      (form.elements.namedItem(k) as HTMLInputElement).value = DEMO[k];
    }
    setLat(DEMO.lat);
    setLon(DEMO.lon);
    setTheme(DEMO.theme);
    setRadiusM(400);
    setMaxWalkM(1200);
    setPlan(null);
  }

  async function runPlanner() {
    setPlanning(true);
    setPlanError("");
    setPlan(null);
    const f = new FormData(formRef.current!);
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lat: Number(lat),
        lon: Number(lon),
        radiusM,
        maxWalkM,
        count: spots.length,
        theme,
        // Passed so the planner can refuse clues that give the venue away.
        venue: f.get("venue") || undefined,
        address: f.get("address") || undefined,
        title: f.get("title") || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    setPlanning(false);
    if (!res.ok) return setPlanError(body?.error ?? "Planning failed.");
    setPlan(body);
    setSpots(
      (body.spots as PlannedSpot[]).map((s) => ({
        label: s.label,
        clue: s.clue,
        lat: String(s.lat),
        lon: String(s.lon),
        osmRef: s.osmRef,
      })),
    );
    setFitKey((k) => k + 1);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const payload = [];
    for (const [i, s] of spots.entries()) {
      const has = s.lat.trim() !== "" || s.lon.trim() !== "";
      if (has && !parseCoords(s.lat, s.lon)) {
        return setError(`Spot ${i + 1}: enter both latitude (-90 to 90) and longitude (-180 to 180) as numbers, or leave both empty.`);
      }
      payload.push({
        label: s.label,
        clue: s.clue,
        ...(has ? { lat: Number(s.lat), lon: Number(s.lon) } : {}),
        ...(s.osmRef ? { osmRef: s.osmRef } : {}),
      });
    }

    setBusy(true);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        codename: f.get("codename"),
        zip: f.get("zip"),
        details: {
          title: f.get("title"),
          startsAt: f.get("startsAt"),
          venue: f.get("venue"),
          address: f.get("address"),
          notes: f.get("notes"),
        },
        threshold,
        theme: eventTheme,
        spots: payload,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Could not create the event.");
      setBusy(false);
      return;
    }
    // Shares exist only in this response. Hand them to the print page via sessionStorage.
    sessionStorage.setItem(`wom:print:${body.id}`, JSON.stringify({ codename: f.get("codename"), shares: body.shares }));
    router.push(`/events/${body.id}/print`);
  }

  const canPlan = parseCoords(lat, lon) !== null;

  return (
    <form onSubmit={submit} ref={formRef}>
      <p>
        <button type="button" className="secondary" onClick={fillDemo}>
          Fill in the demo: Halloween costume party
        </button>
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Public face</h2>
        <label htmlFor="codename">Codename (shown on flyers)</label>
        <input id="codename" name="codename" placeholder="Operation Nightjar" required />
        <label htmlFor="zip">ZIP code (the only location shown until the codes are found)</label>
        <input id="zip" name="zip" inputMode="numeric" pattern="\d{5}" maxLength={5} placeholder="13204" required />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Secret details (encrypted)</h2>
        <label htmlFor="title">Event title</label>
        <input id="title" name="title" required />
        <label htmlFor="startsAt">Starts</label>
        <input id="startsAt" name="startsAt" type="datetime-local" required />
        <label htmlFor="venue">Venue</label>
        <input id="venue" name="venue" />
        <label htmlFor="address">Address</label>
        <input id="address" name="address" />
        <label htmlFor="notes">Notes for guests</label>
        <textarea id="notes" name="notes" rows={3} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Look and feel</h2>
        <p className="muted">Colors for this event&apos;s invite, hunt, unlock and ticket pages, and the printed invites. You can change it later.</p>
        <ThemePicker value={eventTheme} onChange={setEventTheme} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>How many codes?</h2>
        <label htmlFor="count">Map points (QR/NFC codes), 1 to {MAX_SPOTS}</label>
        <select id="count" value={spots.length} onChange={(e) => resize(Number(e.target.value))}>
          {Array.from({ length: MAX_SPOTS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label htmlFor="threshold">Codes a guest must find to unlock the details</label>
        <select id="threshold" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
          {Array.from({ length: spots.length }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} of {spots.length}
              {n === 1 ? " (any single code works)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Map</h2>
        <p className="muted">
          Pick what to place, then click the map, or type coordinates in the fields below. Both work, and they stay in
          sync. Pins are optional and stay private to coordinators and admins.
        </p>
        <MapPicker
          tileUrl={tileUrl}
          fallbackCenter={fallbackCenter}
          start={{ lat, lon }}
          spots={spots}
          radiusM={radiusM}
          fitKey={fitKey}
          onStart={(a, b) => (setLat(a), setLon(b))}
          onSpot={(i, a, b) => setCoord(i, { lat: a, lon: b })}
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Plan the walk with AI (optional)</h2>
        <p className="muted">
          Set where the hunt starts by clicking the map above (Start point) or by typing coordinates below. Your local
          model then chooses real places from OpenStreetMap and writes themed lines; the app adds the facts and checks
          the walk length. It runs on your own Ollama server.
        </p>
        <p className="muted">
          Map lookups send the start point to a public Overpass server, and that provider&apos;s terms apply. To keep it
          private, host your own and set <code>OVERPASS_URL</code>, or place the spots yourself on the map or by
          coordinates.
        </p>
        <div className="row">
          <div>
            <label htmlFor="lat">Start latitude</label>
            <input id="lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="43.0693" />
          </div>
          <div>
            <label htmlFor="lon">Start longitude</label>
            <input id="lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-76.1727" />
          </div>
        </div>
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => locate((a, b) => (setLat(a), setLon(b)), setPlanError)}
          >
            Use my current location
          </button>
        </p>
        <label htmlFor="walk">Walking limit for the whole loop</label>
        <select id="walk" value={maxWalkM} onChange={(e) => setMaxWalkM(Number(e.target.value))}>
          {WALKS.map((w) => (
            <option key={w.m} value={w.m}>
              {w.name}
            </option>
          ))}
        </select>
        <label htmlFor="radius">Search radius (meters)</label>
        <input id="radius" type="number" min={100} max={2000} step={50} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} />
        <label htmlFor="theme">Theme for the clue lines</label>
        <input id="theme" value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={80} />
        <p>
          <button type="button" onClick={runPlanner} disabled={!canPlan || planning}>
            {planning ? "Planning… can take up to a minute" : `Suggest ${spots.length} spot${spots.length === 1 ? "" : "s"}`}
          </button>
        </p>
        {planError && <p className="error">{planError}</p>}
        {plan && (
          <div role="status">
            <p>
              <strong>
                Loop of about {plan.walkM} m (roughly {Math.max(1, Math.round(plan.walkM / 80))} min)
              </strong>{" "}
              <span className="pill">{plan.source === "model" ? `written by ${plan.model}` : "fallback: no riddles"}</span>
            </p>
            {plan.warnings.map((w, i) => (
              <p key={i} className="muted">
                {w}
              </p>
            ))}
          </div>
        )}
        <OsmCredit />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Map points</h2>
        <p role="note" style={{ border: "1px solid var(--danger)", borderRadius: 8, padding: 10 }}>
          <strong>Only put a code somewhere you have permission to.</strong> Malls, shops, parks and most buildings
          have rules about stickers and tags, so ask the owner or manager first. Don&apos;t use private property without
          a yes, and don&apos;t pick anywhere unsafe or where a code would block a path or an exit. Suggestions from the
          AI are just suggestions: check every spot yourself.
        </p>
        {spots.map((s, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <strong>Spot {i + 1}</strong>{" "}
            {mapLink(s) && (
              <a href={mapLink(s)!} target="_blank" rel="noreferrer">
                view on map
              </a>
            )}
            {s.osmRef ? (
              <span className="pill" style={{ marginLeft: 8 }}>
                suggested
              </span>
            ) : s.lat ? (
              <span className="pill" style={{ marginLeft: 8 }}>
                set by hand
              </span>
            ) : null}
            <label htmlFor={`label-${i}`}>Where it goes (for you only, printed on the cut-off strip)</label>
            <input id={`label-${i}`} value={s.label} onChange={(e) => setSpot(i, { label: e.target.value })} required />
            <label htmlFor={`clue-${i}`}>Clue for hunters (public)</label>
            <input id={`clue-${i}`} value={s.clue} onChange={(e) => setSpot(i, { clue: e.target.value })} required />
            <div className="row">
              <div>
                <label htmlFor={`lat-${i}`}>Latitude</label>
                <input id={`lat-${i}`} inputMode="decimal" value={s.lat} onChange={(e) => setCoord(i, { lat: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`lon-${i}`}>Longitude</label>
                <input id={`lon-${i}`} inputMode="decimal" value={s.lon} onChange={(e) => setCoord(i, { lon: e.target.value })} />
              </div>
            </div>
            <p>
              <button
                type="button"
                className="secondary"
                onClick={() => locate((a, b) => setCoord(i, { lat: a, lon: b }), setError)}
              >
                Use my current location for this spot
              </button>
            </p>
          </div>
        ))}
        <p className="muted">
          Set each spot with a pin on the map above or by typing coordinates. Coordinates are optional and stay private to
          coordinators and admins. Hunters only ever see the clue.
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{busy ? "Sealing…" : "Seal event and make codes"}</button>
    </form>
  );
}
