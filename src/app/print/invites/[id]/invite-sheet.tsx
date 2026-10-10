"use client";

import QRCode from "qrcode";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { themeVars } from "@/lib/themes";

type Invite = { code: string; n: number; of: number; note: string };
type EventInfo = { id: string; codename: string; zip: string; theme: string };

const PAPER = {
  letter: { name: "US Letter (8.5 × 11 in)", w: 215.9, h: 279.4, page: "8.5in 11in" },
  a4: { name: "A4 (210 × 297 mm)", w: 210, h: 297, page: "210mm 297mm" },
} as const;
type Paper = keyof typeof PAPER;

// cols × rows of cards on one sheet. 1 and 4 are portrait cards; 2 and 8 are landscape.
const LAYOUTS = {
  1: { cols: 1, rows: 1, name: "1 per sheet: full-page flyer", portrait: true },
  2: { cols: 1, rows: 2, name: "2 per sheet: half-page", portrait: false },
  4: { cols: 2, rows: 2, name: "4 per sheet: quarter-page", portrait: true },
  8: { cols: 2, rows: 4, name: "8 per sheet: invitation cards", portrait: false },
} as const;
type PerSheet = keyof typeof LAYOUTS;

const pad = (n: number, of: number) => String(n).padStart(String(of).length, "0");

/** Guests' phones can't open an address that only works on this network or this computer. */
function unreachable(base: string): boolean {
  try {
    const h = new URL(base).hostname;
    return /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith(".local");
  } catch {
    return false;
  }
}

export function InviteSheet({ event, invites, defaultBase, batch, coverUrl }: { event: EventInfo; invites: Invite[]; defaultBase: string; batch: string | null; coverUrl?: string | null }) {
  const [paper, setPaper] = useState<Paper>("letter");
  const [perSheet, setPerSheet] = useState<PerSheet>(4);
  const [ink, setInk] = useState(false);
  const [guides, setGuides] = useState(true);
  const [message, setMessage] = useState("");
  const [base, setBase] = useState(defaultBase);
  const [svgs, setSvgs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!defaultBase) setBase(location.origin);
  }, [defaultBase]);

  const cleanBase = base.trim().replace(/\/+$/, "");
  const urlFor = (code: string) => `${cleanBase}/i/${code}`;

  // Vector QR codes at the highest error correction, so a scuffed or folded flyer still scans.
  useEffect(() => {
    if (!cleanBase) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        invites.map(async (i) => [i.code, (await QRCode.toString(urlFor(i.code), { type: "svg", errorCorrectionLevel: "H", margin: 0 })).replace("<svg ", '<svg shape-rendering="crispEdges" ')] as const),
      );
      if (!cancelled) setSvgs(Object.fromEntries(entries));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanBase, invites]);

  const layout = LAYOUTS[perSheet];
  const sheets = useMemo(() => {
    const out: Invite[][] = [];
    for (let i = 0; i < invites.length; i += perSheet) out.push(invites.slice(i, i + perSheet));
    return out;
  }, [invites, perSheet]);
  const ready = invites.every((i) => svgs[i.code]);
  const p = PAPER[paper];
  const vars = themeVars(event.theme) as CSSProperties;

  return (
    <>
      <style>{`@page { size: ${p.page}; margin: 0; }`}</style>

      <div className="noprint">
        <p>
          <Link href={`/events/${event.id}`}>← Back to the event</Link>
        </p>
        <h1>Print invites</h1>
        <p className="muted">
          {invites.length} unused invite{invites.length === 1 ? "" : "s"}
          {batch ? " from this batch" : ""}, each with its own code. Once someone accepts one, it won&apos;t print again.
        </p>

        {invites.length === 0 ? (
          <p>There are no unused invites to print.</p>
        ) : (
          <div className="card">
            <div className="row">
              <div>
                <label htmlFor="paper">Paper</label>
                <select id="paper" value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                  {Object.entries(PAPER).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="persheet">Layout</label>
                <select id="persheet" value={perSheet} onChange={(e) => setPerSheet(Number(e.target.value) as PerSheet)}>
                  {Object.entries(LAYOUTS).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="base">Address guests will use</label>
            <input id="base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://invites.example.com" inputMode="url" />
            {unreachable(cleanBase) && (
              <p className="error" role="alert">
                That address only works on your own network or computer. Guests&apos; phones won&apos;t be able to open it. Use the public address of your server.
              </p>
            )}

            <label htmlFor="msg">Extra line on every card (optional)</label>
            <input id="msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={90} placeholder="Costumes required" />
            <p className="muted" style={{ margin: "4px 0 0" }}>Printed on every card and the cards get handed around, so don&apos;t put the place or the time here.</p>

            <div className="row" style={{ marginTop: 12 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, margin: 0 }}>
                <input type="checkbox" checked={ink} onChange={(e) => setInk(e.target.checked)} style={{ width: "auto" }} />
                Ink saver: white cards instead of the event colors
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, margin: 0 }}>
                <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} style={{ width: "auto" }} />
                Show cut guides
              </label>
            </div>

            <p style={{ marginBottom: 0 }}>
              <button type="button" onClick={() => window.print()} disabled={!ready}>
                {ready ? `Print or save as PDF (${sheets.length} sheet${sheets.length === 1 ? "" : "s"})` : "Making the QR codes…"}
              </button>
            </p>
            <details style={{ marginTop: 12 }}>
              <summary>Getting a great print</summary>
              <ul className="muted">
                <li>In the print window choose <strong>100% / Actual size</strong> and turn <strong>Background graphics</strong> on, or the colors won&apos;t print.</li>
                <li>Pick <strong>Save as PDF</strong> to send a print shop a file. The QR codes are vector, so they stay sharp at any size.</li>
                <li>Matte or satin paper scans better than glossy, which reflects light. Heavier stock (about 100 lb / 270 gsm) feels like a real invitation.</li>
                <li>Cut along the dashed guides. Test one printed code with a phone before you print the lot.</li>
              </ul>
            </details>
          </div>
        )}
      </div>

      <div className="sheets">
        {sheets.map((group, si) => (
          <section
            key={si}
            className={`sheet${guides ? " guides" : ""}`}
            style={{ width: `${p.w}mm`, height: `${p.h}mm`, gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}
          >
            {group.map((inv) => (
              <article
                key={inv.code}
                className={`invite-card ${layout.portrait ? "portrait" : "landscape"}${ink ? " ink" : ""}${coverUrl && perSheet !== 8 ? " has-cover" : ""}`}
                style={ink ? undefined : vars}
                data-code={inv.code}
              >
                {coverUrl && !(perSheet === 8) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="ic-cover" src={coverUrl} alt="" />
                )}
                <div className="ic-inner">
                  <div className="ic-text">
                    <p className="ic-kicker">You&apos;re invited</p>
                    <h2 className="ic-title">{event.codename}</h2>
                    <p className="ic-zip">Somewhere in ZIP code {event.zip}</p>
                    {message && <p className="ic-msg">{message}</p>}
                    <p className="ic-how">Scan the code with your phone&apos;s camera to accept. Then find the hidden codes to learn where and when.</p>
                  </div>
                  <div className="ic-qr">
                    <div className="ic-qrbox" role="img" aria-label={`QR code for invite ${inv.n}`} dangerouslySetInnerHTML={{ __html: svgs[inv.code] ?? "" }} />
                    <p className="ic-link">{urlFor(inv.code).replace(/^https?:\/\//, "")}</p>
                    <p className="ic-num">
                      Invite {pad(inv.n, inv.of)} of {inv.of} · single use
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
