import { contrast, ensureContrast, hexToRgb, isHex, luminance, mix } from "./color";

/**
 * Event themes. Most are built from palettes in Figma's "website color schemes" collection
 * (https://www.figma.com/resource-library/website-color-schemes/): `figma` is the scheme's number there.
 * Only the colors were used, read from the published swatches (they can be off by 1 in a channel).
 * Picking which color plays background, text and accent is ours, and so are the contrast fixes below.
 */
export type ThemeDef = {
  id: string;
  name: string;
  figma?: number;
  /** The page background. */
  bg: string;
  /** The text color wanted. It is adjusted if it wouldn't be readable. */
  fg: string;
  accent: string;
  card?: string;
};

export const THEMES: ThemeDef[] = [
  { id: "default", name: "Word of Mouth", bg: "#f6f4ee", fg: "#1d2420", accent: "#2f6b3f" },
  // --- light
  { id: "ink-wash", name: "Ink wash", figma: 1, bg: "#cfcfcf", fg: "#252525", accent: "#545454" },
  { id: "neutral-elegance", name: "Neutral elegance", figma: 2, bg: "#ffdbba", fg: "#674931", accent: "#9a7e67" },
  { id: "marina", name: "Marina", figma: 25, bg: "#fff1e8", fg: "#316181", accent: "#7f5232" },
  { id: "yacht-club", name: "Yacht club", figma: 12, bg: "#f3f1ef", fg: "#225f73", accent: "#723e22" },
  { id: "calcite", name: "Calcite", figma: 20, bg: "#dedcda", fg: "#3c4043", accent: "#fc7b40" },
  { id: "opaline", name: "Opaline", figma: 44, bg: "#f5f4f7", fg: "#2a2a2f", accent: "#ff644b" },
  { id: "seashell-garnet", name: "Seashell garnet", figma: 18, bg: "#f7c992", fg: "#5484a3", accent: "#f96e81" },
  { id: "freshly-squeezed", name: "Freshly squeezed", figma: 42, bg: "#ffe642", fg: "#ff7901", accent: "#ff7901" },
  { id: "sorbet", name: "Sorbet", figma: 10, bg: "#e0e7d7", fg: "#b7c396", accent: "#b99b91" },
  { id: "moon-dust", name: "Moon dust", figma: 29, bg: "#d4d4ff", fg: "#80a9ff", accent: "#80a9ff" },
  { id: "jelly-shoes", name: "Jelly shoes", figma: 43, bg: "#c4d6ff", fg: "#8766df", accent: "#dd67e3" },
  { id: "rose-quartz", name: "Rose quartz", figma: 19, bg: "#e0d9d9", fg: "#63242e", accent: "#b44445" },
  { id: "honey-opal", name: "Honey opal", figma: 17, bg: "#f7d67a", fg: "#503c35", accent: "#9d8108" },
  { id: "pearl", name: "Pearl", figma: 8, bg: "#e9e3de", fg: "#666261", accent: "#af9ac8" },
  // --- dark
  { id: "urban-nocturne", name: "Urban nocturne", figma: 53, bg: "#141414", fg: "#d6d6d6", accent: "#e2e800" },
  { id: "wraith", name: "Wraith", figma: 52, bg: "#1e1803", fg: "#e6e3e4", accent: "#047c58" },
  { id: "sapphire-nightfall", name: "Sapphire nightfall", figma: 23, bg: "#262c40", fg: "#a8c4ed", accent: "#0474c5" },
  { id: "lapis-velvet", name: "Lapis velvet", figma: 24, bg: "#071849", fg: "#ebe0d2", accent: "#893173" },
  { id: "amethyst-dawn", name: "Amethyst dawn", figma: 28, bg: "#341c69", fg: "#c5aef3", accent: "#dece41" },
  { id: "fireside", name: "Fireside", figma: 21, bg: "#724237", fg: "#d9d4bd", accent: "#e86814" },
  { id: "autumn-luxe", name: "Autumn luxe", figma: 50, bg: "#322c27", fg: "#e3e1eb", accent: "#c0843f" },
  { id: "inked", name: "Inked", figma: 51, bg: "#000000", fg: "#e0dedc", accent: "#00adae" },
  { id: "amethyst-mint", name: "Amethyst mint", figma: 36, bg: "#2a3f38", fg: "#8ef688", accent: "#f650bc" },
  { id: "turquoise-amber", name: "Turquoise amber", figma: 30, bg: "#304b64", fg: "#a5ccd3", accent: "#e3480d" },
];

