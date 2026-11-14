// scripts/test-pipeline.mjs
// Playwright runner for the pipeline integration page.
// Requires `npm run dev` on :3000.

import { chromium } from "playwright";

const URL = process.env.PIPELINE_URL ?? "http://localhost:3000/dev/pipeline-test";
const TIMEOUT_MS = 120_000;
const TARGET_MS = 15_000;

async function main() {
  console.log(`Navigating to ${URL}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("[pageerror]", err.message));

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 });
    console.log("Page loaded. Waiting for pipeline result...");

    await page.waitForFunction(
      () => {
        const el = document.getElementById("pipeline-result");
        return el?.getAttribute("data-phase") === "done" ||
               el?.getAttribute("data-phase") === "error";
      },
      { timeout: TIMEOUT_MS }
    );

    const result = await page.evaluate(() => window.__PIPELINE_RESULT__);
    console.log("\n=== PIPELINE RESULT ===");
    console.log(JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("\n=== ERROR ===");
      console.error(result.error);
      await browser.close();
      process.exit(1);
    }

    const functionalFailures = [];
    if (result.status !== "complete") functionalFailures.push(`status="${result.status}" (expected "complete")`);
    if (result.moveCount !== 33) functionalFailures.push(`moveCount=${result.moveCount} (expected 33)`);
    if (result.lastMoveSan !== "Rd8#") functionalFailures.push(`lastMoveSan="${result.lastMoveSan}" (expected "Rd8#")`);
    if (result.lastMoveQuality !== "Best") functionalFailures.push(`lastMoveQuality="${result.lastMoveQuality}" (expected "Best")`);
    if (result.firstMoveSan !== "e4") functionalFailures.push(`firstMoveSan="${result.firstMoveSan}" (expected "e4")`);
    if (result.failuresCount !== 0) functionalFailures.push(`failuresCount=${result.failuresCount} (expected 0)`);
    if (result.explanationsCount !== 0) functionalFailures.push(`explanationsCount=${result.explanationsCount} (expected 0 — Stage 4 scope)`);
    if (result.refutationsCount !== 0) functionalFailures.push(`refutationsCount=${result.refutationsCount} (expected 0 — Stage 4 scope)`);
    if (result.rootsCount !== result.pvsCount) functionalFailures.push(`rootsCount=${result.rootsCount} != pvsCount=${result.pvsCount}`);

    if (functionalFailures.length > 0) {
      console.error("\n=== FUNCTIONAL FAILURES ===");
      for (const f of functionalFailures) console.error("  ✗ " + f);
      await browser.close();
      process.exit(1);
    }

    console.log("\n=== TIMING ===");
    console.log(`Total: ${result.totalMs.toFixed(0)}ms (target: ${TARGET_MS}ms)`);
    const over = result.totalMs > TARGET_MS;
    if (over) {
      console.error(`  ✗ OVER target by ${(result.totalMs - TARGET_MS).toFixed(0)}ms`);
    } else {
      console.log(`  ✓ UNDER target by ${(TARGET_MS - result.totalMs).toFixed(0)}ms`);
    }

    if (over) {
      console.error("\n=== FAILED (timing) ===");
      await browser.close();
      process.exit(1);
    }

    console.log("\n=== PASS ===");
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error("\n=== FAILED ===");
    console.error(e instanceof Error ? e.message : String(e));
    try {
      const txt = await page.evaluate(() => document.body.innerText.slice(0, 2000));
      console.error("Page text:", txt);
    } catch {}
    await browser.close();
    process.exit(1);
  }
}

main();
