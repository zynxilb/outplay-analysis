// scripts/diag-vercel-v2.mjs
import { chromium } from "playwright";

const URL = process.argv[2] || "https://outplay-analysis.vercel.app";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);

  const netLog = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("stockfish") || u.includes(".wasm") || u.includes(".worker")) {
      netLog.push(`REQ  ${req.method()} ${u}`);
    }
  });
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("stockfish") || u.includes(".wasm") || u.includes(".worker")) {
      netLog.push(`RES  ${res.status()} ${u.slice(0, 120)}`);
    }
  });
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (u.includes("stockfish") || u.includes(".wasm") || u.includes(".worker")) {
      netLog.push(`FAIL ${u.slice(0, 120)} → ${req.failure()?.errorText}`);
    }
  });

  const consoleLog = [];
  page.on("console", (msg) => {
    consoleLog.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => {
    consoleLog.push(`[pageerror] ${e.message}`);
  });

  console.log(`Loading ${URL}/import...`);
  await page.goto(`${URL}/import`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea", { timeout: 15000 });
  await page.waitForTimeout(2500);

  const env = await page.evaluate(() => ({
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    hasWorker: typeof Worker !== "undefined",
    hasWasmStreaming: typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiateStreaming === "function",
    crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
    userAgent: navigator.userAgent.slice(0, 100),
  }));
  console.log("\nEnvironment:", JSON.stringify(env, null, 2));

  console.log("\nClicking sample...");
  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(800);

  console.log("Clicking analyze...\n");
  const t0 = Date.now();
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  let lastState = "";
  const states = [];
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    const elapsed = Math.round((Date.now() - t0) / 1000);

    let state = "unknown";
    if (body.includes("حدث خطأ") || body.includes("لا توجد نقلات") || body.includes("تعذّر")) state = "error";
    else if (body.includes("مراجعة المباراة")) state = "review";
    else if (body.includes("جاري التحليل")) state = "analyzing";

    if (state !== lastState) {
      states.push({ t: elapsed, state });
      console.log(`  t=${elapsed}s: ${state}`);
      lastState = state;
      if (state === "error" || state === "review") break;
    }
  }

  console.log("\n═══ STATE TRANSITIONS ═══");
  for (const s of states) console.log(`  ${s.t}s → ${s.state}`);

  const finalBody = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log("\nFinal body:", JSON.stringify(finalBody));

  console.log("\n═══ STOCKFISH NETWORK ═══");
  if (netLog.length === 0) console.log("(no stockfish requests captured)");
  else for (const n of netLog.slice(0, 30)) console.log(`  ${n}`);

  console.log("\n═══ CONSOLE (all) ═══");
  if (consoleLog.length === 0) console.log("(none)");
  else for (const c of consoleLog.slice(0, 30)) console.log(`  ${c}`);

  await page.screenshot({ path: "/tmp/vercel-v2.png" });
  await browser.close();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