export type Tokens = {
  bg: string;
  card: string;
  fg: string;
  muted: string;
  line: string;
  accent: string;
  accentFg: string;
  /** The accent, adjusted so it is readable as link text on the page and on cards. */
  link: string;
  danger: string;
  scheme: "light" | "dark";
};

/**
 * Turn three chosen colors into every color the app uses, nudging any that would be hard to read.
 * Guarantees (checked by the tests for every built-in theme): text, muted text and links reach at least
 * 4.5:1 on both the page and cards, and text on the accent color (buttons) reaches at least 4.5:1.
 */
export function deriveTokens(def: Pick<ThemeDef, "bg" | "fg" | "accent" | "card">): Tokens {
  const dark = luminance(def.bg) < 0.25;
  const card = def.card ?? (dark ? mix(def.bg, "#ffffff", 0.07) : mix(def.bg, "#ffffff", 0.55));
  const surfaces = [def.bg, card];
  const fg = ensureContrast(def.fg, surfaces, 7);
  const muted = ensureContrast(mix(fg, def.bg, 0.4), surfaces, 4.5);
  const line = mix(def.bg, fg, 0.2);
  // Text on the accent: prefer the theme's own colors, then plain black or white.
  const accentFg = [def.bg, fg, "#000000", "#ffffff"].find((c) => contrast(c, def.accent) >= 4.5) ??
    (contrast("#000000", def.accent) >= contrast("#ffffff", def.accent) ? "#000000" : "#ffffff");
  const link = ensureContrast(def.accent, surfaces, 4.5);
  const danger = ensureContrast(dark ? "#ff8a80" : "#b3261e", surfaces, 4.5);
  return { bg: def.bg, card, fg, muted, line, accent: def.accent, accentFg, link, danger, scheme: dark ? "dark" : "light" };
}

// ---- choosing a theme -------------------------------------------------------------------------

const CUSTOM = /^custom:(#[0-9a-fA-F]{6}),(#[0-9a-fA-F]{6}),(#[0-9a-fA-F]{6})$/;

/** A theme value is a built-in id, or `custom:<background>,<text>,<accent>` with #rrggbb colors. */
export const isThemeValue = (v: string): boolean => THEMES.some((t) => t.id === v) || CUSTOM.test(v);

export const customValue = (bg: string, fg: string, accent: string) => `custom:${bg},${fg},${accent}`.toLowerCase();

export function themeDef(value: string): ThemeDef {
  const built = THEMES.find((t) => t.id === value);
  if (built) return built;
  const m = CUSTOM.exec(value);
  if (m) return { id: "custom", name: "Custom", bg: m[1].toLowerCase(), fg: m[2].toLowerCase(), accent: m[3].toLowerCase() };
  return THEMES[0];
}

/** `default` means "leave the app's own look alone" (including its dark mode). */
export const isDefaultTheme = (value: string): boolean => themeDef(value).id === "default";

export const themeTokens = (value: string): Tokens => deriveTokens(themeDef(value));

/** CSS custom properties for a theme, as a plain object (for inline `style`) ... */
export function themeVars(value: string): Record<string, string> {
  const t = themeTokens(value);
  return {
    "--bg": t.bg, "--card": t.card, "--fg": t.fg, "--muted": t.muted, "--line": t.line,
    "--accent": t.accent, "--accent-fg": t.accentFg, "--link": t.link, "--danger": t.danger,
  };
}

/** ... and as a stylesheet that restyles a whole page. Every value is a validated hex color. */
export function themeCss(value: string): string {
  if (isDefaultTheme(value)) return "";
  const t = themeTokens(value);
  const vars = Object.entries(themeVars(value)).map(([k, v]) => `${k}:${v}`).join(";");
  return `html:root{${vars};color-scheme:${t.scheme}}`;
}

// Re-exported so callers don't need a second import.
export { contrast, hexToRgb, isHex };
