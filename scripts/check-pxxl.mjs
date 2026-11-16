// scripts/check-pxxl.mjs
import { chromium } from "playwright";
const URL = "https://outplay-analysis.pxxlspace.cv";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  const netLog = [];
  const consoleLog = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("stockfish") || u.includes(".wasm")) netLog.push(`REQ ${u}`);
  });
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("stockfish") || u.includes(".wasm")) {
      const h = res.headers();
      netLog.push(`RES ${res.status()} ${u.split("/").pop()} ct=${h["content-type"] || "?"} cache=${h["cache-control"] || "?"}`);
    }
  });
  page.on("console", (m) => consoleLog.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${e.message}`));

  console.log(`Loading ${URL}/import...`);
  await page.goto(`${URL}/import`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea", { timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log("Clicking sample...");
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  const t0 = Date.now();
  let reached = "timeout";
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (body.includes("مراجعة المباراة")) { reached = "review"; break; }
    if (body.includes("حدث خطأ") || body.includes("لا توجد نقلات")) { reached = "error"; break; }
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nState: ${reached} in ${elapsed}s\n`);

  if (reached === "review") {
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
    console.log(`Total moves: ${uniq.length}/33`);
    console.log(`Counts: ${JSON.stringify(counts)}`);

    console.log(`\nKey plies (which budget does this deploy have?):`);
    for (const p of [17, 19, 28, 29, 31, 33]) {
      const m = uniq.find(x => x.ply === p);
      console.log(`  ${p}. ${String(m?.san ?? "?").padEnd(6)} → ${m?.quality ?? "MISSING"}`);
    }

    // Diagnostic: are 1500ms counts vs 300ms?
    const bestCount = counts.best ?? 0;
    const blunderCount = counts.blunder ?? 0;
    console.log(`\nVERDICT:`);
    if (bestCount >= 15 && blunderCount <= 2) {
      console.log(`  ✓ 1500ms (best=${bestCount}, blunder=${blunderCount})`);
    } else if (bestCount <= 12 && blunderCount >= 3) {
      console.log(`  ⚠️ 300ms old deploy (best=${bestCount}, blunder=${blunderCount})`);
    } else {
      console.log(`  ? unclear (best=${bestCount}, blunder=${blunderCount})`);
    }
  }

  console.log(`\n═══ STOCKFISH NETWORK ═══`);
  for (const n of netLog.slice(0, 10)) console.log(`  ${n}`);

  console.log(`\n═══ CONSOLE (last 10) ═══`);
  for (const c of consoleLog.slice(-10)) console.log(`  ${c}`);

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
