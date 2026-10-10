// Real end-to-end test of event images: the local model writes a prompt, ComfyUI paints two pictures, one is chosen,
// and it appears (publicly) on the invite, hunt and unlock pages and on the printed cards, while the other stays private.
// Needs a running app with COMFYUI_URL and OLLAMA_URL pointing at real servers.
// Usage: BASE=http://localhost:3121 ADMIN_PASSWORD=... pnpm tsx scripts/e2e-images.mts
import path from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3121";
const password = process.env.ADMIN_PASSWORD ?? "";
const out = path.join(process.cwd(), "docs", "screenshots");

// Physical checks, run with print media on: the smallest QR in millimetres (96 CSS px = 25.4 mm), and anything that
// runs past its card's edge (a printed line that gets cut off is a defect). A title may be clamped to 3 lines.
const QR_MM_JS = `(function(){ var s=document.querySelectorAll(".ic-qrbox svg"), m=1e9; for(var i=0;i<s.length;i++){ m=Math.min(m, s[i].getBoundingClientRect().width/3.7795);} return m; })()`;
const OVERFLOW_JS = `(function(){ var bad=[], c=document.querySelectorAll("article.invite-card"); for (var i=0;i<c.length;i++){ var card=c[i].getBoundingClientRect(); var kids=c[i].querySelectorAll(".ic-title,.ic-zip,.ic-how,.ic-qrbox,.ic-link,.ic-num"); for (var k=0;k<kids.length;k++){ var r=kids[k].getBoundingClientRect(); if (r.bottom>card.bottom+0.5||r.right>card.right+0.5||r.top<card.top-0.5||r.left<card.left-0.5) bad.push(kids[k].className+" "+Math.round(r.bottom-card.bottom)+"px"); } } return bad.join(", "); })()`;
let fails = 0;
const log = (ok: boolean, m: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); };

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const adminCtx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const admin = await adminCtx.newPage();
await admin.goto(`${base}/login`); await admin.fill("#username", "admin"); await admin.fill("#password", password); await admin.click("button:has-text('Sign in')"); await admin.waitForURL(`${base}/`);
const ev = await (await admin.request.post(`${base}/api/events`, { data: {
  codename: "Operation Pumpkin Ledger", zip: "13204", theme: "amethyst-dawn",
  details: { title: "Halloween Costume Party", startsAt: "2026-10-31T19:00", venue: "Secret Venue", address: "Secret Address", notes: "" },
  threshold: 2, spots: [1, 2, 3].map((i) => ({ label: `p${i}`, clue: `Where the lights flicker, number ${i}.` })),
} })).json();
const id = ev.id as string;
const inviteCode = (await (await admin.request.post(`${base}/api/events/${id}/invites`, { data: { note: "x" } })).json()).code as string;

// ---- the studio
await admin.goto(`${base}/events/${id}`);
await admin.waitForSelector("text=Connected to ComfyUI", { timeout: 20_000 });
const banner = await admin.locator("main").innerText();
log(/Connected to ComfyUI on NVIDIA GeForce RTX 3060/.test(banner), "the studio reports the real GPU and model");

await admin.fill("#idea", "a spooky but friendly costume gathering, candlelight, carved pumpkins");
await admin.click("button:has-text('Write the prompt')");
await admin.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement).value.length > 20, null, { timeout: 150_000 });
const prompt = await admin.inputValue("#prompt");
console.log("   prompt written by the local model:", prompt.slice(0, 220));
log(!/invitation|poster|banner|flyer|\btext\b|\blogo\b/i.test(prompt), "the written prompt contains none of the words that cause fake lettering");

