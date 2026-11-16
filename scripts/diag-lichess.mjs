// scripts/diag-lichess.mjs
import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  await page.goto("http://127.0.0.1:3000/import", { waitUntil: "domcontentloaded" });

  // Test 1: start position (white to move, ~+0.3)
  // Test 2: after 1.e4 (black to move, white still ~+0.3)
  const tests = [
    { name: "start", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
    { name: "after 1.e4", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" },
  ];

  for (const t of tests) {
    const r = await page.evaluate(async (fen) => {
      const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1&variant=standard`;
      try {
        const res = await fetch(url);
        if (!res.ok) return { status: res.status, err: "not-ok" };
        return { status: 200, body: await res.json() };
      } catch (e) {
        return { status: "network-error", err: String(e) };
      }
    }, t.fen);
    console.log(`\n${t.name}:`);
    if (r.status === 200) {
      console.log(`  depth: ${r.body.depth}`);
      console.log(`  pv0.cp: ${r.body.pvs[0].cp}`);
      console.log(`  pv0.mate: ${r.body.pvs[0].mate}`);
      console.log(`  moves: ${r.body.pvs[0].moves.slice(0, 50)}...`);
    } else {
      console.log(`  ${r.status}: ${JSON.stringify(r).slice(0, 200)}`);
    }
  }

  await browser.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
