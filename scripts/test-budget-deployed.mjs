// scripts/test-budget.mjs
import { chromium } from "playwright";
const BASE = "https://outplay-analysis.pxxlspace.cv";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);

  const t0 = Date.now();
  await page.goto(`${BASE}/import`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2500);

  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  console.log("Analysis started. Waiting (up to 5 min for 1500ms)...");
  const start = Date.now();
  let state = "timeout";
  while (Date.now() - start < 300000) {
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes("مراجعة المباراة")) { state = "review"; break; }
    if (body.includes("حدث خطأ") || body.includes("تعذّر") || body.includes("لم نتمكن")) { state = "error"; break; }
    await page.waitForTimeout(1000);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`state: ${state}, elapsed: ${elapsed}s\n`);

  const moves = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-ply]")).map(el => ({
      ply: parseInt(el.getAttribute("data-ply")),
      san: el.getAttribute("data-san"),
      quality: el.getAttribute("data-quality"),
    }));
  });
  const byPly = new Map();
  for (const m of moves) byPly.set(m.ply, m);
  const unique = Array.from(byPly.values()).sort((a, b) => a.ply - b.ply);

  console.log(`Total moves: ${unique.length}/33`);
  const counts = {};
  for (const m of unique) counts[m.quality] = (counts[m.quality] ?? 0) + 1;
  console.log(`Counts: ${JSON.stringify(counts)}\n`);

  console.log("Key plies (compare to 300ms baseline):");
  const key = [3, 5, 8, 9, 10, 11, 12, 14, 15, 22, 28, 29, 31, 32, 33];
  for (const p of key) {
    const m = unique.find(x => x.ply === p);
    console.log(`  ${String(p).padStart(2)}. ${String(m?.san ?? "?").padEnd(6)} → ${m?.quality ?? "MISSING"}`);
  }

  console.log("\nAll plies:");
  for (const m of unique) {
    console.log(`  ${String(m.ply).padStart(2)}. ${String(m.san).padEnd(6)} → ${m.quality}`);
  }

  await page.screenshot({ path: "/tmp/deployed-review.png" });
  console.log("\nScreenshot: /tmp/deployed-review.png");
  await browser.close();
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
