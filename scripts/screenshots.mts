// Drives the real app in headless Chrome and saves screenshots to docs/screenshots.
// Usage: BASE=http://localhost:3114 ADMIN_PASSWORD=... pnpm screenshots   (server must already be running)
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3114";
const password = process.env.ADMIN_PASSWORD ?? "";
const out = path.join(process.cwd(), "docs", "screenshots");
const shot = (page: Page, name: string, full = true) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

// ---- Coordinator on a laptop
const desktop = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await desktop.newPage();
await page.goto(`${base}/login`);
await shot(page, "01-login");
await page.fill("#username", "admin");
await page.fill("#password", password);
await page.click("button:has-text('Sign in')");
await page.waitForURL(`${base}/`);
await shot(page, "02-dashboard-admin");

for (const [username, role] of [["casey", "coordinator"], ["pat", "promoter"], ["alex", "attendee"]]) {
  await page.request.post(`${base}/api/users`, { data: { username, password: "longenough1", role } });
}
await page.goto(`${base}/admin/users`);
await shot(page, "03-admin-users");

await page.goto(`${base}/events/new`);
await page.click("button:has-text('Fill in the demo')");
await page.selectOption("#threshold", "2");
const hand = [
  ["Food court, north entrance (placeholder)", "Where costumes first meet the crowd.", "43.0702", "-76.1731"],
  ["Carousel (placeholder)", "Round and round, the ghosts go.", "43.0693", "-76.1727"],
  ["Main atrium (placeholder)", "Look up when the lights flicker.", "43.0687", "-76.1722"],
];
for (const [i, [label, clue, lat, lon]] of hand.entries()) {
  await page.fill(`#label-${i}`, label);
  await page.fill(`#clue-${i}`, clue);
  await page.fill(`#lat-${i}`, lat);
  await page.fill(`#lon-${i}`, lon);
}
await shot(page, "04-new-event-filled");

await page.click("button:has-text('Seal event and make codes')");
await page.waitForURL(/\/events\/[^/]+\/print/);
await page.waitForSelector(".tag img");
await shot(page, "05-print-sheet");
const id = page.url().split("/events/")[1].split("/")[0];
const stash = JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), `wom:print:${id}`))!) as { shares: { idx: number; share: string }[] };
const urls = stash.shares.map((s) => `${base}/s/${id}#${s.idx}.${s.share}`);
await page.goto(`${base}/events`);
await shot(page, "06-events-list");

// ---- Hunter on a phone: not signed in, one tab, scanning codes one after another
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const hunter = await phone.newPage();
await hunter.goto(`${base}/e/${id}`);
await shot(hunter, "07-hunt-page-phone");
await hunter.goto(urls[0]);
await hunter.waitForSelector("text=Shards found");
await shot(hunter, "08-one-code-found-phone");
await hunter.goto(urls[2]); // second scan, same tab: only the #fragment changes
await hunter.waitForTimeout(1500);
const unlocked = await hunter.locator("text=Costumes required").count();
console.log(`second scan in the same tab unlocked the event: ${unlocked > 0}`);
await shot(hunter, "09-after-second-code-phone");

// the new-event form on a phone too
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/events/new`);
await shot(page, "10-new-event-phone");

// ---- Word of mouth: coordinator assigns a promoter, the promoter invites, a stranger accepts on a phone
const manageHtml = await (await page.request.get(`${base}/events/${id}`)).text();
const promoterId = Number(/<option value="(\d+)"[^>]*>pat<\/option>/.exec(manageHtml)![1]);
await page.setViewportSize({ width: 1100, height: 800 });
await page.request.post(`${base}/api/events/${id}/promoters`, { data: { promoterId, quota: 3 } });

const promoterCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const pat = await promoterCtx.newPage();
await pat.goto(`${base}/login`);
await pat.fill("#username", "pat");
await pat.fill("#password", "longenough1");
await pat.click("button:has-text('Sign in')");
await pat.waitForURL(`${base}/`);
const minted = await pat.request.post(`${base}/api/events/${id}/invites`, { data: { note: "Sam from book club" } });
const inviteCode = (await minted.json()).code as string;
await pat.goto(`${base}/promote`);
await pat.fill("input[id^='note-']", "Jordan from work");
await pat.click("button:has-text('Create invite')");
await pat.waitForSelector("text=Jordan from work");
await pat.click("button:has-text('Show QR') >> nth=0");
await pat.waitForSelector("img[alt*='invite']");
await shot(pat, "11-promoter-invites");

const strangerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const guest = await strangerCtx.newPage();
await guest.goto(`${base}/i/${inviteCode}`);
await guest.fill("#username", "jordan");
await guest.fill("#password", "longenough1");
await shot(guest, "12-invite-page-phone");
await guest.click("button:has-text('Accept invitation')");
await guest.waitForURL(`${base}/tickets`);
await guest.waitForSelector("text=valid");
await shot(guest, "13-ticket-phone");
await guest.goto(`${base}/i/${inviteCode}`);
await shot(guest, "14-used-invite-phone");

await page.goto(`${base}/events/${id}`);
await shot(page, "15-manage-event");

await browser.close();
console.log("saved to", out);
