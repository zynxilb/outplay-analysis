// scripts/multithread-test.mjs
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  const env = await page.evaluate(() => ({
    crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
    hasSAB: typeof SharedArrayBuffer !== "undefined",
    cores: navigator.hardwareConcurrency,
  }));
  console.log("Environment:", JSON.stringify(env));

  // Check what happens if SAB is available
  const sabTest = await page.evaluate(() => {
    try {
      const sab = new SharedArrayBuffer(1024);
      return { ok: true, byteLength: sab.byteLength };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  console.log("SharedArrayBuffer test:", JSON.stringify(sabTest));

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
