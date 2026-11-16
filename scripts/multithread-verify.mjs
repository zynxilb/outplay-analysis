// scripts/multithread-verify.mjs
import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  const workerLogs = [];
  const consoleLogs = [];
  page.on("worker", (worker) => {
    workerLogs.push(`WORKER CREATED: ${worker.url()}`);
    worker.on("close", () => workerLogs.push("WORKER CLOSED"));
  });
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("Stockfish") || t.includes("Threads") || t.includes("threads") || t.includes("error") || t.includes("Error")) {
      consoleLogs.push(`[${msg.type()}] ${t.slice(0, 200)}`);
    }
  });

  console.log("Loading /import...");
  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2000);

  const env = await page.evaluate(() => ({
    crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
    hasSAB: typeof SharedArrayBuffer !== "undefined",
    cores: navigator.hardwareConcurrency,
  }));
  console.log("Env:", JSON.stringify(env));

  // Check engine file MIME types
  console.log("\nFetching engine files to verify MIME:");
  const jsRes = await page.evaluate(async () => {
    const r = await fetch("/engine/stockfish-19-lite.js", { method: "HEAD" });
    return { status: r.status, contentType: r.headers.get("content-type") };
  });
  console.log(`  stockfish-19-lite.js: ${jsRes.status} ct=${jsRes.contentType}`);

  const wasmRes = await page.evaluate(async () => {
    const r = await fetch("/engine/stockfish-19-lite.wasm", { method: "HEAD" });
    return { status: r.status, contentType: r.headers.get("content-type") };
  });
  console.log(`  stockfish-19-lite.wasm: ${wasmRes.status} ct=${wasmRes.contentType}`);

  // Now actually run analysis and measure
  console.log("\nStarting analysis (Opera Game)...");
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(500);

  // Deep mode (default)
  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  // Wait up to 180s for review screen
  let reached = "timeout";
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (body.includes("مراجعة المباراة")) { reached = "review"; break; }
    if (body.includes("حدث خطأ") || body.includes("تعذر تشغيل محرك") || body.includes("لم يتم العثور")) {
      reached = "error:" + body.substring(0, 100);
      break;
    }
    if (i % 20 === 19) console.log(`  still analyzing... ${i+1}s`);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nResult: ${reached} in ${elapsed}s`);

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
    console.log(`Counts: ${JSON.stringify(counts)}`);

    console.log("\nKey plies:");
    for (const p of [17, 19, 29, 31, 33]) {
      const m = uniq.find(x => x.ply === p);
      console.log(`  ${p}. ${String(m?.san ?? "?").padEnd(6)} → ${m?.quality ?? "MISSING"}`);
    }
  }

  console.log("\n═══ WORKERS ═══");
  for (const w of workerLogs) console.log(`  ${w}`);

  console.log("\n═══ CONSOLE (filtered) ═══");
  for (const c of consoleLogs.slice(0, 15)) console.log(`  ${c}`);

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
