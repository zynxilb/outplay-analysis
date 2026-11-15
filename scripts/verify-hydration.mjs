// scripts/verify-hydration.mjs
import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "load" });
  await page.waitForSelector("textarea");

  console.log("Clicking جرّب مثال...");
  await page.locator('button:has-text("جرّب مثال")').first().click({ force: true });
  await page.waitForTimeout(500);

  const textareaVal = await page.evaluate(() => document.querySelector("textarea")?.value ?? "");
  const startEnabled = await page.locator('button:has-text("ابدأ التحليل")').first().isEnabled();

  console.log("textarea after click length:", textareaVal.length);
  console.log("textarea starts with:", JSON.stringify(textareaVal.slice(0, 40)));
  console.log("start button enabled:", startEnabled);

  if (textareaVal.length > 50 && startEnabled) {
    console.log("✓ HYDRATION WORKS");
    await browser.close();
    process.exit(0);
  } else {
    console.log("✗ HYDRATION STILL BROKEN");
    await browser.close();
    process.exit(1);
  }
})().catch((e) => {
  console.error("CRASH:", e.message);
  process.exit(2);
});