await admin.selectOption("#count", "2");
await admin.click("button:has-text('Make 2 pictures')");
await admin.waitForSelector("text=Making this one", { timeout: 15_000 });
await admin.screenshot({ path: path.join(out, "24-image-studio-working.png"), fullPage: true });
const t0 = Date.now();
await admin.waitForFunction(() => document.querySelectorAll("figure img").length >= 2, null, { timeout: 280_000, polling: 1000 });
log(true, `ComfyUI made 2 pictures (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
await admin.screenshot({ path: path.join(out, "25-image-studio-done.png"), fullPage: true });

// ---- choose one
const ids = await admin.locator("figure img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src.match(/images\/([^?]+)/)![1]));
const [chosen, spare] = ids;
await admin.locator("figure", { has: admin.locator(`img[src*="${chosen}"]`) }).locator("button:has-text('Use as event image')").click();
await admin.waitForSelector("text=Event image");

// ---- privacy: the chosen one is public, the spare is not
const anon = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true })).newPage();
const pubRes = await anon.request.get(`${base}/api/images/${chosen}?v=web`);
log(pubRes.status() === 200 && pubRes.headers()["content-type"] === "image/jpeg", "a stranger can load the chosen picture");
const jpeg = await pubRes.body();
log(jpeg[0] === 0xff && jpeg[1] === 0xd8, "…and it is a real JPEG");
log((await anon.request.get(`${base}/api/images/${spare}?v=web`)).status() === 404, "a stranger CANNOT load the other picture (404)");
log((await anon.request.get(`${base}/api/images/${spare}?v=full`)).status() === 404, "…nor its full-size version");
const adminSpare = await admin.request.get(`${base}/api/images/${spare}?v=web`);
log(adminSpare.status() === 200 && adminSpare.headers()["cache-control"] === "private, no-store", "the coordinator can still see it, and it is never cached publicly");

// ---- the file has no prompt inside
const full = await (await admin.request.get(`${base}/api/images/${chosen}?v=full`)).body();
const asText = full.toString("latin1");
log(!asText.includes("CheckpointLoaderSimple") && !asText.includes(prompt.slice(0, 30)), "the full-size PNG has no embedded prompt or workflow");
const png = PNG.sync.read(full);
log(png.width === 1344 && png.height === 768, `the full-size picture is ${png.width}x${png.height}`);

// ---- it shows up where guests look
await anon.goto(`${base}/e/${id}`);
log((await anon.locator("img.cover").count()) === 1, "the hunt page shows the picture");
await anon.screenshot({ path: path.join(out, "26-hunt-page-with-image.png"), fullPage: true });
await anon.goto(`${base}/i/${inviteCode}`);
log((await anon.locator("img.cover").count()) === 1, "the invite page shows the picture");
await anon.goto(`${base}/s/${id}`);
await anon.waitForSelector("h1");
log((await anon.locator("img.cover").count()) === 1, "the unlock page shows the picture");
const page = await anon.content();
log(!/Secret Venue|Secret Address/.test(page), "…and no public page reveals the venue or address");

// ---- and on printed cards
const bulk = await (await admin.request.post(`${base}/api/events/${id}/invites/batch`, { data: { count: 4, note: "with picture" } })).json();
await admin.goto(`${base}/print/invites/${id}?batch=${bulk.batch}`);
await admin.waitForSelector(".invite-card .ic-qrbox svg");
await admin.waitForFunction(() => [...document.images].every((i) => i.complete));
log((await admin.locator(".invite-card img.ic-cover").count()) === 4, "all 4 printed cards carry the picture");
// screenshots should show a realistic public address, not localhost
await admin.fill("#base", "https://invites.example.org");
// the picture must never get in the way of the QR code: read every code back in each layout, with the picture present
const cardCodes = await admin.locator("article.invite-card").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code!));
// Real printing is about 300 dpi, roughly 3x a screen's CSS pixels, so read the codes back at that density.
const hiCtx = await browser.newContext({ storageState: await adminCtx.storageState(), viewport: { width: 1000, height: 900 }, deviceScaleFactor: 3 });
const hi = await hiCtx.newPage();
await hi.goto(`${base}/print/invites/${id}?batch=${bulk.batch}`);
await hi.waitForSelector(".invite-card .ic-qrbox svg");
await hi.waitForFunction(() => [...document.images].every((i) => i.complete));
for (const per of ["1", "2", "4", "8"]) {
  await hi.emulateMedia({ media: "screen" }); // the layout controls are hidden when printing, so change layout first
  await hi.selectOption("#persheet", per);
  await hi.emulateMedia({ media: "print" });
  await hi.waitForTimeout(400);
  let ok = 0;
  for (const code of cardCodes) {
    const png = PNG.sync.read(await hi.locator(`article[data-code="${code}"] .ic-qrbox`).screenshot());
    const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (r?.data.endsWith(`/i/${code}`)) ok++;
  }
  const qrMm = (await hi.evaluate(QR_MM_JS)) as number;
  const overflow = (await hi.evaluate(OVERFLOW_JS)) as string;
  log(ok === cardCodes.length && qrMm >= 30 && overflow === "", `${per}-up with the picture: ${ok}/${cardCodes.length} QR codes read back at print density; smallest QR ${qrMm.toFixed(0)} mm (need 30+); overflow: ${overflow || "none"}`);
}
await hiCtx.close();
await admin.selectOption("#persheet", "4");
await admin.waitForTimeout(400);
await admin.screenshot({ path: path.join(out, "27-print-invites-with-image-4up.png"), fullPage: true });
await admin.selectOption("#persheet", "2");
await admin.waitForTimeout(500);
await admin.screenshot({ path: path.join(out, "28-print-invites-with-image-2up.png"), fullPage: true });
const pdfBytes = await (async () => { await admin.emulateMedia({ media: "print" }); const b = await admin.pdf({ preferCSSPageSize: true, printBackground: true }); await admin.emulateMedia({ media: "screen" }); return b; })();
log(pdfBytes.length > 50_000 && pdfBytes.toString("latin1", 0, 4) === "%PDF", `the print PDF renders with the picture (${(pdfBytes.length / 1e6).toFixed(1)} MB)`);

// ---- un-choosing makes it private again
await admin.goto(`${base}/events/${id}`);
await admin.locator("button:has-text('Remove from event')").click();
await admin.waitForSelector("button:has-text('Use as event image') >> nth=1");
log((await anon.request.get(`${base}/api/images/${chosen}?v=web`)).status() === 404, "after removing it from the event, the picture is private again");

await browser.close();
console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
