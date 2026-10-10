import { describe, expect, it } from "vitest";
import { contrast, ensureContrast, luminance, mix } from "./color";
import { customValue, deriveTokens, isDefaultTheme, isThemeValue, themeCss, themeDef, themeTokens, themeVars, THEMES } from "./themes";

describe("color math", () => {
  it("knows the extremes", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("mixes", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#102030", "#102030", 0.7)).toBe("#102030");
  });
  it("leaves readable colors alone and fixes unreadable ones, keeping the hue", () => {
    expect(ensureContrast("#222222", ["#ffffff"], 7)).toBe("#222222");
    const fixed = ensureContrast("#80a9ff", ["#d4d4ff"], 7); // pale blue text on pale blue
    expect(contrast(fixed, "#d4d4ff")).toBeGreaterThanOrEqual(7);
    expect(parseInt(fixed.slice(5, 7), 16)).toBeGreaterThan(parseInt(fixed.slice(1, 3), 16)); // still bluish
  });
  it("gives up gracefully when nothing can work", () => {
    expect(["#000000", "#ffffff"]).toContain(ensureContrast("#7f7f7f", ["#808080"], 21));
  });
});

describe("built-in themes", () => {
  it("has between 10 and 25 themes with unique ids and names", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10);
    expect(THEMES.length).toBeLessThanOrEqual(25);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
  });
  it("mixes light and dark, and none are near-duplicates", () => {
    const schemes = THEMES.map((t) => deriveTokens(t).scheme);
    expect(schemes.filter((s) => s === "light").length).toBeGreaterThanOrEqual(5);
    expect(schemes.filter((s) => s === "dark").length).toBeGreaterThanOrEqual(5);
    expect(new Set(THEMES.map((t) => `${t.bg}/${t.accent}`)).size).toBe(THEMES.length);
  });

  describe.each(THEMES.map((t) => [t.name, t] as const))("%s", (_name, def) => {
    const t = deriveTokens(def);
    it("is readable: text, muted text and links on the page and on cards", () => {
      for (const [label, color] of [["text", t.fg], ["muted", t.muted], ["link", t.link]] as const) {
        expect(contrast(color, t.bg), `${label} on page`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color, t.card), `${label} on card`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it("has readable text on buttons and a readable error color", () => {
      expect(contrast(t.accentFg, t.accent), "button text").toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.danger, t.bg), "error on page").toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.danger, t.card), "error on card").toBeGreaterThanOrEqual(4.5);
    });
    it("keeps the chosen background and accent exactly", () => {
      expect(t.bg).toBe(def.bg);
      expect(t.accent).toBe(def.accent);
    });
    it("only emits #rrggbb colors", () => {
      for (const v of Object.values(themeVars(def.id))) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    });
  });
});

describe("choosing and applying a theme", () => {
  it("treats default as 'leave the app alone'", () => {
    expect(isDefaultTheme("default")).toBe(true);
    expect(themeCss("default")).toBe("");
    expect(isDefaultTheme("fireside")).toBe(false);
  });
  it("falls back to the default for anything unknown", () => {
    expect(themeDef("nope").id).toBe("default");
    expect(themeDef("").id).toBe("default");
  });
  it("accepts a built-in id or a well-formed custom value, and nothing else", () => {
    expect(isThemeValue("fireside")).toBe(true);
    expect(isThemeValue(customValue("#102030", "#EEEEEE", "#FF8800"))).toBe(true);
    for (const bad of ["", "FIRESIDE", "custom:", "custom:#fff,#000,#f00", "custom:#102030,#eeeeee", "custom:#102030,#eeeeee,#ff8800,#000000",
      "custom:red,blue,green", "fireside;}body{display:none", "custom:#102030,#eeeeee,#ff8800}body{display:none"]) {
      expect(isThemeValue(bad), bad).toBe(false);
    }
  });
  it("makes a custom theme readable even from bad choices", () => {
    // light grey text on a light grey page, with a pale accent
    const t = themeTokens(customValue("#dddddd", "#cccccc", "#eeeeee"));
    expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.link, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accentFg, t.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("produces a stylesheet that can't carry anything but colors", () => {
    const css = themeCss("amethyst-dawn");
    expect(css).toMatch(/^html:root\{(--[a-z-]+:#[0-9a-f]{6};)+color-scheme:(light|dark)\}$/);
    expect(css).toContain("color-scheme:dark");
    // an invalid value never reaches CSS: it falls back to the default, which emits nothing
    expect(themeCss("custom:#102030,#eeeeee,#ff8800}body{display:none")).toBe("");
  });
});
