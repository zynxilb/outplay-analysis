// scripts/check-deployed.mjs
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.goto("https://outplay-analysis.vercel.app/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  const t0 = Date.now();
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (body.includes("مراجعة المباراة")) break;
    if (body.includes("حدث خطأ")) { console.log("ERROR state"); break; }
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`Reached review in ${elapsed}s`);

  // Get key plies
  const moves = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-ply]")).map(el => ({
      ply: parseInt(el.getAttribute("data-ply")),
      san: el.getAttribute("data-san"),
      quality: el.getAttribute("data-quality"),
    }));
  });
  const byPly = new Map();
  for (const m of moves) byPly.set(m.ply, m);
  const uniq = Array.from(byPly.values()).sort((a, b) => a.ply - b.ply);

  const counts = {};
  for (const m of uniq) counts[m.quality] = (counts[m.quality] ?? 0) + 1;
  console.log(`Counts: ${JSON.stringify(counts)}`);
  console.log(`\nKey plies:`);
  for (const p of [9, 10, 11, 15, 29, 32, 33]) {
    const m = uniq.find(x => x.ply === p);
    console.log(`  ${p}. ${m?.san} → ${m?.quality}`);
  }
  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
