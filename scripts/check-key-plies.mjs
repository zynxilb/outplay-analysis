// scripts/check-key-plies.mjs
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

  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (body.includes("مراجعة المباراة")) break;
  }

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

  // Correct Opera Game plies of interest:
  //  17 = 9.Bg5  (Morphy's pin)
  //  18 = 9...b5 (black's tactical mistake)
  //  19 = 10.Nxb5!! (famous sacrifice)
  //  20 = 10...cxb5 (forced)
  //  21 = 11.Bxb5+ (check)
  //  27 = 14.Rd1 (Morphy's calm buildup)
  //  28 = 14...Qe6 (black's fatal)
  //  29 = 15.Bxd7+
  //  31 = 16.Qb8+ (queen sac)
  //  33 = 17.Rd8# (mate)
  const key = [17, 18, 19, 20, 21, 27, 28, 29, 31, 33];
  console.log("Key plies (correct Opera Game mapping):");
  for (const p of key) {
    const m = uniq.find(x => x.ply === p);
    console.log(`  ply ${String(p).padStart(2)}. ${String(m?.san ?? "?").padEnd(6)} → ${m?.quality ?? "MISSING"}`);
  }

  console.log("\nALL plies:");
  for (const m of uniq) {
    console.log(`  ${String(m.ply).padStart(2)}. ${String(m.san).padEnd(6)} → ${m.quality}`);
  }

  const unanalyzed = uniq.filter(m => m.quality === "unanalyzed");
  if (unanalyzed.length > 0) {
    console.log("\n⚠️ Unanalyzed plies:");
    for (const u of unanalyzed) console.log(`  ply ${u.ply}. ${u.san}`);
  }

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
