// Real-browser test of bulk invites and the print sheet: make a batch as a promoter, render every paper/layout,
// count the printed pages, and READ each QR code back out of the rendered pixels to prove it scans.
// Usage: BASE=http://localhost:3120 ADMIN_PASSWORD=... pnpm tsx scripts/e2e-print.mts   (server running, DB seeded with an admin)
import path from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { chromium, type Page } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3120";
const password = process.env.ADMIN_PASSWORD ?? "";
const out = path.join(process.cwd(), "docs", "screenshots");
let fails = 0;
const log = (ok: boolean, m: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); };
const login = async (p: Page, u: string, pw: string) => { await p.goto(`${base}/login`); await p.fill("#username", u); await p.fill("#password", pw); await p.click("button:has-text('Sign in')"); await p.waitForURL(`${base}/`); };

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const adminCtx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const admin = await adminCtx.newPage();
await login(admin, "admin", password);
await admin.request.post(`${base}/api/users`, { data: { username: "pat", password: "longenough1", role: "promoter" } });
await admin.request.post(`${base}/api/users`, { data: { username: "quinn", password: "longenough1", role: "promoter" } });
const ev = await (await admin.request.post(`${base}/api/events`, { data: {
  codename: "Operation Pumpkin Ledger", zip: "13204", theme: "fireside",
  details: { title: "Halloween Costume Party", startsAt: "2026-10-31T19:00", venue: "Secret Venue", address: "Secret Address", notes: "" },
  threshold: 2, spots: [1, 2, 3].map((i) => ({ label: `p${i}`, clue: `clue ${i}` })),
} })).json();
const eventId = ev.id as string;
const manage = await (await admin.request.get(`${base}/events/${eventId}`)).text();
const idOf = (name: string) => Number(new RegExp(`<option value="(\\d+)"[^>]*>${name}</option>`).exec(manage)![1]);
await admin.request.post(`${base}/api/events/${eventId}/promoters`, { data: { promoterId: idOf("pat"), quota: 25 } });
await admin.request.post(`${base}/api/events/${eventId}/promoters`, { data: { promoterId: idOf("quinn"), quota: 25 } });

// ---- the promoter makes a batch of 10 through the UI
const patCtx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 3 });
const pat = await patCtx.newPage();
await login(pat, "pat", "longenough1");
await pat.goto(`${base}/promote`);
await pat.waitForSelector("text=Print a batch");
log((await pat.locator("main").innerText()).includes("25 of 25"), "promoter sees their full quota before making a batch");
await pat.fill("input[id^='bulk-count-']", "10");
await pat.fill("input[id^='bulk-note-']", "Farmers market flyers");
await pat.click("button:has-text('Create and print')");
await pat.waitForURL(/\/print\/invites\/.+\?batch=/);
const batchUrl = pat.url();
await pat.waitForSelector(".invite-card .ic-qrbox svg", { timeout: 20_000 });
log((await pat.locator("article.invite-card").count()) === 10, "the print page shows 10 invite cards");
await pat.screenshot({ path: path.join(out, "22-print-invites-4up.png"), fullPage: true });

// ---- asking for more than the quota is refused, with the number they can still make
await pat.goto(`${base}/promote`);
await pat.waitForSelector("text=Print a batch");
log((await pat.locator("main").innerText()).includes("15 of 25"), "the quota now shows 15 left");
const tooMany = await pat.request.post(`${base}/api/events/${eventId}/invites/batch`, { data: { count: 16, note: "" } });
const tooManyBody = await tooMany.json();
log(tooMany.status() === 409 && /15 more/.test(tooManyBody.error), `asking for 16 with 15 left is refused: "${tooManyBody.error}"`);
log((await pat.request.post(`${base}/api/events/${eventId}/invites/batch`, { data: { count: 0, note: "" } })).status() === 400, "asking for 0 is refused");

