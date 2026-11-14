// scripts/bench-stockfish.mjs
// Run the benchmark page headlessly, extract results, print JSON.
// Requires: `npm run dev` running on :3000

import { chromium } from "playwright";

const URL = process.env.BENCH_URL ?? "http://localhost:3000/dev/engine-benchmark";
const TIMEOUT_MS = 120_000;

async function main() {
  console.log(`Navigating to ${URL}...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[browser]", msg.text());
  });
  page.on("pageerror", (err) => console.error("[pageerror]", err.message));

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 });
    console.log("Page loaded. Waiting for benchmark to complete...");

    await page.waitForFunction(
      () => {
        const el = document.getElementById("benchmark-results");
        return el?.getAttribute("data-phase") === "done";
      },
      { timeout: TIMEOUT_MS }
    );

    const data = await page.evaluate(() => window.__BENCHMARK_RESULTS__);
    console.log("\n=== BENCHMARK RESULTS ===");
    console.log(JSON.stringify(data, null, 2));

    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error("\n=== BENCHMARK FAILED ===");
    console.error(e instanceof Error ? e.message : String(e));
    try {
      const err = await page.evaluate(() => document.body.innerText.slice(0, 2000));
      console.error("Page text:", err);
    } catch {}
    await browser.close();
    process.exit(1);
  }
}

main();
