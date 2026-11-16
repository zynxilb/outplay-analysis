// scripts/test-hosts.mjs
import { chromium } from "playwright";

async function testHost(name, url) {
  console.log(`\n════════ ${name.toUpperCase()} — ${url} ════════`);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  let workerCount = 0;
  page.on("worker", () => workerCount++);

  try {
    await page.goto(`${url}/import`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("textarea", { timeout: 20000 });
    await page.waitForTimeout(2500);

    const env = await page.evaluate(() => ({
      coi: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
      hasSAB: typeof SharedArrayBuffer !== "undefined",
      cores: navigator.hardwareConcurrency,
    }));
    console.log(`  crossOriginIsolated: ${env.coi}`);
    console.log(`  hasSAB:              ${env.hasSAB}`);
    console.log(`  cores:               ${env.cores}`);

    // Check engine MIME
    const mime = await page.evaluate(async () => {
      const js = await fetch("/engine/stockfish-19-lite.js", { method: "HEAD" });
      const wasm = await fetch("/engine/stockfish-19-lite.wasm", { method: "HEAD" });
      return {
        js: { status: js.status, ct: js.headers.get("content-type") },
        wasm: { status: wasm.status, ct: wasm.headers.get("content-type") },
      };
    });
    console.log(`  js   MIME: ${mime.js.status} ${mime.js.ct}`);
    console.log(`  wasm MIME: ${mime.wasm.status} ${mime.wasm.ct}`);

    // Run analysis
    console.log(`  Starting Opera Game analysis...`);
    await page.locator('button:has-text("جرّب مثال")').click({ force: true });
    await page.waitForTimeout(500);

    const t0 = Date.now();
    await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

    let reached = "timeout";
    for (let i = 0; i < 180; i++) {
      await page.waitForTimeout(1000);
      const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
      if (body.includes("مراجعة المباراة")) { reached = "review"; break; }
      if (body.includes("تعذر تشغيل محرك") || body.includes("حدث خطأ")) {
        reached = "error:" + body.substring(0, 80).replace(/\n/g, " ");
        break;
      }
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`  Result: ${reached} in ${elapsed}s`);

    if (reached === "review") {
      const moves = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("[data-ply]")).map(el => ({
          ply: parseInt(el.getAttribute("data-ply")),
          san: el.getAttribute("data-san"),
          quality: el.getAttribute("data-quality"),
        }));
      });
      const uniq = Array.from(new Map(moves.map(m => [m.ply, m])).values()).sort((a, b) => a.ply - b.ply);
      const counts = {};
      for (const m of uniq) counts[m.quality] = (counts[m.quality] ?? 0) + 1;
      console.log(`  Counts: ${JSON.stringify(counts)}`);

      for (const p of [19, 29, 31]) {
        const m = uniq.find(x => x.ply === p);
        console.log(`  ply ${p}. ${String(m?.san).padEnd(6)} → ${m?.quality}`);
      }
    }

    console.log(`  Workers created: ${workerCount}`);

  } catch (e) {
    console.log(`  FATAL: ${e.message}`);
  } finally {
    await browser.close();
  }
}

(async () => {
  await testHost("pxxlspace", "https://outplay-analysis.pxxlspace.cv");
  await testHost("vercel",    "https://outplay-analysis.vercel.app");
})().catch(e => { console.error("CRASH:", e); process.exit(1); });