// ---- every paper and layout: count printed pages and decode every QR code
await pat.goto(batchUrl);
await pat.waitForSelector(".invite-card .ic-qrbox svg");
const codes = (await pat.locator("article.invite-card").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code!)));
log(codes.length === 10 && new Set(codes).size === 10, "all 10 codes on the sheet are different");
await pat.fill("#base", "https://invites.example.org");
await pat.waitForFunction(() => document.querySelector(".ic-link")?.textContent?.startsWith("invites.example.org"));

const decode = async (selector: string) => {
  const png = PNG.sync.read(await pat.locator(selector).screenshot());
  const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return r?.data ?? null;
};
const pdfPages = (buf: Buffer) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

for (const paper of ["letter", "a4"] as const) {
  for (const per of [1, 2, 4, 8] as const) {
    await pat.selectOption("#paper", paper);
    await pat.selectOption("#persheet", String(per));
    await pat.emulateMedia({ media: "print" });
    const pdf = await pat.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = pdfPages(pdf);
    const want = Math.ceil(10 / per);
    let decoded = 0, matched = 0;
    for (const code of codes) {
      const text = await decode(`article[data-code="${code}"] .ic-qrbox`);
      if (text) decoded++;
      if (text === `https://invites.example.org/i/${code}`) matched++;
    }
    log(pages === want && decoded === 10 && matched === 10, `${paper.padEnd(6)} ${per}-up: ${pages} page(s) (want ${want}); QR codes read back ${decoded}/10, matching their invite link ${matched}/10`);
    await pat.emulateMedia({ media: "screen" });
    if (paper === "letter" && (per === 1 || per === 8)) await pat.screenshot({ path: path.join(out, `23-print-invites-${per}up.png`), fullPage: true });
  }
}

// ---- a scanned code leads to a working, themed invite page
const sample = await decode(`article[data-code="${codes[0]}"] .ic-qrbox`);
const path0 = new URL(sample!).pathname;
const guest = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
await guest.goto(`${base}${path0}`);
log((await guest.locator("main").innerText()).includes("Operation Pumpkin Ledger"), "the decoded link opens the invite page for the right event");
log(!/Secret Venue|Secret Address/.test(await guest.content()), "…and that page does not reveal the venue or address");

// ---- who can print what
const quinn = await (await browser.newContext()).newPage();
await login(quinn, "quinn", "longenough1");
const nope = await quinn.goto(batchUrl);
log(nope!.status() === 404 || !(await quinn.locator("article.invite-card").count()), "another promoter can't print pat's batch");
const anon = await (await browser.newContext()).newPage();
await anon.goto(batchUrl);
log(anon.url().includes("/login"), "a signed-out visitor is sent to sign in");

// ---- the coordinator/admin sees the batch and can reprint; used invites drop out
await admin.goto(`${base}/events/${eventId}`);
log((await admin.locator("main").innerText()).includes("Farmers market flyers"), "the event page lists the batch");
const g2 = await (await browser.newContext()).newPage();
await g2.goto(`${base}${path0}`);
await g2.fill("#username", "guestone"); await g2.fill("#password", "longenough1");
await g2.click("button:has-text('Accept invitation')"); await g2.waitForURL(`${base}/tickets`);
await pat.goto(batchUrl);
await pat.waitForSelector(".invite-card");
log((await pat.locator("article.invite-card").count()) === 9, "after one guest accepts, a reprint has 9 cards (the used one is gone)");
const nums = await pat.locator(".ic-num").allInnerTexts();
// codes[0] was invite 01 of 10 and is now used, so the reprint must be exactly 02..10, still numbered "of 10"
const want = Array.from({ length: 9 }, (_, i) => `Invite ${String(i + 2).padStart(2, "0")} of 10 · single use`);
log(JSON.stringify(nums.map((t) => t.trim())) === JSON.stringify(want), "the remaining cards keep their original numbers: exactly 02 to 10, each 'of 10'");

await browser.close();
console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
