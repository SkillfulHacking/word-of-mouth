// Real-browser test of the map on the new-event form: place the start point and spots by clicking, drag a pin,
// check typed coordinates and the map stay in sync, and seal an event whose spots came from the map.
// Usage: BASE=http://localhost:3120 ADMIN_PASSWORD=... pnpm tsx scripts/e2e-map.mts   (server running, DB seeded with an admin)
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3120";
const password = process.env.ADMIN_PASSWORD ?? "";
const out = path.join(process.cwd(), "docs", "screenshots");
let fails = 0;
const log = (ok: boolean, m: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); };
const val = (p: Page, sel: string) => p.inputValue(sel);
const pins = (p: Page) => p.locator(".wom-pin").count();

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const p = await ctx.newPage();
const errors: string[] = [];
const tileHosts = new Set<string>();
let sealBody: { spots?: { lat?: number; lon?: number }[] } | null = null;
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
p.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/events")) sealBody = JSON.parse(r.postData() ?? "null"); });
p.on("request", (r) => /\/\d+\/\d+\/\d+\.png/.test(r.url()) && tileHosts.add(new URL(r.url()).host));

await p.goto(`${base}/login`); await p.fill("#username", "admin"); await p.fill("#password", password); await p.click("button:has-text('Sign in')"); await p.waitForURL(`${base}/`);
await p.goto(`${base}/events/new`);
await p.waitForSelector(".leaflet-container");
const copy = await p.locator("main").innerText();
log(!/thin\s+indoors/i.test(copy), "the 'thin indoors' sentence is gone");
log(/clicking the map/i.test(copy) && /typing coordinates/i.test(copy), "the planner text says you can click the map or type coordinates");
log(await pins(p) === 0, "no pins before anything is set");

const map = p.locator(".wom-map");
await map.scrollIntoViewIfNeeded();
let box = (await map.boundingBox())!;
const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

// the wheel scrolls the page (not the map) until the map has been clicked
const y0 = await p.evaluate("window.scrollY") as number;
await p.mouse.move(at(0.5, 0.5).x, at(0.5, 0.5).y); await p.mouse.wheel(0, 240); await p.waitForTimeout(300);
log((await p.evaluate("window.scrollY") as number) > y0, "scrolling over the map scrolls the page before the map is clicked");
await map.scrollIntoViewIfNeeded(); box = (await map.boundingBox())!;

// start point by clicking
await p.mouse.click(at(0.5, 0.5).x, at(0.5, 0.5).y);
const lat0 = await val(p, "#lat"), lon0 = await val(p, "#lon");
log(/^-?\d+\.\d{5}$/.test(lat0) && /^-?\d+\.\d{5}$/.test(lon0), `a click sets the start point (${lat0}, ${lon0})`);
log(await pins(p) === 1 && (await p.locator(".wom-pin.start").count()) === 1, "one start pin is drawn");

// spots: pick Spot 1, then each click places the next spot
await p.click("button:has-text('Spot 1')");
await map.scrollIntoViewIfNeeded(); box = (await map.boundingBox())!;
const clicks = [at(0.3, 0.4), at(0.65, 0.35), at(0.55, 0.7)];
for (const c of clicks) await p.mouse.click(c.x, c.y);
const spotVals = [await val(p, "#lat-0"), await val(p, "#lat-1"), await val(p, "#lat-2")];
log(spotVals.every((v) => /^-?\d+\.\d{5}$/.test(v)) && new Set(spotVals).size === 3, `three clicks fill three different spots (${spotVals.join(", ")})`);
log(await pins(p) === 4, "four pins: the start and three spots");
log((await p.locator(".wom-pin.spot").allInnerTexts()).join("") === "123", "spot pins are numbered 1, 2, 3");
log(await p.locator("text=set by hand").count() === 3, "the spots are marked 'set by hand'");

