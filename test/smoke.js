// Headless smoke test: loads dist/index.html, plays every series in every mode, checks logic + console.
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; await page.addInitScript(() => { window.$ = s => document.querySelector(s); });
  const PH = require("fs").readFileSync(path.resolve(__dirname, "placeholder.png"));
  const fakeImages = async ctx => ctx.route(/(anilist\.co|wikia\.nocookie\.net|googleapis|gstatic)/, route => /\.(png|jpe?g)|revision/i.test(route.request().url()) ? route.fulfill({ status: 200, contentType: "image/png", body: PH }) : route.abort());
  await fakeImages(page.context());
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("PAGEERROR " + e.message));
  const url = "file://" + path.resolve(__dirname, "../dist/index.html");
  await page.goto(url);
  await page.waitForSelector(".scard");
  const cards = await page.$$eval(".scard", els => els.length);
  console.log("series cards:", cards);
  await page.screenshot({ path: path.resolve(__dirname, "shot-home.png"), fullPage: true });

  const ids = process.env.SERIES ? process.env.SERIES.split(",") : await page.evaluate(() => window.DLE.order);
  let checks = 0;
  for (const id of ids) {
    for (const mode of ["classic", "quote", "emoji"]) {
      if (process.env.QUICK && mode !== "classic" && id !== ids[0]) continue;
      await page.goto(url + "#" + id);
      await page.waitForSelector(".series-title");
      // pick mode tab
      await page.click(`.seg[aria-label="Mode"] button:has-text("${mode[0].toUpperCase() + mode.slice(1)}")`);
      await page.waitForSelector("#guess");
      // find the answer by reproducing the seeding in-page
      const info = await page.evaluate(({ id, mode }) => {
        const s = window.DLE.series[id];
        const pool = mode === "quote" ? s.characters.filter(c => c.quote) : s.characters;
        return { n: pool.length, names: pool.map(c => c.name) };
      }, { id, mode });
      // make 3 wrong-ish guesses (first three pool names), then brute force until solved
      let solved = false, tries = 0;
      for (const name of info.names) {
        if (solved) break;
        await page.fill("#guess", name);
        try { await page.waitForSelector(".sug", { timeout: 5000 }); }
        catch (e) { const st = await page.evaluate(() => ({ formHidden: $(".guess-form") && $(".guess-form").hidden, sugHidden: $(".suggest") && $(".suggest").hidden, html: ($(".suggest") || {}).innerHTML, val: ($("#guess") || {}).value, result: !!$(".result"), active: document.activeElement.tagName + "#" + document.activeElement.id })); const stored = await page.evaluate(() => { const g = window.KAMEDLES.game; return JSON.stringify({ series: g.seriesId, mode: g.mode, guesses: g.guesses, solved: g.solved, answer: g.answer.name }); }); throw new Error(`${id}/${mode} "${name}": ${JSON.stringify(st).slice(0, 300)} STORED ${stored.slice(0, 600)}`); }
        await page.keyboard.press("Enter");
        tries++;
        solved = await page.evaluate(({ id, mode }) => { try { const s = JSON.parse(localStorage.getItem("kamedles.v1")); return Object.entries(s.games).some(([k, g]) => k.startsWith(`${id}:${mode}:`) && g.solved); } catch (e) { return false; } }, { id, mode });
        if (solved) await page.waitForSelector(".result");
        if (!solved) {
          // ensure a row/list item was added
          const rows = await page.evaluate(() => document.querySelectorAll(".grow, .gi").length);
          if (rows !== tries) throw new Error(`${id}/${mode}: expected ${tries} rows, got ${rows}`);
        }
        if (tries > 120) throw new Error("did not solve");
      }
      if (!solved) { await page.waitForSelector(".result", { timeout: 3000 }); solved = true; }
      const resultText = await page.$eval(".result", el => el.textContent);
      if (!/solved in/i.test(resultText)) throw new Error(`${id}/${mode}: result text missing: ${resultText.slice(0, 80)}`);
      // reload: state should persist and result should still show
      await page.reload();
      await page.waitForSelector(".result");
      checks++;
      if (id === ids[0] && mode === "classic") await page.screenshot({ path: path.resolve(__dirname, "shot-classic.png"), fullPage: true });
      if (id === ids[0] && mode === "quote") await page.screenshot({ path: path.resolve(__dirname, "shot-quote.png"), fullPage: true });
      if (id === ids[0] && mode === "emoji") await page.screenshot({ path: path.resolve(__dirname, "shot-emoji.png"), fullPage: true });
    }
  }
  console.log("solved games:", checks);
  // share text sanity
  await page.goto(url + "#" + ids[0]);
  await page.waitForSelector(".result");
  // stats modal
  await page.click('button[title="Statistics"]');
  await page.waitForSelector(".dialog");
  const statText = await page.$eval(".dialog", el => el.textContent);
  console.log("stats:", statText.replace(/\s+/g, " ").slice(0, 120));
  await page.screenshot({ path: path.resolve(__dirname, "shot-stats.png") });
  await page.keyboard.press("Escape");
  // help modal
  await page.click('button[title="How to play"]');
  await page.waitForSelector(".dialog");
  await page.screenshot({ path: path.resolve(__dirname, "shot-help.png") });
  await page.keyboard.press("Escape");
  // home cards should show done pills
  await page.click(".crumb");
  await page.waitForSelector(".scard");
  const done = await page.$$eval(".pill.done", els => els.length);
  console.log("done pills on home:", done);
  // unlimited mode + give up
  await page.goto(url + "#" + ids[1]);
  await page.click('.seg[aria-label="Daily or unlimited"] button:has-text("Unlimited")');
  await page.waitForSelector("#guess");
  await page.click(".link-btn");
  await page.click('button:has-text("Reveal")');
  await page.waitForSelector(".result");
  const ul = await page.$eval(".result", el => el.textContent);
  console.log("unlimited reveal:", ul.replace(/\s+/g, " ").slice(0, 90));
  await page.screenshot({ path: path.resolve(__dirname, "shot-unlimited.png"), fullPage: true });
  // hints stay face-down until clicked
  await page.goto(url + "#" + ids[0]);
  await page.click('.seg[aria-label="Mode"] button:has-text("Quote")');
  await page.click('.seg[aria-label="Daily or unlimited"] button:has-text("Unlimited")');
  await page.waitForSelector("#guess");
  const wrongNames = await page.evaluate(() => { const g = window.KAMEDLES.game; return g.series.characters.filter(c => c.id !== g.answer.id).slice(0, 2).map(c => c.name); });
  for (const nm of wrongNames) { await page.fill("#guess", nm); await page.waitForSelector(".sug"); await page.keyboard.press("Enter"); }
  const h1 = await page.evaluate(() => ({ ready: document.querySelectorAll(".hint.ready").length, open: document.querySelectorAll(".hint.open").length }));
  await page.click(".hint.ready");
  const h2 = await page.evaluate(() => ({ ready: document.querySelectorAll(".hint.ready").length, open: document.querySelectorAll(".hint.open").length }));
  console.log("hints after 2 misses:", JSON.stringify(h1), "after click:", JSON.stringify(h2));
  if (h1.open !== 0 || h1.ready !== 1 || h2.open !== 1) throw new Error("hint flip behaviour wrong");
  await page.screenshot({ path: path.resolve(__dirname, "shot-hints.png"), fullPage: true });
  // suggestion dropdown screenshot
  await page.click("#guess"); await page.fill("#guess", "ma");
  try { await page.waitForSelector(".sug", { timeout: 5000 }); await page.screenshot({ path: path.resolve(__dirname, "shot-suggest.png") }); }
  catch { console.log("note: suggestion dropdown screenshot skipped (timing)"); }
  // mobile viewport
  const m = await browser.newPage({ viewport: { width: 390, height: 800 } }); await fakeImages(m.context());
  await m.goto(url + "#" + ids[0]);
  await m.waitForSelector("#guess");
  for (const nm of (await m.evaluate(() => window.KAMEDLES.game.series.characters.filter(c => c.id !== window.KAMEDLES.game.answer.id).slice(0, 3).map(c => c.name)))) { await m.fill("#guess", nm); await m.waitForSelector(".sug"); await m.keyboard.press("Enter"); }
  await m.waitForTimeout(1200);
  const sw = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  console.log("mobile no horizontal page scroll:", sw);
  await m.screenshot({ path: path.resolve(__dirname, "shot-mobile.png"), fullPage: true });
  await m.goto(url);
  await m.waitForSelector(".scard");
  await m.screenshot({ path: path.resolve(__dirname, "shot-mobile-home.png"), fullPage: true });
  console.log("console errors:", errors.length ? errors : "none");
  await browser.close();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
