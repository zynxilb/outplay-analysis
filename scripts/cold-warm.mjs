// scripts/cold-warm.mjs
import { chromium } from "playwright";

async function runOnce(page, label) {
  console.log(`\n──── ${label} ────`);
  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2000);

  // Count lichess responses for THIS run only
  let lichessCount = 0;
  let wasmCount = 0;
  const onResp = (res) => {
    const u = res.url();
    if (u.includes("lichess.org/api/cloud-eval")) lichessCount++;
    else if (u.includes("stockfish-19")) wasmCount++;
  };
  page.on("response", onResp);

  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(300);

  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  let done = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 200));
    if (body.includes("مراجعة المباراة")) { done = true; break; }
    if (body.includes("تعذر") || body.includes("حدث خطأ")) {
      console.log(`  ERROR at ${i*0.5}s`); break;
    }
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  page.off("response", onResp);

  // Cache stats
  const stats = await page.evaluate(async () => {
    return new Promise((r) => {
      try {
        const req = indexedDB.open("outplay-lichess-cache");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("evals", "readonly");
          const getReq = tx.objectStore("evals").getAll();
          getReq.onsuccess = () => {
            const all = getReq.result || [];
            r({ count: all.length, bytes: all.reduce((s,e)=>s+JSON.stringify(e).length, 0) });
          };
          getReq.onerror = () => r({ count: -1, bytes: 0 });
        };
        req.onerror = () => r({ count: -1, bytes: 0 });
      } catch { r({ count: -1, bytes: 0 }); }
    });
  });

  // Quality check
  const moves = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-ply]")).map(el => ({
      ply: parseInt(el.getAttribute("data-ply")),
      quality: el.getAttribute("data-quality"),
    })),
  );
  const uniq = Array.from(new Map(moves.map(m => [m.ply, m])).values());
  const nb = uniq.find(x => x.ply === 19);
  const bd = uniq.find(x => x.ply === 29);

  console.log(`  Elapsed:      ${elapsed}s`);
  console.log(`  Lichess net:  ${lichessCount} requests`);
  console.log(`  WASM loads:   ${wasmCount}`);
  console.log(`  Cache:        ${stats.count} entries (${(stats.bytes/1024).toFixed(1)} KB)`);
  console.log(`  19.Nxb5:      ${nb?.quality}`);
  console.log(`  29.Bxd7+:     ${bd?.quality}`);

  return { elapsed, lichess: lichessCount, wasm: wasmCount, cache: stats.count, nb: nb?.quality, bd: bd?.quality };
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  // Clear any pre-existing cache
  await page.goto("http://127.0.0.1:3000/import");
  await page.evaluate(() => new Promise((r) => {
    const req = indexedDB.deleteDatabase("outplay-lichess-cache");
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  }));

  const cold = await runOnce(page, "COLD (empty cache)");
  const warm = await runOnce(page, "WARM (cache populated)");

  console.log("\n══════ SUMMARY ══════");
  console.log(`  Cold:  ${cold.elapsed}s (lichess=${cold.lichess}, wasm=${cold.wasm}, cache=${cold.cache})`);
  console.log(`  Warm:  ${warm.elapsed}s (lichess=${warm.lichess}, wasm=${warm.wasm}, cache=${warm.cache})`);
  console.log(`  Speedup: ${cold.elapsed && warm.elapsed ? ((cold.elapsed/warm.elapsed).toFixed(1)+"x") : "?"}`);
  console.log(`  Quality: cold Nxb5=${cold.nb} Bxd7+=${cold.bd}`);
  console.log(`           warm Nxb5=${warm.nb} Bxd7+=${warm.bd}`);

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
