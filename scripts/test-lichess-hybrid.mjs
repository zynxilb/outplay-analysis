// scripts/test-lichess-hybrid.mjs
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  const lichessCalls = [];
  const otherCalls = [];
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("lichess.org/api/cloud-eval")) {
      lichessCalls.push({ status: res.status(), url: u.slice(0, 100) });
    } else if (u.includes("stockfish-19")) {
      otherCalls.push({ status: res.status(), url: u.split("/").pop() });
    }
  });

  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(500);

  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (body.includes("مراجعة المباراة")) break;
    if (body.includes("تعذر") || body.includes("حدث خطأ")) {
      console.log(`ERROR at ${i}s:`, body.substring(0, 150));
      break;
    }
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nElapsed: ${elapsed}s`);

  const moves = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-ply]")).map(el => ({
      ply: parseInt(el.getAttribute("data-ply")),
      san: el.getAttribute("data-san"),
      quality: el.getAttribute("data-quality"),
    }));
  });
  const uniq = Array.from(new Map(moves.map(m => [m.ply, m])).values());
  const counts = {};
  for (const m of uniq) counts[m.quality] = (counts[m.quality] ?? 0) + 1;
  console.log(`Counts: ${JSON.stringify(counts)}`);
  for (const p of [17, 19, 29, 31, 33]) {
    const m = uniq.find(x => x.ply === p);
    console.log(`  ${p}. ${String(m?.san).padEnd(6)} → ${m?.quality}`);
  }

  console.log(`\nLichess API calls: ${lichessCalls.length}`);
  for (const c of lichessCalls.slice(0, 5)) console.log(`  ${c.status} ${c.url.slice(0, 80)}`);
  console.log(`Non-200 lichess responses: ${lichessCalls.filter(c => c.status !== 200).length}`);
  console.log(`WASM calls: ${otherCalls.length}`);

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
