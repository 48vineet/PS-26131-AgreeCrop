// Browser verification of the expert validation image UI.
// - "available" path: intercepts ONLY the detail response and fills image.url
//   with a real data-URL photo. App code is untouched; the component's real
//   <img>/Modal/onError logic runs. This proves the UI, not the broken
//   Supabase credential.
// - "unavailable" path: lets the real backend response through.
// Delete after use.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const FRONTEND = "http://localhost:3000";
// App.jsx gates /extension/validation to the extension_officer role, so the
// expert account cannot reach the page in the real UI. The extension officer
// is the reviewer this page is built for.
const EMAIL = "extension@email.com";
const PASSWORD = "Pass@123";
const PHOTO = `data:image/jpeg;base64,${readFileSync("C:/Users/Vineet/OneDrive/Desktop/Practical/SIH 2026 CROP/backend/qa_test_leaf.jpg").toString("base64")}`;

const log = (...a) => console.log("[e2e]", ...a);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

async function login() {
  await page.goto(`${FRONTEND}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/farmer|extension|dashboard|validation/, { timeout: 30000 });
  log("logged in ->", page.url());
}

async function openDetail() {
  await page.goto(`${FRONTEND}/extension/validation`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const items = page.locator('button:has-text("AI confidence")');
  const n = await items.count();
  log("queue items:", n);
  if (!n) throw new Error("empty queue");
  await items.first().click();
  await page.waitForTimeout(2000);
}

// ── Path A: image AVAILABLE (stub detail only) ──────────────────────────
log("=== PATH A: image available ===");
await page.route("**/validation/observations/*", async (route) => {
  const res = await route.fetch();
  const body = await res.json();
  body.image = {
    observation_id: body.observation_id,
    available: true,
    url: PHOTO,
    expires_at: new Date(Date.now() + 900e3).toISOString(),
    ttl_seconds: 900,
    sha256: body.image?.sha256 ?? null,
    viewer: "reviewer",
  };
  await route.fulfill({ response: res, json: body });
});
await login();
await openDetail();

const img = page.locator("section img").first();
log("img count:", await img.count());
const src = await img.getAttribute("src");
log("img src prefix:", src?.slice(0, 30));
const nat = await img.evaluate((el) => ({ complete: el.complete, w: el.naturalWidth, h: el.naturalHeight }));
log("natural:", JSON.stringify(nat), "| RENDERED:", nat.complete && nat.w > 0);

const body = await page.locator("body").innerText();
log("AI confidence visible:", body.includes("AI confidence"));
log("Submit Validation visible:", body.includes("Submit Validation"));

// Enlarge / lightbox
const zoom = page.locator('button[aria-label="Enlarge screening image"]');
log("enlarge button present:", await zoom.count());
await zoom.click({ force: true });
await page.waitForTimeout(600);
log("lightbox open:", (await page.locator('[role="dialog"]').count()) > 0);
log("lightbox img present:", (await page.locator('[role="dialog"] img').count()) > 0);
await page.screenshot({ path: "e2e-lightbox.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
log("lightbox closed on Escape:", (await page.locator('[role="dialog"]').count()) === 0);
await page.screenshot({ path: "e2e-detail-available.png" });

// Broken-image path: same stub, but a URL that 404s.
await page.unroute("**/validation/observations/*");
await page.route("**/validation/observations/*", async (route) => {
  const res = await route.fetch();
  const body = await res.json();
  body.image = { ...body.image, available: true, url: "http://localhost:3000/__missing_img__.jpg" };
  await route.fulfill({ response: res, json: body });
});
await page.goto(`${FRONTEND}/extension/validation`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.locator('button:has-text("AI confidence")').first().click();
await page.waitForTimeout(2000);
const t2 = await page.locator("body").innerText();
log("=== PATH C: broken image ===");
log("shows 'Image failed to load':", t2.includes("Image failed to load"));
log("form still usable (Submit visible):", t2.includes("Submit Validation"));
await page.screenshot({ path: "e2e-image-failed.png" });

// ── Path B: image UNAVAILABLE (real backend) ────────────────────────────
log("=== PATH B: real backend, image unavailable ===");
await page.unroute("**/validation/observations/*");
await page.goto(`${FRONTEND}/extension/validation`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.locator('button:has-text("AI confidence")').first().click();
await page.waitForTimeout(2000);
const t3 = await page.locator("body").innerText();
log("shows 'Image unavailable':", t3.includes("Image unavailable"));
log("shows backend reason text:", t3.includes("No photograph is stored"));
log("no <img> rendered:", (await page.locator("section img").count()) === 0);
log("form still usable:", t3.includes("Submit Validation"));
await page.screenshot({ path: "e2e-image-unavailable.png" });

log("console errors:", consoleErrors.length);
for (const e of consoleErrors.slice(0, 8)) log("  -", e.slice(0, 160));
await browser.close();
log("done");