// drag spot 2
const before = await val(p, "#lat-1"), beforeLon = await val(p, "#lon-1");
const pin2 = (await p.locator(".wom-pin.spot", { hasText: "2" }).boundingBox())!;
await p.mouse.move(pin2.x + pin2.width / 2, pin2.y + pin2.height / 2);
await p.mouse.down(); await p.mouse.move(pin2.x + 20, pin2.y + 60, { steps: 8 }); await p.mouse.move(pin2.x + 40, pin2.y + 100, { steps: 8 }); await p.mouse.up();
const after = await val(p, "#lat-1"), afterLon = await val(p, "#lon-1");
log(after !== before && afterLon !== beforeLon, `dragging a pin moves its coordinates (${before} -> ${after})`);

// typed coordinates move the pin and the map follows
await p.fill("#lat", "43.0507"); await p.fill("#lon", "-75.9755");
await p.waitForTimeout(600);
const startPin = (await p.locator(".wom-pin.start").boundingBox())!;
const mb = (await map.boundingBox())!;
log(startPin.x > mb.x && startPin.x < mb.x + mb.width && startPin.y > mb.y && startPin.y < mb.y + mb.height, "typing coordinates brings the start pin into view");
await p.fill("#lat-0", "95");
await p.waitForTimeout(200);
log(await pins(p) === 3, "an out-of-range coordinate is not drawn");
await p.fill("#lat-0", "43.0515");

// fewer spots removes pins
await p.selectOption("#count", "2");
await p.waitForTimeout(300);
log(await pins(p) === 3 && (await p.locator("button:has-text('Spot 3')").count()) === 0, "dropping to 2 codes removes spot 3's pin and button");

// demo fill recenters on the demo start
await p.click("button:has-text('Fill in the demo')");
await p.waitForTimeout(500);
log((await val(p, "#lat")) === "43.0693" && await pins(p) >= 1, "the demo fill moves the start pin");

// attribution and tile requests
log(await p.locator(".leaflet-control-attribution a:has-text('OpenStreetMap')").count() === 1, "the map shows OpenStreetMap attribution");
log(tileHosts.size > 0 ? [...tileHosts].every((h) => h === "tile.openstreetmap.org") : true, `tiles came from ${[...tileHosts].join(", ") || "(none loaded: offline?)"}`);
log(/tile\.openstreetmap\.org/.test(await p.locator("main").innerText()), "the page says which server the map pictures come from");

// seal an event with map-made spots
await p.selectOption("#count", "3");
await p.fill("#lat", "43.0507"); await p.fill("#lon", "-75.9755");
await p.mouse.move(0, 0);
await p.click("button:has-text('Spot 1')");
await map.scrollIntoViewIfNeeded();
const b2 = (await map.boundingBox())!;
for (const [fx, fy] of [[0.4, 0.45], [0.6, 0.5], [0.5, 0.6]]) await p.mouse.click(b2.x + b2.width * fx, b2.y + b2.height * fy);
for (let i = 0; i < 3; i++) { await p.fill(`#label-${i}`, `Spot ${i + 1} place`); await p.fill(`#clue-${i}`, `Clue ${i + 1}`); }
await p.fill("#title", "Map test"); await p.fill("#startsAt", "2026-10-31T19:00"); await p.fill("#codename", "Map Test"); await p.fill("#zip", "13204");
await p.click("button:has-text('Seal event and make codes')");
await p.waitForURL(/\/print$/, { timeout: 30000 });
const sent = (sealBody as { spots?: { lat?: number; lon?: number }[] } | null)?.spots ?? [];
log(sent.length === 3 && sent.every((s) => typeof s.lat === "number" && typeof s.lon === "number" && Math.abs(s.lat - 43.0507) < 0.01), `the sealed event kept the map-placed coordinates (${sent.map((s) => s.lat).join(", ")})`);

// narrow screen: the map fits and can still be clicked
const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, storageState: await ctx.storageState() })).newPage();
await phone.goto(`${base}/events/new`); await phone.waitForSelector(".leaflet-container");
const pb = (await phone.locator(".wom-map").boundingBox())!;
log(pb.width <= 390 && pb.width > 250, `the map fits a phone screen (${Math.round(pb.width)} px wide)`);
const noScroll = await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1");
log(noScroll === true, "no sideways scrolling on a phone");

log(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll map checks passed");
process.exit(fails ? 1 : 0);
