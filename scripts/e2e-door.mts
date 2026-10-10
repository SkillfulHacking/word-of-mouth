// Real-browser test of the door check-in: phones set up passes, the door shows a code, guests prove they're on the list.
// Usage: BASE=http://localhost:3117 ADMIN_PASSWORD=... pnpm tsx scripts/e2e-door.mts   (server running, DB seeded with an admin)
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3117";
const password = process.env.ADMIN_PASSWORD ?? "";
const out = path.join(process.cwd(), "docs", "screenshots");
let fails = 0;
const log = (ok: boolean, m: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); };
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const phoneOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;

// ---- the coordinator's laptop
const adminCtx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const admin = await adminCtx.newPage();
await admin.goto(`${base}/login`);
await admin.fill("#username", "admin");
await admin.fill("#password", password);
await admin.click("button:has-text('Sign in')");
await admin.waitForURL(`${base}/`);
const ev = await (await admin.request.post(`${base}/api/events`, { data: {
  codename: "Operation Pumpkin Ledger", zip: "13204",
  details: { title: "Halloween Costume Party", startsAt: "2026-10-31T19:00", venue: "Freddy Fazbear's Pizza (fictional demo venue)", address: "9090 Destiny USA Dr", notes: "Costumes required." },
  threshold: 2, spots: [1, 2, 3].map((i) => ({ label: `p${i}`, clue: `clue ${i}` })),
} })).json();
const eventId = ev.id as string;

// ---- four guests, each on their own "phone" (separate browser context = separate storage)
type Guest = { name: string; page: Page; ctx: Awaited<ReturnType<typeof browser.newContext>> };
const guests: Guest[] = [];
for (const name of ["ada", "ben", "cyrus", "dee"]) {
  const code = (await (await admin.request.post(`${base}/api/events/${eventId}/invites`, { data: { note: name } })).json()).code as string;
  const ctx = await browser.newContext(phoneOpts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`   [${name} page error] ${e.message}`));
  await page.goto(`${base}/i/${code}`);
  await page.fill("#username", name);
  await page.fill("#password", "longenough1");
  await page.click("button:has-text('Accept invitation')");
  await page.waitForURL(`${base}/tickets`);
  guests.push({ name, page, ctx });
}
log(guests.length === 4, "4 guests signed up through invites and hold tickets");

// ---- three of them set up a door pass (dee deliberately doesn't)
for (const g of guests.slice(0, 3)) {
  await g.page.goto(`${base}/pass/${eventId}`);
  if (g.name === "ada") await shot(g.page, "16-pass-setup-phone");
  await g.page.click("button:has-text('Set up my door pass')");
  await g.page.waitForSelector("text=Your door pass is ready", { timeout: 30_000 });
  if (g.name === "ada") await shot(g.page, "17-pass-ready-phone");
}
log(true, "ada, ben and cyrus set up door passes in the browser");
const stored = await guests[0].page.evaluate((id) => localStorage.getItem(`wom:pass:${id}`), eventId);
log(!!stored, "the secret identity is kept in the phone's own storage");
const sentToServer = JSON.stringify(await (await admin.request.get(`${base}/events/${eventId}`)).text());
log(!!stored && !sentToServer.includes(stored.slice(0, 20)), "…and that secret does not appear anywhere the server shows");

// ---- the door
const door = await adminCtx.newPage();
await door.goto(`${base}/events/${eventId}/door`);
const currentLink = async () => {
  for (let i = 0; i < 40; i++) {
    const t = (await door.locator("details p").textContent().catch(() => ""))?.trim();
    if (t) return t;
    await door.waitForTimeout(250);
  }
  throw new Error("door never showed a link");
};
const link1 = await currentLink();
await door.waitForSelector("img[alt='Door QR code']");
await door.waitForSelector("text=door passes set up");
await shot(door, "18-door-screen");
log(/passes set up/.test((await door.locator("main").innerText())), "door screen shows the QR and the counts");

// ---- ada scans: this is the real proof, made in her browser
const ada = guests[0].page;
const t0 = Date.now();
await ada.goto(link1);
await ada.waitForSelector("text=You're in", { timeout: 90_000 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
log(true, `ada checked in with a real proof made in her browser (${secs} s, including loading the page and circuit files)`);
await shot(ada, "19-checked-in-phone");
await door.waitForSelector("text=Admitted", { timeout: 10_000 });
await shot(door, "20-door-admitted");
log(true, "the door screen flashed green: Admitted");
await door.waitForFunction((old) => (document.querySelector("details p")?.textContent ?? "") !== old && !document.body.innerText.includes("Admitted"), link1, { timeout: 15_000 });
const link2 = await currentLink();
log(link2 !== link1, "a fresh door code appeared for the next guest");

// ---- ada tries again with the new code: same person, same event => same nullifier
await ada.goto(link2);
await ada.waitForSelector("text=Couldn't check you in", { timeout: 90_000 });
log((await ada.locator("main").innerText()).includes("Already checked in"), "ada can't check in twice");
await shot(ada, "21-already-checked-in-phone");
await door.waitForSelector("text=Last attempt: Already checked in", { timeout: 10_000 });
log(true, "the door screen reports the repeat attempt, and the door code is NOT burned");
log((await currentLink()) === link2, "…the same door code is still showing");

// ---- ben uses that same door code and gets in
const ben = guests[1].page;
await ben.goto(link2);
await ben.waitForSelector("text=You're in", { timeout: 90_000 });
log(true, "ben checks in with the same code ada was refused on");

// ---- people who shouldn't get in
await door.waitForFunction((old) => (document.querySelector("details p")?.textContent ?? "") !== old, link2, { timeout: 15_000 });
const link3 = await currentLink();
const dee = guests[3].page; // has a ticket but never set up a pass
await dee.goto(link3);
await dee.waitForSelector("text=Couldn't check you in", { timeout: 30_000 });
log((await dee.locator("main").innerText()).includes("no door pass in this browser"), "dee (ticket, no pass) is turned away with a clear reason");
const stranger = await (await browser.newContext(phoneOpts)).newPage();
await stranger.goto(link3);
await stranger.waitForSelector("text=Couldn't check you in", { timeout: 30_000 });
log(true, "a stranger with no account and no pass is turned away");

// ---- the old, used link is dead
const cy = guests[2].page;
await cy.goto(link1);
await cy.waitForSelector("text=Couldn't check you in", { timeout: 90_000 });
log((await cy.locator("main").innerText()).includes("already used"), "cyrus can't use ada's already-used door code");

// ---- cy checks in properly with the current code; counts update
await cy.goto(await currentLink());
await cy.waitForSelector("text=You're in", { timeout: 90_000 });
await door.waitForSelector("text=3 of 4", { timeout: 10_000 });
log(true, "after three admissions the door shows 3 of 4 tickets checked in");

// ---- a guest list is only for ticket holders
const anon = await (await browser.newContext()).newPage();
log((await anon.request.get(`${base}/api/events/${eventId}/group`)).status() === 401, "the guest list requires sign-in (401)");

await browser.close();
console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
