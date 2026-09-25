const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const SHOT_DIR = path.join(__dirname, "..", "qa-shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const BASE = "http://localhost:3000";

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

  for (const viewport of [
    { name: "tablet-landscape", width: 1280, height: 800 },
    { name: "tablet-portrait", width: 768, height: 1024 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[${viewport.name}] ${msg.text()}`);
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(`[${viewport.name}] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && res.url().includes("127.0.0.1:8000")) {
        failedRequests.push(`[${viewport.name}] ${res.status()} ${res.url()}`);
      }
    });

    console.log(`\n=== ${viewport.name} (${viewport.width}x${viewport.height}) ===`);

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', "farmer@email.com");
    await page.fill('input[type="password"]', "Pass@123");
    await page.click('button[type="submit"]');
    await page.waitForURL(/farmer/, { timeout: 15000 });
    console.log("Logged in, landed on:", page.url());

    await page.goto(`${BASE}/farmer/screening`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SHOT_DIR, `${viewport.name}-01-upload.png`),
      fullPage: true,
    });
    console.log("Captured upload step");

    if (imagePath) {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(imagePath);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${viewport.name}-02-ready.png`),
        fullPage: true,
      });
      console.log("Captured ready step");

      const screenBtn = page.getByRole("button", { name: /screen this photo/i });
      await screenBtn.click();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${viewport.name}-03-analyzing.png`),
        fullPage: true,
      });
      console.log("Captured analyzing step");

      await page
        .waitForFunction(
          () =>
            document.body.innerText.includes("Screening complete") ||
            document.body.innerText.includes("Couldn't complete that screening") ||
            document.body.innerText.includes("Couldn’t complete that screening"),
          { timeout: 30000 },
        )
        .catch(() => {});

      await page.waitForTimeout(1500);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${viewport.name}-04-result.png`),
        fullPage: true,
      });
      const bodyText = await page.textContent("body");
      console.log("Reached result view:", bodyText?.includes("Screening complete"));
    }

    await context.close();
  }

  console.log("\n=== Console errors ===");
  consoleErrors.forEach((e) => console.log(e));
  console.log("\n=== Failed/error requests ===");
  failedRequests.forEach((e) => console.log(e));

  await browser.close();
}

run().catch((err) => {
  console.error("QA script crashed:", err);
  process.exit(1);
});
