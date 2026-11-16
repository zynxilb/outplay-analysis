// scripts/lichess-only-test.mjs
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  // Clear cache first
  await page.goto("http://127.0.0.1:3000/import");
  await page.evaluate(() => new Promise((r) => {
    const req = indexedDB.deleteDatabase("outplay-lichess-cache");
    req.onsuccess = () => r(); req.onerror = () => r(); req.onblocked = () => r();
  }));

  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2000);

  let lichessCount = 0;
  let lichessStatuses = {};
  let wasmCount = 0;
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("lichess.org/api/cloud-eval")) {
      lichessCount++;
      const s = res.status();
      lichessStatuses[s] = (lichessStatuses[s] || 0) + 1;
    } else if (u.includes("stockfish-19")) wasmCount++;
  });

  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(300);

  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 200));
    if (body.includes("مراجعة المباراة")) break;
    if (body.includes("تعذر") || body.includes("حدث خطأ")) {
      console.log(`  ERROR at ${i*0.5}s`); break;
    }
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);

  const moves = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-ply]")).map(el => ({
      ply: parseInt(el.getAttribute("data-ply")),
      san: el.getAttribute("data-san"),
      quality: el.getAttribute("data-quality"),
    })),
  );
  const uniq = Array.from(new Map(moves.map(m => [m.ply, m])).values()).sort((a,b) => a.ply - b.ply);
  const counts = {};
  for (const m of uniq) counts[m.quality] = (counts[m.quality] ?? 0) + 1;

  console.log(`\n═══ RESULT ═══`);
  console.log(`  Elapsed:        ${elapsed}s`);
  console.log(`  Lichess reqs:   ${lichessCount}  (statuses: ${JSON.stringify(lichessStatuses)})`);
  console.log(`  WASM reqs:      ${wasmCount}  (should be 0)`);
  console.log(`  Total plies:    ${uniq.length}  (expect 33)`);
  console.log(`  Counts:         ${JSON.stringify(counts)}`);

  console.log(`\n  Key plies:`);
  for (const p of [17, 19, 27, 29, 31, 33]) {
    const m = uniq.find(x => x.ply === p);
    console.log(`    ply ${p}: ${m?.san ?? "MISSING"} → ${m?.quality ?? "unanalyzed"}`);
  }

  const failures = uniq.filter(m => m.quality === "unanalyzed");
  if (failures.length > 0) {
    console.log(`\n  Unanalyzed plies:`);
    for (const f of failures) console.log(`    ply ${f.ply}: ${f.san}`);
  }

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
