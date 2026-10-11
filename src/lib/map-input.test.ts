import { describe, expect, it } from "vitest";
import { DEFAULT_TILE_URL, formatCoord, parseCoords, parseMapCenter, resolveTileUrl, wrapLon } from "./map-input";

describe("parseCoords", () => {
  it("reads two numbers", () => expect(parseCoords("43.0507", "-75.9755")).toEqual({ lat: 43.0507, lon: -75.9755 }));
  it("rejects empty, text and out-of-range values", () => {
    expect(parseCoords("", "1")).toBeNull();
    expect(parseCoords("1", " ")).toBeNull();
    expect(parseCoords("abc", "1")).toBeNull();
    expect(parseCoords("91", "0")).toBeNull();
    expect(parseCoords("0", "-181")).toBeNull();
    expect(parseCoords("Infinity", "0")).toBeNull();
  });
  it("accepts the edges", () => expect(parseCoords("-90", "180")).toEqual({ lat: -90, lon: 180 }));
});

describe("formatCoord and wrapLon", () => {
  it("keeps five decimals", () => expect(formatCoord(43.05074999)).toBe("43.05075"));
  it("wraps longitude panned past the date line", () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(-75.9755)).toBeCloseTo(-75.9755);
  });
});

describe("parseMapCenter", () => {
  it("parses lat,lon with an optional zoom", () => {
    expect(parseMapCenter("43.07,-76.17,12")).toEqual({ lat: 43.07, lon: -76.17, zoom: 12 });
    expect(parseMapCenter("43.07, -76.17")).toEqual({ lat: 43.07, lon: -76.17, zoom: 13 });
  });
  it("clamps the zoom and ignores junk", () => {
    expect(parseMapCenter("1,2,99")?.zoom).toBe(18);
    expect(parseMapCenter("nope")).toBeNull();
    expect(parseMapCenter(undefined)).toBeNull();
  });
});

describe("resolveTileUrl", () => {
  it("defaults to OpenStreetMap", () => expect(resolveTileUrl(undefined)).toBe(DEFAULT_TILE_URL));
  it("accepts a self-hosted template", () =>
    expect(resolveTileUrl("https://tiles.example.org/{z}/{x}/{y}.png")).toBe("https://tiles.example.org/{z}/{x}/{y}.png"));
  it("falls back when the template is not a usable one", () => {
    expect(resolveTileUrl("https://tiles.example.org/tile.png")).toBe(DEFAULT_TILE_URL);
    expect(resolveTileUrl("javascript:alert(1)//{z}{x}{y}")).toBe(DEFAULT_TILE_URL);
  });
});
