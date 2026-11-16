// scripts/warm-only.mjs
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  // === PHASE 1: warm the cache (silent, no timing) ===
  console.log("Phase 1: populating cache (no timing)...");
  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 100));
    if (body.includes("مراجعة المباراة")) break;
  }
  const cache1 = await page.evaluate(async () => {
    return new Promise((r) => {
      const req = indexedDB.open("outplay-lichess-cache");
      req.onsuccess = () => {
        const tx = req.result.transaction("evals", "readonly");
        const g = tx.objectStore("evals").getAll();
        g.onsuccess = () => r(g.result.length);
      };
    });
  });
  console.log(`  Cache after phase 1: ${cache1} entries`);

  // === PHASE 2: warm run (timing) ===
  console.log("\nPhase 2: WARM run (timing)...");
  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(1500);

  let lichessReqs = 0;
  let wasmReqs = 0;
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("lichess.org/api/cloud-eval")) lichessReqs++;
    else if (u.includes("stockfish-19")) wasmReqs++;
  });

  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(300);

  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 100));
    if (body.includes("مراجعة المباراة")) break;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  WARM elapsed: ${elapsed}s`);
  console.log(`  Lichess requests: ${lichessReqs}`);
  console.log(`  WASM requests: ${wasmReqs}`);
  console.log(`\n  >>> WARM = ${elapsed}s (lichess=${lichessReqs}, wasm=${wasmReqs}) <<<`);

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
