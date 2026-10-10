// Small color toolkit: just enough to keep themes readable (WCAG 2.x contrast).

export type Rgb = [number, number, number];

export const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);

export function hexToRgb(hex: string): Rgb {
  if (!isHex(hex)) throw new Error(`not a #rrggbb color: ${hex}`);
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export const rgbToHex = ([r, g, b]: Rgb): string =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. Body text needs 4.5; large text and UI parts need 3. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `t` of the way from a to b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Nudge `color` lighter or darker (keeping its hue) until it reaches `min` contrast against every
 * background. If it can't, it ends up black or white, the best that is possible.
 */
export function ensureContrast(color: string, backgrounds: string[], min: number): string {
  const worst = (c: string) => Math.min(...backgrounds.map((b) => contrast(c, b)));
  if (worst(color) >= min) return color;
  const goDarker = worst("#000000") >= worst("#ffffff");
  const [h, s, l] = toHsl(hexToRgb(color));
  for (let step = 1; step <= 200; step++) {
    const nl = goDarker ? l - step * 0.005 : l + step * 0.005;
    const candidate = rgbToHex(fromHsl([h, s, Math.max(0, Math.min(1, nl))]));
    if (worst(candidate) >= min || nl <= 0 || nl >= 1) return candidate;
  }
  return goDarker ? "#000000" : "#ffffff";
}

const NAMED: [string, string][] = [
  ["black", "#000000"], ["charcoal", "#36454f"], ["gray", "#808080"], ["silver", "#c0c0c0"], ["white", "#ffffff"], ["cream", "#f5ecd7"],
  ["red", "#d32f2f"], ["crimson", "#8b1a2b"], ["pink", "#ff7eb6"], ["magenta", "#c2188a"], ["orange", "#f57c00"], ["burnt orange", "#cc5500"],
  ["gold", "#d4a017"], ["yellow", "#fdd835"], ["lime", "#a4c639"], ["green", "#2e8b57"], ["forest green", "#1f4d2b"], ["teal", "#008080"],
  ["turquoise", "#30d5c8"], ["sky blue", "#5bb5ea"], ["blue", "#1e56c8"], ["navy", "#14213d"], ["indigo", "#3f2a8c"], ["purple", "#7b2cbf"],
  ["lavender", "#b9a3e3"], ["brown", "#6b4226"], ["tan", "#c8a27a"],
];

/** The nearest everyday color word, so a palette can be described to an image model in plain words. */
export function nearestColorName(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  let best = NAMED[0][0], bestD = Infinity;
  for (const [name, h] of NAMED) {
    const [R, G, B] = hexToRgb(h);
    const d = (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11; // eyes see green best
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}
