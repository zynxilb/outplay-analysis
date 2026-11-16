// scripts/diag-pxxl-deep.mjs
import { chromium } from "playwright";
const URL = "https://outplay-analysis.pxxlspace.cv";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(`${URL}/import`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea", { timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.locator('button:has-text("جرّب مثال")').click({ force: true });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("ابدأ التحليل")').click({ force: true });

  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (body.includes("مراجعة المباراة") || body.includes("حدث خطأ")) break;
  }

  const diag = await page.evaluate(() => {
    // Count all buttons in the document
    const allButtons = document.querySelectorAll("button");
    const withDataPly = document.querySelectorAll("[data-ply]");
    // Find move-looking buttons (SAN-like text)
    const sanPattern = /^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?$|^O-O(-O)?[+#]?$|^[a-h][1-8](?:=[QRBN])?[+#]?$/;
    const moveButtons = Array.from(allButtons).filter(b => {
      const t = (b.textContent || "").trim();
      return sanPattern.test(t);
    });
    // Check if the page contains known Opera Game moves
    const body = document.body.innerText;
    return {
      url: location.href,
      totalButtons: allButtons.length,
      dataPlyButtons: withDataPly.length,
      sanLikeButtons: moveButtons.length,
      hasNxb5: body.includes("Nxb5"),
      hasRd8: body.includes("Rd8"),
      hasMate: body.includes("كش مات"),
      hasExplanationPanel: body.includes("الشرح") || body.includes("أفضل نقلة"),
      // Detect presence of our data-quality attrs
      hasDataQuality: !!document.querySelector("[data-quality]"),
      // Look for the config version hint (if any)
      bodyPreview: body.slice(0, 400),
    };
  });

  console.log("═════ DIAGNOSTIC ═════");
  for (const [k, v] of Object.entries(diag)) {
    if (typeof v === "string" && v.length > 200) {
      console.log(`  ${k}:`);
      console.log(`    ${v.replace(/\n/g, " | ").slice(0, 300)}`);
    } else {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  // Try to extract moves from SAN-like buttons
  if (diag.sanLikeButtons > 5) {
    const extracted = await page.evaluate(() => {
      const sanPattern = /^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?$|^O-O(-O)?[+#]?$|^[a-h][1-8](?:=[QRBN])?[+#]?$/;
      const buttons = Array.from(document.querySelectorAll("button"));
      const found = [];
      for (const b of buttons) {
        const t = (b.textContent || "").trim();
        if (sanPattern.test(t)) {
          found.push(t);
        }
      }
      return found;
    });
    console.log(`\n  Extracted SAN moves (${extracted.length}):`);
    console.log(`    ${extracted.join(", ")}`);
  }

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
