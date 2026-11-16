// scripts/diag-vercel.mjs
import { chromium } from "playwright";

const URL = process.argv[2] || "https://outplay-analysis.vercel.app";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);

  const failed = [];
  const errored = [];
  const consoleErr = [];
  const consoleAll = [];

  page.on("requestfailed", (req) => {
    failed.push({
      url: req.url(),
      method: req.method(),
      err: req.failure()?.errorText,
      resType: req.resourceType(),
    });
  });

  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400) {
      errored.push({
        url: res.url(),
        status,
        type: res.request().resourceType(),
      });
    }
  });

  page.on("console", (msg) => {
    const t = msg.type();
    const text = msg.text();
    if (t === "error") consoleErr.push(text);
    consoleAll.push(`[${t}] ${text.slice(0, 200)}`);
  });

  page.on("pageerror", (e) => {
    consoleErr.push(`[pageerror] ${e.message}`);
  });

  console.log(`Loading ${URL}/import...`);
  await page.goto(`${URL}/import`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea", { timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log("Page loaded. Clicking sample...");
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(500);

  console.log("Clicking analyze...");
  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  // Watch for 20s
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes("حدث خطأ") || body.includes("تعذّر") || body.includes("لا توجد نقلات")) {
      console.log(`\n>>> ERROR shown after ${Date.now() - t0}ms <<<\n`);
      break;
    }
    if (body.includes("مراجعة المباراة")) {
      console.log(`\n>>> REVIEW reached after ${Date.now() - t0}ms <<<\n`);
      break;
    }
  }

  const finalBody = await page.evaluate(() => document.body.innerText.slice(0, 800));
  console.log("Final body text:");
  console.log(finalBody);

  console.log("\n═══ FAILED REQUESTS ═══");
  if (failed.length === 0) console.log("(none)");
  else for (const f of failed) console.log(`  ${f.method} ${f.url}\n    → ${f.err} [${f.resType}]`);

  console.log("\n═══ HTTP ERRORS (>=400) ═══");
  if (errored.length === 0) console.log("(none)");
  else for (const e of errored) console.log(`  ${e.status} ${e.url} [${e.type}]`);

  console.log("\n═══ CONSOLE ERRORS ═══");
  if (consoleErr.length === 0) console.log("(none)");
  else for (const c of consoleErr.slice(0, 20)) console.log(`  ${c}`);

  console.log("\n═══ ALL CONSOLE (first 25) ═══");
  for (const c of consoleAll.slice(0, 25)) console.log(`  ${c}`);

  await page.screenshot({ path: "/tmp/vercel-diag.png" });
  console.log("\nScreenshot: /tmp/vercel-diag.png");

  await browser.close();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
