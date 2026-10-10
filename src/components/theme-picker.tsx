"use client";

import { useState } from "react";
import { ThemeScope } from "./theme-scope";
import { customValue, isThemeValue, themeDef, themeTokens, THEMES } from "@/lib/themes";

/** A grid of built-in themes plus a custom one, with a live preview that shows what the colors really look like. */
export function ThemePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isCustom = value.startsWith("custom:");
  const def = themeDef(value);
  const [custom, setCustom] = useState({ bg: isCustom ? def.bg : "#1b1030", fg: isCustom ? def.fg : "#f1e9ff", accent: isCustom ? def.accent : "#ff8a3d" });
  const pushCustom = (next: typeof custom) => {
    setCustom(next);
    onChange(customValue(next.bg, next.fg, next.accent));
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Theme" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {THEMES.map((t) => {
          const k = themeTokens(t.id);
          const on = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(t.id)}
              className="secondary"
              style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", textAlign: "left", padding: 8, outline: on ? "3px solid var(--link)" : undefined, outlineOffset: 1 }}
            >
              <span style={{ display: "flex", height: 34, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }} aria-hidden>
                <span style={{ flex: 3, background: k.bg, color: k.fg, display: "grid", placeItems: "center", fontWeight: 700 }}>Aa</span>
                <span style={{ flex: 1, background: k.card }} />
                <span style={{ flex: 1, background: k.accent }} />
              </span>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{t.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          onClick={() => pushCustom(custom)}
          className="secondary"
          style={{ textAlign: "left", padding: 8, outline: isCustom ? "3px solid var(--link)" : undefined, outlineOffset: 1 }}
        >
          <span style={{ display: "block", height: 34, borderRadius: 6, border: "1px dashed var(--line)", marginBottom: 6 }} aria-hidden />
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Custom colors…</span>
        </button>
      </div>

      {isCustom && (
        <div className="row" style={{ marginTop: 12 }}>
          {(["bg", "fg", "accent"] as const).map((k) => (
            <div key={k}>
              <label htmlFor={`custom-${k}`}>{k === "bg" ? "Background" : k === "fg" ? "Text" : "Accent"}</label>
              <input id={`custom-${k}`} type="color" value={custom[k]} onChange={(e) => pushCustom({ ...custom, [k]: e.target.value })} style={{ height: 44, padding: 2 }} />
            </div>
          ))}
        </div>
      )}
      {isCustom && <p className="muted">Colors that would be hard to read are nudged automatically.</p>}

      <p className="muted" style={{ margin: "12px 0 4px" }}>Preview</p>
      <ThemeScope theme={isThemeValue(value) ? value : "default"} style={{ padding: 14, borderRadius: 12, border: "1px solid var(--line)" }}>
        <div className="card" style={{ margin: 0 }}>
          <h3 style={{ margin: "0 0 4px" }}>You&apos;re invited</h3>
          <p className="muted" style={{ margin: "0 0 8px" }}>Somewhere in ZIP code 13204</p>
          <p style={{ margin: "0 0 10px" }}>
            Find the codes to learn where. <a href="#preview" onClick={(e) => e.preventDefault()}>A link looks like this</a>.
          </p>
          <button type="button" tabIndex={-1}>Accept invitation</button>{" "}
          <span className="pill">valid</span>
        </div>
      </ThemeScope>
    </div>
  );
}
