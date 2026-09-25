/**
 * AGRECROP demo capture — drives the REAL running application and records a
 * polished master screen recording (Acts 0-5). No mocked API responses, no
 * fabricated data, no fake UI. See the top-level task spec for the full
 * per-act requirements; this file implements it against the actual app at
 * http://localhost:3000 / http://127.0.0.1:8000.
 *
 * Usage:
 *   node demo_capture.cjs
 *   node demo_capture.cjs --image="C:\path\to\potato_late_blight.jpg"
 *   DEMO_IMAGE="C:\path\to\image.jpg" node demo_capture.cjs
 *
 * Requires both dev servers already running:
 *   frontend: http://localhost:3000
 *   backend:  http://127.0.0.1:8000
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// ============================================================
// CONSTANTS
// ============================================================

const REPO_ROOT = path.join(__dirname, "..");
const FRONTEND_BASE = "http://localhost:3000";
const BACKEND_BASE = "http://127.0.0.1:8000";

const VIEWPORT = { width: 1920, height: 1080 };

const OUTPUT_DIR = path.join(__dirname, "demo-output");
const RAW_DIR = path.join(OUTPUT_DIR, "raw");
const SHOTS_DIR = path.join(OUTPUT_DIR, "screenshots");
const RECORD_TMP_DIR = path.join(RAW_DIR, "_recording_tmp");
const FINAL_VIDEO_PATH = path.join(RAW_DIR, "agrecrop-demo.webm");
const METADATA_PATH = path.join(OUTPUT_DIR, "metadata.json");

const ACCOUNTS = {
  farmer: { email: "farmer@email.com", password: "Pass@123", role: "farmer" },
  extension: {
    email: "extension@email.com",
    password: "Pass@123",
    role: "extension_officer",
  },
  official: {
    email: "official@email.com",
    password: "Pass@123",
    role: "official",
  },
};

// Directories that must never be searched or recorded into.
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "site-packages",
  "dist",
  "build",
  "demo-output",
  "qa-shots",
  "_recording_tmp",
  ".cache",
]);

// Known to produce a low-confidence "Corn healthy" result — disqualified as
// the primary demo image per the task's own instruction, unless explicitly
// overridden with --image=/DEMO_IMAGE.
const DISQUALIFIED_BASENAMES = new Set(["qa_test_leaf.jpg"]);

const DISEASE_KEYWORDS = [
  "blight",
  "late_blight",
  "early_blight",
  "rust",
  "mildew",
  "mosaic",
  "spot",
  "scab",
  "rot",
  "wilt",
  "bacterial",
  "disease",
  "leaf",
  "potato",
  "tomato",
  "corn",
  "maize",
];

const CHAPTERS = {
  ACT0: "PROBLEM",
  ACT1: "AI DISEASE DETECTION",
  ACT2: "FARMER ACTION",
  ACT3: "EXTENSION RESPONSE",
  ACT4: "FIELD VALIDATION",
  ACT5: "OFFICIAL INTELLIGENCE",
};

// ============================================================
// FAIL-SAFE
// ============================================================

class DemoCaptureError extends Error {
  constructor(act, step, url, cause) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(causeMsg);
    this.name = "DemoCaptureError";
    this.act = act;
    this.step = step;
    this.url = url;
    this.causeMsg = causeMsg;
  }
}

function fail(act, step, url, error) {
  const report = [
    "",
    "DEMO CAPTURE FAILED",
    `Act: ${act}`,
    `Step: ${step}`,
    `URL: ${url}`,
    `Error: ${error instanceof Error ? error.message : String(error)}`,
    "",
  ].join("\n");
  console.error(report);
  throw new DemoCaptureError(act, step, url, error);
}

// ============================================================
// CLI / ENV
// ============================================================

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--image=(.+)$/);
    if (m) out.image = m[1].replace(/^["']|["']$/g, "");
  }
  return out;
}

// ============================================================
// DEMO IMAGE DISCOVERY
// ============================================================

function findCandidateImages(dir, depth, out) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !EXCLUDED_DIR_NAMES.has(entry.name)
    ) {
      findCandidateImages(path.join(dir, entry.name), depth + 1, out);
    }
  }
  return out;
}

function scoreCandidate(filePath) {
  const lower = filePath.toLowerCase();
  let score = 0;
  for (const kw of DISEASE_KEYWORDS) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}

function resolveDemoImage(overridePath) {
  if (overridePath) {
    const resolved = path.isAbsolute(overridePath)
      ? overridePath
      : path.join(REPO_ROOT, overridePath);
    if (!fs.existsSync(resolved)) {
      fail(
        "PRE-FLIGHT",
        "Resolve demo image (explicit override)",
        resolved,
        new Error("Override image path does not exist on disk."),
      );
    }
    console.log(`Using explicitly supplied demo image override: ${resolved}`);
    return { path: resolved, overridden: true };
  }

  const candidates = findCandidateImages(REPO_ROOT, 0, []);
  const eligible = candidates.filter(
    (p) => !DISQUALIFIED_BASENAMES.has(path.basename(p)),
  );

  if (eligible.length === 0) {
    fail(
      "ACT 1 — FARMER AI DETECTION",
      "Resolve demo image",
      "(local filesystem)",
      new Error(
        "Suitable high-confidence demo image required. No usable disease " +
          "image was found in the repository beyond the disqualified " +
          "backend/qa_test_leaf.jpg (which produces a low-confidence " +
          '"Corn healthy" result). Supply one via --image=<path> or the ' +
          "DEMO_IMAGE env var, e.g. a genuine potato late-blight leaf photo. " +
          "Refusing to fabricate or substitute a result.",
      ),
    );
  }

  eligible.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const best = eligible[0];
  console.log(
    `Resolved demo image by keyword ranking: ${best} (score=${scoreCandidate(best)})`,
  );
  return { path: best, overridden: false };
}

// ============================================================
// HUMAN-LIKE INTERACTION HELPERS
// ============================================================

function jitter(base, spread) {
  return base + Math.round((Math.random() - 0.5) * 2 * spread);
}

async function humanPause(page, ms) {
  await page.waitForTimeout(jitter(ms, Math.min(150, ms * 0.15)));
}

async function humanMoveTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return null;
  const targetX = box.x + box.width / 2 + jitter(0, Math.min(6, box.width / 6));
  const targetY = box.y + box.height / 2 + jitter(0, Math.min(6, box.height / 6));
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out
    await page.mouse.move(targetX * ease + (targetX * (1 - ease)) * 0, targetY, { steps: 1 }).catch(() => {});
  }
  await page.mouse.move(targetX, targetY, { steps: 8 });
  return { x: targetX, y: targetY };
}

async function humanClick(page, locator, opts = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause(page, 250);
  await humanMoveTo(page, locator);
  await humanPause(page, 180);
  await locator.click(opts);
}

async function humanType(page, locator, text) {
  await locator.click();
  await locator.pressSequentially(text, { delay: jitter(65, 25) });
}

async function humanScroll(page, totalDeltaY) {
  const steps = 6;
  const perStep = totalDeltaY / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, perStep);
    await humanPause(page, 120);
  }
}

// ============================================================
// CHAPTER MARKER OVERLAY (DOM-based — see metadata limitation note)
// ============================================================

async function showChapter(page, label) {
  await page
    .evaluate((text) => {
      const ID = "__demo_chapter_overlay__";
      let el = document.getElementById(ID);
      if (!el) {
        el = document.createElement("div");
        el.id = ID;
        el.style.position = "fixed";
        el.style.left = "28px";
        el.style.bottom = "26px";
        el.style.zIndex = "2147483647";
        el.style.padding = "9px 16px";
        el.style.borderRadius = "6px";
        el.style.background = "rgba(15, 23, 20, 0.72)";
        el.style.color = "#f2f6f3";
        el.style.font =
          "500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        el.style.letterSpacing = "0.04em";
        el.style.textTransform = "uppercase";
        el.style.pointerEvents = "none";
        el.style.transition = "opacity 500ms ease";
        el.style.opacity = "0";
        document.body.appendChild(el);
      }
      el.textContent = text;
      requestAnimationFrame(() => {
        el.style.opacity = "1";
      });
    }, label)
    .catch(() => {});
}

async function hideChapter(page) {
  await page
    .evaluate(() => {
      const el = document.getElementById("__demo_chapter_overlay__");
      if (el) el.style.opacity = "0";
    })
    .catch(() => {});
  await page.waitForTimeout(550);
}

// ============================================================
// NETWORK HELPERS
// ============================================================

async function withResponse(page, urlPredicate, action, timeout = 20000) {
  const [response] = await Promise.all([
    page.waitForResponse(urlPredicate, { timeout }),
    action(),
  ]);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, json };
}

async function fetchReachable(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// AUTH HELPERS
// ============================================================

async function login(page, accountKey, act) {
  const account = ACCOUNTS[accountKey];
  const loginUrl = `${FRONTEND_BASE}/login`;

  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
  } catch (err) {
    fail(act, `Open login page (${accountKey})`, loginUrl, err);
  }

  await humanPause(page, 900);

  const emailInput = page.locator("#email");
  const passwordInput = page.locator("#password");

  await humanClick(page, emailInput);
  await humanType(page, emailInput, account.email);
  await humanPause(page, 300);

  await humanClick(page, passwordInput);
  await humanType(page, passwordInput, account.password);
  await humanPause(page, 400);

  const submitButton = page.locator('button[type="submit"]');
  await humanClick(page, submitButton);

  try {
    await Promise.race([
      page.waitForURL(/\/(farmer|extension|official)\//, { timeout: 15000 }),
      page
        .getByRole("alert")
        .waitFor({ state: "visible", timeout: 15000 })
        .then(async () => {
          const text = await page.getByRole("alert").innerText().catch(() => "");
          throw new Error(`Login rejected by the application: "${text}"`);
        }),
    ]);
  } catch (err) {
    fail(act, `Login as ${account.email}`, loginUrl, err);
  }

  await humanPause(page, 600);
}

async function logout(page, act) {
  const signOutButton = page.getByRole("button", { name: /logout/i });
  try {
    await humanClick(page, signOutButton);
    await page.waitForURL(/\/login/, { timeout: 10000 });
  } catch (err) {
    fail(act, "Sign out", page.url(), err);
  }
  await humanPause(page, 700);
}

async function gotoViaNav(page, linkText, fallbackPath, act) {
  const link = page.getByRole("link", { name: linkText, exact: false });
  try {
    if (await link.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanClick(page, link.first());
      await page.waitForLoadState("networkidle");
      return;
    }
  } catch {
    // fall through to direct navigation
  }
  try {
    await page.goto(`${FRONTEND_BASE}${fallbackPath}`, {
      waitUntil: "networkidle",
    });
  } catch (err) {
    fail(act, `Navigate to ${linkText}`, `${FRONTEND_BASE}${fallbackPath}`, err);
  }
}

// ============================================================
// ACT 0 — OPENING
// ============================================================

async function actZero(page, state) {
  const act = "ACT 0 — OPENING";
  await showChapter(page, CHAPTERS.ACT0);

  const loginUrl = `${FRONTEND_BASE}/login`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
  } catch (err) {
    fail(act, "Open login page", loginUrl, err);
  }

  await humanPause(page, 1500);

  // Slow, deliberate look at the real brand/capabilities panel — genuine
  // copy already present in the UI (Login.jsx CAPABILITIES + product facts).
  await humanScroll(page, 220);
  await humanPause(page, 1200);
  await humanScroll(page, -220);
  await humanPause(page, 1500);

  const detailsToggle = page.getByText("Test accounts", { exact: false });
  if (await detailsToggle.isVisible().catch(() => false)) {
    await humanClick(page, detailsToggle);
    await humanPause(page, 1800);
  }

  state.metadata.acts.act0 = {
    route: "/login",
    accountRole: null,
    notes:
      "Opening shot recorded from the real login page. No external footage " +
      "or fabricated statistics were composited in-browser; only verified " +
      "on-screen product copy (capabilities list, disease-class/crop/role " +
      "counts already present in Login.jsx) is shown.",
  };

  await hideChapter(page);
}

// ============================================================
// ACT 1 — FARMER AI DETECTION
// ============================================================

async function actOne(page, state, imageInfo) {
  const act = "ACT 1 — FARMER AI DETECTION";
  await login(page, "farmer", act);
  await showChapter(page, CHAPTERS.ACT1);

  // ---- /farmer/farms ----
  const farmsUrl = `${FRONTEND_BASE}/farmer/farms`;
  let farmsJson = null;
  try {
    const { json } = await withResponse(
      page,
      (res) => res.url().includes("/profile/farms") && res.request().method() === "GET",
      () => page.goto(farmsUrl, { waitUntil: "networkidle" }),
    );
    farmsJson = json;
  } catch (err) {
    fail(act, "Load /farmer/farms (GET /profile/farms)", farmsUrl, err);
  }

  const farms = Array.isArray(farmsJson) ? farmsJson : farmsJson?.items || [];
  const farmWithCrop = farms.find((f) => Array.isArray(f.crops) && f.crops.length > 0);
  const targetFarm = farmWithCrop || farms[0];

  if (!targetFarm) {
    fail(
      act,
      "Verify at least one real farm exists",
      farmsUrl,
      new Error("GET /profile/farms returned no farms for farmer@email.com."),
    );
  }

  await humanPause(page, 1200);

  const viewButton = page
    .locator("tr, [role='row']", { hasText: targetFarm.farm_name })
    .getByRole("button", { name: /view/i })
    .first();

  if (await viewButton.isVisible().catch(() => false)) {
    await humanClick(page, viewButton);
    await page.waitForLoadState("networkidle");
    await humanPause(page, 1400);
  } else {
    // Fall back to direct navigation to the same real farm detail route.
    await page.goto(`${FRONTEND_BASE}/farmer/farms/${targetFarm.id}`, {
      waitUntil: "networkidle",
    });
    await humanPause(page, 1400);
  }

  // ---- /farmer/screening ----
  const screeningUrl = `${FRONTEND_BASE}/farmer/screening`;
  try {
    await page.goto(screeningUrl, { waitUntil: "networkidle" });
  } catch (err) {
    fail(act, "Open /farmer/screening", screeningUrl, err);
  }
  await humanPause(page, 1000);

  const fileInput = page.locator('input[type="file"]');
  try {
    await fileInput.setInputFiles(imageInfo.path);
  } catch (err) {
    fail(act, "Upload demo leaf image", screeningUrl, err);
  }
  await humanPause(page, 1200);

  const farmSelect = page.getByLabel("Farm");
  const cropSelect = page.getByLabel("Crop");
  let chosenCropId = null;
  let chosenCropName = null;

  try {
    if (await farmSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanClick(page, farmSelect);
      await farmSelect.selectOption({ label: targetFarm.farm_name }).catch(() =>
        farmSelect.selectOption(String(targetFarm.id)),
      );
      await humanPause(page, 700);

      const cropsForFarm = targetFarm.crops || [];
      if (cropsForFarm.length > 0 && (await cropSelect.isVisible().catch(() => false))) {
        const crop = cropsForFarm[0];
        chosenCropId = crop.id;
        chosenCropName = crop.crop_name;
        await humanClick(page, cropSelect);
        await cropSelect
          .selectOption(String(crop.id))
          .catch(() => cropSelect.selectOption({ index: 1 }));
        await humanPause(page, 700);
      }
    }
  } catch (err) {
    console.warn("Non-fatal: could not select farm/crop context —", err.message);
    state.metadata.warnings.push(
      "Could not select farm/crop context before screening; continuing without it.",
    );
  }

  await humanPause(page, 900);

  const screenButton = page.getByRole("button", { name: /screen this photo/i });
  let predictJson = null;

  try {
    const { json } = await withResponse(
      page,
      (res) => res.url().includes("/predict") && res.request().method() === "POST",
      async () => {
        await humanClick(page, screenButton);
      },
      45000,
    );
    predictJson = json;
  } catch (err) {
    fail(act, "POST /predict did not complete", screeningUrl, err);
  }

  if (!predictJson || predictJson.success === false) {
    fail(
      act,
      "POST /predict returned a failure result",
      screeningUrl,
      new Error(
        predictJson?.message || "The /predict endpoint reported success:false.",
      ),
    );
  }

  await page
    .waitForFunction(() => document.body.innerText.includes("Screening complete"), {
      timeout: 20000,
    })
    .catch((err) => fail(act, "Result screen did not render", screeningUrl, err));

  // Hold on the result long enough to read it, per the recording-quality spec.
  await humanPause(page, 2200);

  await fs.promises.mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "act1-screening.png"),
    fullPage: false,
  });
  state.metadata.screenshots.push("screenshots/act1-screening.png");

  await humanPause(page, 1000);

  const hasTopPredictions =
    Array.isArray(predictJson.top_predictions) && predictJson.top_predictions.length > 0;

  state.metadata.acts.act1 = {
    route: "/farmer/screening",
    accountRole: "farmer",
    farmId: targetFarm.id,
    farmName: targetFarm.farm_name,
    cropId: chosenCropId,
    cropName: chosenCropName,
    demoImage: {
      path: path.relative(REPO_ROOT, imageInfo.path),
      overridden: imageInfo.overridden,
    },
    prediction: {
      disease: predictJson.disease,
      confidence: predictJson.confidence,
      confidence_warning: predictJson.confidence_warning,
      crop_mismatch_warning: predictJson.crop_mismatch_warning,
      predicted_crop: predictJson.predicted_crop,
      submitted_crop: predictJson.submitted_crop,
      top_predictions: predictJson.top_predictions || null,
    },
  };

  if (hasTopPredictions) {
    state.metadata.limitations.push(
      "POST /predict returns a real top_predictions array (captured above), " +
        "but the deployed DiseaseResultPanel/DiseaseScreening UI only " +
        "visually renders the top-1 disease and confidence — no top-3 list " +
        "is shown on screen. The capture intentionally does not overlay a " +
        "fabricated top-3 UI element; the richer data is preserved here " +
        "instead, truthfully, as backing metadata only.",
    );
  }

  await hideChapter(page);
  return { targetFarm, predictJson, chosenCropName };
}

// ============================================================
// ACT 2 — FARMER ACTION / ADVISORY
// ============================================================

async function actTwo(page, state, ctx) {
  const act = "ACT 2 — FARMER ACTION / ADVISORY";
  await showChapter(page, CHAPTERS.ACT2);

  // Advisory panel is already rendered below the result on the same page.
  await humanScroll(page, 380);
  await humanPause(page, 1800);
  await humanScroll(page, 300);
  await humanPause(page, 1800);

  await fs.promises.mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "act2-advisory.png"),
    fullPage: false,
  });
  state.metadata.screenshots.push("screenshots/act2-advisory.png");

  const bodyText = await page.innerText("body").catch(() => "");
  const advisoryShown =
    bodyText.includes("Recommended action") || bodyText.includes("No signs of disease");

  await humanPause(page, 800);

  // Monitoring is a real, best-effort follow-on — an empty state there is a
  // legitimate real outcome, not a capture failure, per the task's own
  // verification checklist (monitoring is not one of the hard preconditions).
  const monitoringUrl = `${FRONTEND_BASE}/farmer/monitoring`;
  let monitoringOutcome = "not_attempted";
  try {
    await gotoViaNav(page, "Field Monitoring", "/farmer/monitoring", act);
    await humanPause(page, 1400);
    const monitoringText = await page.innerText("body").catch(() => "");
    monitoringOutcome = monitoringText.trim().length > 0 ? "rendered" : "empty";
    await humanScroll(page, 200);
    await humanPause(page, 1200);
  } catch (err) {
    monitoringOutcome = "error";
    state.metadata.warnings.push(
      `/farmer/monitoring did not load cleanly: ${err.message}. This step is ` +
        "best-effort per spec and does not fail the capture.",
    );
  }

  state.metadata.acts.act2 = {
    route: "/farmer/monitoring",
    accountRole: "farmer",
    advisoryShown,
    monitoringOutcome,
    notes:
      "Screening photos are not persisted on this deployment (no Supabase " +
        "storage credentials configured in backend/.env) — the capture does " +
        "not claim otherwise.",
  };
  state.metadata.limitations.push(
    "This deployment does not persist screening photographs (image_store.py " +
      "is inert without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).",
  );

  await hideChapter(page);
}

// ============================================================
// ACT 3 — EXTENSION RESPONSE
// ============================================================

async function actThree(page, state) {
  const act = "ACT 3 — EXTENSION RESPONSE";
  await logout(page, "ACT 2 — FARMER ACTION / ADVISORY");
  await login(page, "extension", act);
  await showChapter(page, CHAPTERS.ACT3);

  const dashboardUrl = `${FRONTEND_BASE}/extension/dashboard`;
  let farmersJson = null;
  try {
    const { json } = await withResponse(
      page,
      (res) => res.url().includes("/extension/farmers") && res.request().method() === "GET",
      () => page.goto(dashboardUrl, { waitUntil: "networkidle" }),
      25000,
    );
    farmersJson = json;
  } catch (err) {
    fail(act, "Load /extension/dashboard (GET /extension/farmers)", dashboardUrl, err);
  }

  const items = farmersJson?.items || [];
  const summary = farmersJson?.summary || {};
  const mappedFarms = items.filter(
    (f) =>
      f.location &&
      Number.isFinite(Number(f.location.latitude)) &&
      Number.isFinite(Number(f.location.longitude)),
  );

  if (!(items.length > 0)) {
    fail(act, "Verify farmers.length > 0", dashboardUrl, new Error("No farmers returned."));
  }
  if (!(mappedFarms.length > 0)) {
    fail(
      act,
      "Verify at least one valid mapped farm coordinate",
      dashboardUrl,
      new Error("No farm in /extension/farmers has a valid latitude/longitude."),
    );
  }

  await humanPause(page, 1600);
  await humanScroll(page, 260);
  await humanPause(page, 1600);
  await humanScroll(page, 300);
  await humanPause(page, 1800);

  // Real farm marker + popup demonstration (best-effort visual flourish —
  // the hard verification above already confirmed real coordinates exist).
  const marker = page.locator("path.leaflet-interactive").first();
  if (await marker.isVisible({ timeout: 4000 }).catch(() => false)) {
    await humanClick(page, marker);
    await page.locator(".leaflet-popup").waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
    await humanPause(page, 1600);
  }

  // ---- /extension/map ----
  const mapUrl = `${FRONTEND_BASE}/extension/map`;
  let observationsJson = null;
  try {
    const { json } = await withResponse(
      page,
      (res) => res.url().includes("/geo/observations") && res.request().method() === "GET",
      () => gotoViaNav(page, "Disease Map", "/extension/map", act),
      20000,
    );
    observationsJson = json;
  } catch (err) {
    fail(act, "Load /extension/map (GET /geo/observations)", mapUrl, err);
  }

  await humanPause(page, 1800);
  await fs.promises.mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "act3-extension-map.png"),
    fullPage: false,
  });
  state.metadata.screenshots.push("screenshots/act3-extension-map.png");

  // ---- select an actual high-risk farm ----
  const riskRank = { CRITICAL: 3, HIGH: 2, MODERATE: 1, LOW: 0 };
  const ranked = [...mappedFarms].sort(
    (a, b) =>
      (riskRank[b.health?.risk_level] ?? -1) - (riskRank[a.health?.risk_level] ?? -1),
  );
  const highRiskFarm = ranked[0];

  await gotoViaNav(page, "Farmers & Farms", "/extension/dashboard", act).catch(() => {});
  try {
    await page.goto(dashboardUrl, { waitUntil: "networkidle" });
  } catch (err) {
    fail(act, "Return to /extension/dashboard to select a farm", dashboardUrl, err);
  }
  await humanPause(page, 1200);

  const farmRow = page
    .locator("tr, [role='row']", { hasText: highRiskFarm.farmer_name })
    .first();

  try {
    if (await farmRow.isVisible({ timeout: 4000 }).catch(() => false)) {
      await humanClick(page, farmRow);
      await page.waitForLoadState("networkidle");
    } else {
      await page.goto(`${FRONTEND_BASE}/extension/farmers/${highRiskFarm.farm_id}`, {
        waitUntil: "networkidle",
      });
    }
  } catch (err) {
    fail(
      act,
      "Navigate to /extension/farmers/:farmId",
      `${FRONTEND_BASE}/extension/farmers/${highRiskFarm.farm_id}`,
      err,
    );
  }

  await humanPause(page, 1800);
  await page.screenshot({
    path: path.join(SHOTS_DIR, "act3-farm-detail.png"),
    fullPage: false,
  });
  state.metadata.screenshots.push("screenshots/act3-farm-detail.png");

  state.metadata.acts.act3 = {
    routes: ["/extension/dashboard", "/extension/map", `/extension/farmers/${highRiskFarm.farm_id}`],
    accountRole: "extension_officer",
    farmerCount: summary.farmers ?? items.length,
    farmCount: summary.farms ?? items.length,
    mappedFarmCount: summary.mapped_farms ?? mappedFarms.length,
    selectedHighRiskFarm: {
      farmId: highRiskFarm.farm_id,
      farmerName: highRiskFarm.farmer_name,
      riskLevel: highRiskFarm.health?.risk_level || null,
    },
    heatmapHasRealCoordinates: mappedFarms.length > 0,
    geoObservationsFeatureCount: observationsJson?.features?.length ?? null,
  };

  await hideChapter(page);
  return { highRiskFarm };
}

// ============================================================
// ACT 4 — EXTENSION OFFICER VALIDATION
// ============================================================

async function actFour(page, state) {
  const act = "ACT 4 — EXTENSION OFFICER VALIDATION";
  await showChapter(page, CHAPTERS.ACT4);

  const dialogsSeen = [];
  page.on("dialog", async (dialog) => {
    dialogsSeen.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept().catch(() => {});
  });

  const validationUrl = `${FRONTEND_BASE}/extension/validation`;
  let queueJson = null;
  try {
    const { json } = await withResponse(
      page,
      (res) =>
        res.url().includes("/validation/observations") &&
        res.request().method() === "GET",
      () => gotoViaNav(page, "Expert Validation", "/extension/validation", act),
      20000,
    );
    queueJson = json;
  } catch (err) {
    fail(act, "Load /extension/validation queue", validationUrl, err);
  }

  const pendingItems = queueJson?.items || [];
  if (!(pendingItems.length > 0)) {
    fail(
      act,
      "Verify a pending validation observation exists",
      validationUrl,
      new Error("GET /validation/observations?status=PENDING returned no items."),
    );
  }

  await humanPause(page, 1400);

  // Scope to the queue list itself (`section button.group`) so a missing
  // crop_name never falls back to matching an unrelated button elsewhere on
  // the page (e.g. the PENDING/CONFIRMED/REJECTED/UNCERTAIN filter tabs,
  // which render above the queue and would otherwise be the first button
  // matched by an empty hasText filter).
  const queueCards = page.locator("section button.group");
  const namedQueueCard = pendingItems[0].crop_name
    ? queueCards.filter({ hasText: pendingItems[0].crop_name }).first()
    : null;
  const anyQueueCard = queueCards.first();

  let detailJson = null;
  try {
    const clickTarget =
      namedQueueCard && (await namedQueueCard.count()) > 0 ? namedQueueCard : anyQueueCard;
    const { json } = await withResponse(
      page,
      (res) =>
        /\/validation\/observations\/\d+/.test(res.url()) &&
        res.request().method() === "GET",
      () => humanClick(page, clickTarget),
      15000,
    );
    detailJson = json;
  } catch (err) {
    fail(act, "Open a pending validation observation", validationUrl, err);
  }

  await humanPause(page, 1800);
  await fs.promises.mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "act4-validation.png"),
    fullPage: false,
  });
  state.metadata.screenshots.push("screenshots/act4-validation.png");

  let submitted = false;
  const submitButton = page.getByRole("button", { name: /submit validation/i });
  if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    const notesField = page.locator("#review-notes");
    if (await notesField.isVisible().catch(() => false)) {
      await humanClick(page, notesField);
      await humanType(
        page,
        notesField,
        "Reviewed against the submitted photo; symptoms consistent with the AI reading.",
      );
      await humanPause(page, 700);
    }
    try {
      await humanClick(page, submitButton);
      await page.waitForTimeout(1200); // allow the native alert() to surface
      if (dialogsSeen.length === 0) {
        // Some environments deliver the dialog slightly later; give it one
        // more short window before concluding no dialog appeared.
        await page.waitForTimeout(1200);
      }
      submitted = true;
    } catch (err) {
      state.metadata.warnings.push(
        `Validation submission was attempted but did not complete cleanly: ${err.message}`,
      );
    }
    await humanPause(page, 900);
  } else {
    state.metadata.warnings.push(
      "Submit Validation control was not available; captured the review " +
        "screen without submitting.",
    );
  }

  state.metadata.acts.act4 = {
    route: "/extension/validation",
    accountRole: "extension_officer",
    observationId: detailJson?.observation_id || pendingItems[0]?.observation_id || null,
    predictedClass: detailJson?.predicted_class || pendingItems[0]?.predicted_class || null,
    confidence: detailJson?.confidence ?? pendingItems[0]?.confidence ?? null,
    submitted,
    nativeDialogsHandled: dialogsSeen,
  };
  state.metadata.limitations.push(
    "The Extension Officer role is correctly named as such throughout this " +
      "capture and its metadata. The application's own UI copy still labels " +
      'this screen "Expert Validation" (en.json validation.title) — that ' +
      "existing UI text was not modified, per the no-app-changes constraint.",
  );
  if (dialogsSeen.length > 0) {
    state.metadata.limitations.push(
      "ExpertValidation.jsx confirms submission via a native window.alert(); " +
        "the capture detected and dismissed it programmatically via " +
        "page.on('dialog') rather than modifying the application.",
    );
  }

  await hideChapter(page);
}

// ============================================================
// ACT 5 — OFFICIAL INTELLIGENCE
// ============================================================

async function actFive(page, state) {
  const act = "ACT 5 — OFFICIAL INTELLIGENCE";
  await logout(page, "ACT 4 — EXTENSION OFFICER VALIDATION");
  await login(page, "official", act);
  await showChapter(page, CHAPTERS.ACT5);

  const analyticsUrl = `${FRONTEND_BASE}/official/analytics`;
  let summaryJson = null;
  try {
    const { json } = await withResponse(
      page,
      (res) => res.url().includes("/official/summary") && res.request().method() === "GET",
      () => page.goto(analyticsUrl, { waitUntil: "networkidle" }),
      20000,
    );
    summaryJson = json;
  } catch (err) {
    fail(act, "Load /official/analytics (GET /official/summary)", analyticsUrl, err);
  }

  if (!summaryJson || !summaryJson.counts) {
    fail(
      act,
      "Verify /official/summary contains real counts",
      analyticsUrl,
      new Error("GET /official/summary response had no counts payload."),
    );
  }

  await humanPause(page, 1800);
  await humanScroll(page, 260);
  await humanPause(page, 1600);
  await humanScroll(page, 280);
  await humanPause(page, 1600);

  await fs.promises.mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "act5-analytics.png"),
    fullPage: false,
  });
  state.metadata.screenshots.push("screenshots/act5-analytics.png");

  // ---- /official/map ----
  const mapUrl = `${FRONTEND_BASE}/official/map`;
  try {
    await gotoViaNav(page, "Disease Map", "/official/map", act);
    await humanPause(page, 1800);
    await humanScroll(page, 200);
    await humanPause(page, 1400);
  } catch (err) {
    state.metadata.warnings.push(`/official/map did not fully load: ${err.message}`);
  }

  // ---- optional KPI-only return to /official/dashboard ----
  let dashboardVisited = false;
  try {
    await gotoViaNav(page, "Dashboard", "/official/dashboard", act);
    await humanPause(page, 1400);
    dashboardVisited = true;
  } catch (err) {
    state.metadata.warnings.push(
      `Optional /official/dashboard KPI return skipped: ${err.message}`,
    );
  }

  state.metadata.acts.act5 = {
    routes: ["/official/analytics", "/official/map", dashboardVisited ? "/official/dashboard" : null].filter(Boolean),
    accountRole: "official",
    counts: summaryJson.counts,
    riskLevels: summaryJson.risk_levels || null,
    diseaseTrendCount: summaryJson.disease_trends?.length ?? null,
    pestTrendCount: summaryJson.pest_trends?.length ?? null,
    cropStatisticsCount: summaryJson.crop_statistics?.length ?? null,
  };
  state.metadata.limitations.push(
    "/official/dashboard's risk-level bars render as binary 0%/100% and do " +
      "not proportionally represent magnitude, so /official/analytics was " +
      "used for the primary risk-distribution shot instead, per spec.",
  );

  await hideChapter(page);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const startedAt = new Date();
  const args = parseArgs();
  const imageOverride = args.image || process.env.DEMO_IMAGE || null;

  await fs.promises.mkdir(RAW_DIR, { recursive: true });
  await fs.promises.mkdir(SHOTS_DIR, { recursive: true });
  await fs.promises.mkdir(RECORD_TMP_DIR, { recursive: true });

  const state = {
    metadata: {
      recordingTimestamp: startedAt.toISOString(),
      viewport: VIEWPORT,
      acts: {},
      screenshots: [],
      warnings: [],
      limitations: [],
      skipped: [],
    },
  };

  console.log("Checking that both dev servers are reachable...");
  const [frontendUp, backendUp] = await Promise.all([
    fetchReachable(FRONTEND_BASE + "/login"),
    fetchReachable(BACKEND_BASE + "/docs"),
  ]);

  if (!frontendUp) {
    fail(
      "ACT 0 — OPENING",
      "Verify frontend dev server is reachable",
      FRONTEND_BASE,
      new Error(
        "No response from the frontend dev server. Start it (e.g. `npm run dev` " +
          "in frontend/) before running this capture.",
      ),
    );
  }
  if (!backendUp) {
    fail(
      "ACT 0 — OPENING",
      "Verify backend API server is reachable",
      BACKEND_BASE,
      new Error(
        "No response from the backend API server. Start it before running this capture.",
      ),
    );
  }

  const imageInfo = resolveDemoImage(imageOverride);

  const browser = await chromium.launch({
    headless: process.env.DEMO_HEADFUL === "1" ? false : true,
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RECORD_TMP_DIR, size: VIEWPORT },
  });

  const page = await context.newPage();
  const video = page.video();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.warn(`[browser console error] ${msg.text()}`);
    }
  });

  let captureFailed = false;

  try {
    await actZero(page, state);
    const act1Result = await actOne(page, state, imageInfo);
    await actTwo(page, state, act1Result);
    await actThree(page, state);
    await actFour(page, state);
    await actFive(page, state);
  } catch (err) {
    captureFailed = true;
    if (!(err instanceof DemoCaptureError)) {
      console.error("\nDEMO CAPTURE FAILED");
      console.error("Act: UNEXPECTED");
      console.error("Step: (unhandled exception)");
      console.error(`URL: ${page.url()}`);
      console.error(`Error: ${err.message}\n`);
    }
  }

  await context.close();

  if (captureFailed) {
    const failedVideoPath = path.join(
      RAW_DIR,
      `FAILED-${startedAt.toISOString().replace(/[:.]/g, "-")}.webm`,
    );
    try {
      const tmpPath = await video.path();
      await fs.promises.rename(tmpPath, failedVideoPath);
      console.error(`Partial (non-final) footage preserved at: ${failedVideoPath}`);
    } catch {
      // no video to salvage — nothing further to do
    }
    state.metadata.status = "FAILED";
    await fs.promises.writeFile(
      METADATA_PATH,
      JSON.stringify(state.metadata, null, 2),
    );
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const tmpVideoPath = await video.path();
  await fs.promises.rename(tmpVideoPath, FINAL_VIDEO_PATH);
  await fs.promises.rmdir(RECORD_TMP_DIR, { recursive: true }).catch(() => {});

  await browser.close();

  const finishedAt = new Date();
  const durationSec = Math.round((finishedAt - startedAt) / 1000);

  state.metadata.status = "COMPLETE";
  state.metadata.durationSeconds = durationSec;
  state.metadata.chapterMarkerImplementation =
    "The installed Playwright version (1.63.0) exposes no public API for " +
    "embedding real video-chapter/container metadata. Chapter markers were " +
    "implemented as a subtle in-page DOM overlay shown/hidden via " +
    "page.evaluate() during capture, not as real container-level chapters.";
  state.metadata.videoPath = path.relative(OUTPUT_DIR, FINAL_VIDEO_PATH);
  state.metadata.disclaimer =
    "This is the clean master screen recording only — not final cinematic " +
    "footage. It is intended to be edited further with voiceover, music, " +
    "title cards, and external agricultural B-roll.";

  await fs.promises.writeFile(METADATA_PATH, JSON.stringify(state.metadata, null, 2));

  console.log("\n========================================");
  console.log("AGRECROP DEMO CAPTURE COMPLETE");
  console.log("========================================");
  console.log(`Video: ${FINAL_VIDEO_PATH}`);
  console.log(`Duration: ${durationSec}s`);
  console.log(`Acts captured: ${Object.keys(state.metadata.acts).join(", ")}`);
  console.log(`Screenshots: ${state.metadata.screenshots.join(", ")}`);
  console.log(
    `Warnings: ${state.metadata.warnings.length ? state.metadata.warnings.join(" | ") : "none"}`,
  );
}

main().catch((err) => {
  console.error("Unhandled error in demo_capture.cjs:", err);
  process.exitCode = 1;
});
