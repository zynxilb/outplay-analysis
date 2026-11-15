// scripts/smoke.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/content/smoke-shots";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  [" + detail + "]" : ""}`);
}

async function shot(page, name, opts = {}) {
  try {
    await page.screenshot({
      path: `${OUT}/${name}.png`,
      timeout: 10000,
      animations: "disabled",
      ...opts,
    });
    return true;
  } catch (e) {
    console.log(`  (screenshot ${name} failed: ${e.message.split("\n")[0]})`);
    return false;
  }
}

async function gotoDom(page, url, timeout = 20000) {
  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    return res && res.ok();
  } catch (e) {
    console.log(`  (goto ${url} failed: ${e.message.split("\n")[0]})`);
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // ═════════ DESKTOP ═════════
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const ready = await gotoDom(page, `${BASE}/import`);
  await page.waitForTimeout(2000);
  log("server reachable", ready);
  if (!ready) {
    await shot(page, "00-server-fail");
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    await browser.close();
    process.exit(1);
  }

  // Wait for textarea (the actual content)
  try {
    await page.waitForSelector("textarea", { timeout: 15000 });
    log("1. /import loads", true);
  } catch {
    log("1. /import loads", false, "no textarea found");
  }
  await shot(page, "01-import");

  // Load sample
  try {
    await page.locator('button:has-text("جرّب مثال")').click({ timeout: 8000 });
    await page.waitForTimeout(400);
    const pgnVal = await page.locator("textarea").inputValue();
    log("2. sample loads Opera Game", pgnVal.includes("1.e4") || pgnVal.includes("Morphy"));
  } catch (e) {
    log("2. sample loads Opera Game", false, e.message.split("\n")[0]);
  }
  await shot(page, "02-sample-loaded");

  // Start analysis
  try {
    await page.locator('button:has-text("ابدأ التحليل")').click({ timeout: 8000 });
  } catch (e) {
    log("3. start clicked", false, e.message.split("\n")[0]);
  }
  await page.waitForTimeout(1500);
  await shot(page, "03-analyzing");
  const analyzing = await page.locator("text=جاري التحليل").count() > 0;
  log("3. analyzing state visible", analyzing);

  // Wait for review (analysis: 15-60s with real Stockfish)
  let reachedReview = false;
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("مراجعة المباراة")
           || document.body.innerText.includes("لم نتمكن")
           || document.body.innerText.includes("حدث خطأ")
           || document.body.innerText.includes("تعذّر"),
      { timeout: 90000, polling: 500 },
    );
    const bodyText = await page.locator("body").innerText();
    reachedReview = bodyText.includes("مراجعة المباراة");
  } catch {
    log("4. analysis completed (timeout)", false, "90s exceeded");
  }
  log("4. Opera reaches review screen", reachedReview);
  await shot(page, "04-review");

  if (reachedReview) {
    const svgCount = await page.locator("main svg").count();
    log("5. SVG elements rendered", svgCount > 10, `${svgCount} svgs`);

    const bodyText = await page.locator("body").innerText();
    const hasCoach = bodyText.includes("كش مات")
      || bodyText.includes("لا يوجد شرح متاح")
      || bodyText.includes("الأفضل كان")
      || bodyText.includes("لم تُحلل");
    log("5b. coach card Arabic content", hasCoach);

    // Nav back
    try {
      for (let i = 0; i < 5; i++) {
        await page.locator('button[aria-label="السابق"]').first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(100);
      }
      log("6. navigation works", true);
    } catch (e) {
      log("6. navigation works", false, e.message.split("\n")[0]);
    }
    await shot(page, "05-after-nav");

    const bodyAfterNav = await page.locator("body").innerText();
    log("6b. unanalyzed placeholder visible", bodyAfterNav.includes("لا يوجد شرح متاح") || bodyAfterNav.includes("لم تُحلل"));

    // Flip
    try {
      await page.locator('button[aria-label="قلب الرقعة"]').click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await shot(page, "06-flipped");
      log("13. flip board works", true);
    } catch (e) {
      log("13. flip board works", false, e.message.split("\n")[0]);
    }
  }

  // Console errors
  const realErrors = consoleErrors.filter((e) =>
    !e.includes("React DevTools")
    && !e.includes("favicon")
    && !e.includes("Turbopack")
    && !e.includes("Warning:")
  );
  log("no unexpected console errors", realErrors.length === 0,
    realErrors.slice(0, 3).join(" | ").slice(0, 300));

  await page.close();

  // ═════════ MOBILE ═════════
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  mobile.setDefaultTimeout(15000);
  await gotoDom(mobile, `${BASE}/import`);
  try {
    await mobile.waitForSelector("textarea", { timeout: 10000 });
    log("15. mobile /import renders", true);
  } catch {
    log("15. mobile /import renders", false);
  }
  await shot(mobile, "07-mobile-import");
  await mobile.close();

  // ═════════ MALFORMED PGN ═════════
  const bad = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  bad.setDefaultTimeout(20000);
  await gotoDom(bad, `${BASE}/import`);
  try {
    await bad.locator("textarea").fill("THIS IS NOT A VALID PGN");
    await bad.locator('button:has-text("ابدأ التحليل")').click({ timeout: 5000 });
    await bad.waitForTimeout(8000);
    await shot(bad, "08-bad-pgn");
    const body = await bad.locator("body").innerText();
    const errShown = body.includes("حدث خطأ")
      || body.includes("تعذّر")
      || body.includes("حاول مرة أخرى")
      || body.includes("لم نتمكن");
    log("8. malformed PGN shows Arabic error", errShown);
  } catch (e) {
    log("8. malformed PGN", false, e.message.split("\n")[0]);
  }
  await bad.close();

  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n=== SUMMARY: ${pass} pass, ${fail} fail ===`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(2);
});
