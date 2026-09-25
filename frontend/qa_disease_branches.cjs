const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const SHOT_DIR = path.join(__dirname, "..", "qa-shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:8000";

function findImage(dir, depth) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && /\.(jpe?g|png)$/i.test(e.name)) {
      return path.join(dir, e.name);
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      const found = findImage(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function run() {
  const browser = await chromium.launch();
  const consoleErrors = [];
  const failedRequests = [];
  const backendDir = path.join(__dirname, "..", "backend");
  const imagePath = findImage(backendDir, 0);
  console.log("Test image:", imagePath || "NONE FOUND");

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().includes("127.0.0.1:8000")) {
      failedRequests.push(`${res.status()} ${res.url()}`);
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "farmer@email.com");
  await page.fill('input[type="password"]', "Pass@123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/farmer/, { timeout: 15000 });
  console.log("Logged in, landed on:", page.url());

  const token = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes("auth-token")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key));
          if (parsed?.access_token) return parsed.access_token;
        } catch {}
      }
    }
    return null;
  });
  console.log("Extracted auth token:", token ? "yes" : "NO");

  const authedRequest = await require("playwright").request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });

  // Clean up any stray farm left over from a previous interrupted run
  const existingFarms = await (await authedRequest.get("/profile/farms")).json();
  for (const f of existingFarms || []) {
    if (f.farm_name === "QA Test Farm") {
      await authedRequest.delete(`/profile/farms/${f.id}`);
      console.log("Removed stray leftover farm:", f.id);
    }
  }

  const farmRes = await authedRequest.post("/profile/farms", {
    data: { farm_name: "QA Test Farm", area: 3.5, area_unit: "acres" },
  });
  const farm = await farmRes.json();
  console.log("Seeded farm:", farmRes.status(), farm);

  const cropTomato = await (
    await authedRequest.post(`/profile/farms/${farm.id}/crops`, {
      data: { crop_name: "Tomato", variety: "Roma" },
    })
  ).json();
  console.log("Seeded crop Tomato:", cropTomato);

  const cropRice = await (
    await authedRequest.post(`/profile/farms/${farm.id}/crops`, {
      data: { crop_name: "Rice" },
    })
  ).json();
  console.log("Seeded crop Rice (unsupported by model):", cropRice);

  // ---------------------------------------------------------------
  // Reload screening page — farm/crop dropdowns should now be populated
  // ---------------------------------------------------------------
  await page.goto(`${BASE}/farmer/screening`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  if (!imagePath) {
    console.log("No local image available — skipping submit-flow branch tests.");
  } else {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(imagePath);
    await page.waitForTimeout(300);

    // Select farm
    const farmSelect = page.locator("select").first();
    await farmSelect.selectOption({ value: String(farm.id) });
    await page.waitForTimeout(200);

    // Select unsupported crop (Rice)
    const cropSelect = page.locator("select").nth(1);
    await cropSelect.selectOption({ value: String(cropRice.id) });
    await page.waitForTimeout(200);

    await page.screenshot({
      path: path.join(SHOT_DIR, "branch-01-ready-populated.png"),
      fullPage: true,
    });
    console.log("Captured ready step with populated farm/crop dropdowns");

    const screenBtn = page.getByRole("button", { name: /screen this photo/i });
    await screenBtn.click();

    await page
      .waitForFunction(
        () =>
          document.body.innerText.includes("Screening complete") ||
          document.body.innerText.includes("Couldn't complete that screening") ||
          document.body.innerText.includes("Couldn’t complete that screening"),
        { timeout: 30000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(SHOT_DIR, "branch-02-unsupported-crop.png"),
      fullPage: true,
    });
    const bodyAfterRice = await page.textContent("body");
    console.log(
      "Unsupported-crop branch reached:",
      bodyAfterRice?.includes("not currently available") ||
        bodyAfterRice?.includes("not available for this crop"),
    );
    console.log("Body snippet (Rice submit):", bodyAfterRice?.slice(0, 500));

    // Now switch to the supported crop (Tomato) and submit again
    await cropSelect.selectOption({ value: String(cropTomato.id) });
    await page.waitForTimeout(200);
    await screenBtn.click();

    await page
      .waitForFunction(
        () => document.body.innerText.includes("Screening complete"),
        { timeout: 30000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(SHOT_DIR, "branch-03-tomato-result.png"),
      fullPage: true,
    });
    const bodyAfterTomato = await page.textContent("body");
    console.log("Reached result after Tomato submit:", bodyAfterTomato?.includes("Screening complete"));
    console.log(
      "Crop mismatch warning shown:",
      bodyAfterTomato?.includes("may not match the crop you selected"),
    );
    console.log("Body snippet (Tomato submit):", bodyAfterTomato?.slice(0, 600));
  }

  // ---------------------------------------------------------------
  // Cleanup: remove seeded farm (cascades to crops) so test account
  // returns to its original empty state.
  // ---------------------------------------------------------------
  const delRes = await authedRequest.delete(`/profile/farms/${farm.id}`);
  console.log("Cleanup — deleted seeded farm, status:", delRes.status());

  console.log("\n=== Console errors ===");
  consoleErrors.forEach((e) => console.log(e));
  console.log("\n=== Failed/error requests ===");
  failedRequests.forEach((e) => console.log(e));

  await authedRequest.dispose();
  await context.close();
  await browser.close();
}

run().catch((err) => {
  console.error("QA script crashed:", err);
  process.exit(1);
});
