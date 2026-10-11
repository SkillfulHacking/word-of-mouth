"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { formatCoord, parseCoords, wrapLon } from "@/lib/map-input";

type Coord = { lat: string; lon: string };
type Target = "start" | number;

type Props = {
  /** Tile server template, e.g. https://tile.openstreetmap.org/{z}/{x}/{y}.png */
  tileUrl: string;
  /** Where the map first opens when nothing is set yet. */
  fallbackCenter: { lat: number; lon: number; zoom: number };
  start: Coord;
  spots: Coord[];
  /** Drawn as a ring around the start point so the planner's search area is visible. */
  radiusM: number;
  /** Bump this to zoom the map to all pins (after the planner suggests spots). */
  fitKey: number;
  onStart: (lat: string, lon: string) => void;
  onSpot: (i: number, lat: string, lon: string) => void;
};

const stampOf = (lat: string, lon: string) => `${Number(lat)},${Number(lon)}`;

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

/**
 * Click-to-place map for the start point and the code spots. Leaflet is loaded in the browser only, and the
 * typed latitude/longitude fields stay the source of truth: the map just reads and writes them.
 */
export function MapPicker({ tileUrl, fallbackCenter, start, spots, radiusM, fitKey, onStart, onSpot }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const libRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const seen = useRef(new Map<string, string>());
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState<Target>("start");
  const [note, setNote] = useState("");

  // The click handler is bound once, so it reads the latest props through a ref.
  const latest = useRef({ target, spotCount: spots.length, onStart, onSpot });
  useEffect(() => {
    latest.current = { target, spotCount: spots.length, onStart, onSpot };
  });
  const tileRef = useRef({ tileUrl, fallbackCenter, start, spots });
  useEffect(() => {
    tileRef.current = { tileUrl, fallbackCenter, start, spots };
  });

  useEffect(() => {
    // If spots are removed, don't keep placing a spot that no longer exists.
    setTarget((t) => (t !== "start" && t >= spots.length ? Math.max(0, spots.length - 1) : t));
  }, [spots.length]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !box.current) return;
      libRef.current = L;
      const init = tileRef.current;
      const s = parseCoords(init.start.lat, init.start.lon) ?? init.spots.map((p) => parseCoords(p.lat, p.lon)).find(Boolean) ?? null;
      // The wheel zooms the map only after you click it, so scrolling the page past the map doesn't get stuck on it.
      map = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(
        s ? [s.lat, s.lon] : [init.fallbackCenter.lat, init.fallbackCenter.lon],
        s ? 16 : init.fallbackCenter.zoom,
      );
      map.attributionControl.setPrefix(false);
      L.tileLayer(init.tileUrl, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.getContainer().addEventListener("mouseleave", () => map?.scrollWheelZoom.disable());
      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        map?.scrollWheelZoom.enable();
        const { target: t, spotCount, onStart: pickStart, onSpot: pickSpot } = latest.current;
        const lat = formatCoord(e.latlng.lat);
        const lon = formatCoord(wrapLon(e.latlng.lng));
        // A pin the user just placed with the mouse is already where they are looking: don't move the view for it.
        seen.current.set(t === "start" ? "start" : `s${t}`, stampOf(lat, lon));
        if (t === "start") return pickStart(lat, lon);
        pickSpot(t, lat, lon);
        if (t + 1 < spotCount) setTarget(t + 1);
      });
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setReady(false);
    };
  }, []);

  // Redraw the pins whenever a coordinate changes.
  useEffect(() => {
    const L = libRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !map || !layer) return;
    layer.clearLayers();
    const pin = (label: string, cls: string, active: boolean) =>
      L.divIcon({ className: "", html: `<div class="wom-pin ${cls}${active ? " active" : ""}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    const moved: [number, number][] = [];
    const place = (key: string, c: Coord, icon: Leaflet.DivIcon, onDrag: (lat: string, lon: string) => void, title: string) => {
      const p = parseCoords(c.lat, c.lon);
      if (!p) return seen.current.delete(key);
      const m = L.marker([p.lat, p.lon], { icon, draggable: true, title, keyboard: false }).addTo(layer);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        const a = formatCoord(ll.lat);
        const b = formatCoord(wrapLon(ll.lng));
        seen.current.set(key, stampOf(a, b));
        onDrag(a, b);
      });
      const stamp = `${p.lat},${p.lon}`;
      if (seen.current.get(key) !== stamp) moved.push([p.lat, p.lon]);
      seen.current.set(key, stamp);
    };
    place("start", start, pin("S", "start", target === "start"), onStart, "Start point (drag to move)");
    spots.forEach((s, i) => place(`s${i}`, s, pin(String(i + 1), "spot", target === i), (a, b) => onSpot(i, a, b), `Spot ${i + 1} (drag to move)`));
    const s = parseCoords(start.lat, start.lon);
    if (s && radiusM > 0) L.circle([s.lat, s.lon], { radius: radiusM, weight: 1, fillOpacity: 0.05, interactive: false }).addTo(layer);
    // A pin that was typed in or suggested (not clicked) brings the map to it, and zooms in if the map is zoomed way out.
    const view = map.getBounds();
    const far = map.getZoom() < 12;
    const off = moved.filter(([a, b]) => far || !view.contains([a, b]));
    if (off.length === 1) map.setView(off[0], Math.max(map.getZoom(), 15), { animate: false });
    else if (off.length > 1) map.fitBounds(L.latLngBounds(off).pad(0.2), { maxZoom: 17, animate: false });
  }, [ready, start, spots, radiusM, target, onStart, onSpot]);

  // After the planner suggests spots, show all of them.
  const lastFit = useRef(fitKey);
  useEffect(() => {
    const L = libRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    const pts = [start, ...spots].map((c) => parseCoords(c.lat, c.lon)).filter((p) => p !== null);
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])).pad(0.25), { maxZoom: 17, animate: false });
  }, [ready, fitKey, start, spots]);

  function findMe() {
    setNote("");
    if (!navigator.geolocation) return setNote("This browser can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => mapRef.current?.setView([p.coords.latitude, p.coords.longitude], 17),
      () => setNote("Couldn't get your location. Pan and zoom the map by hand."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  const tileHost = (() => {
    try {
      return new URL(tileUrl.replace(/\{[xyzs]\}/g, "0")).host;
    } catch {
      return "the map tile server";
    }
  })();

  return (
    <div>
      <div role="group" aria-label="What a click on the map places" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <button type="button" className={target === "start" ? "" : "secondary"} aria-pressed={target === "start"} onClick={() => setTarget("start")}>
          Start point
        </button>
        {spots.map((_, i) => (
          <button key={i} type="button" className={target === i ? "" : "secondary"} aria-pressed={target === i} onClick={() => setTarget(i)}>
            Spot {i + 1}
          </button>
        ))}
        <button type="button" className="secondary" onClick={findMe}>
          Find me
        </button>
      </div>
      <p className="muted" style={{ margin: "0 0 8px" }} aria-live="polite">
        {note || (target === "start" ? "Click the map to set the start point." : `Click the map to place spot ${target + 1}.`)} Drag a pin to move it. Click the map once to zoom with the mouse wheel.
      </p>
      <div ref={box} className="wom-map" role="application" aria-label="Map. Use the coordinate fields instead if you can't use a pointer." />
      <p className="muted" style={{ fontSize: "0.85rem", margin: "8px 0 0" }}>
        Map pictures load from {tileHost}, which can see which area you are looking at. Its terms apply. To avoid that, host your own tiles and set{" "}
        <code>MAP_TILE_URL</code>, or just type coordinates.
      </p>
    </div>
  );
}
