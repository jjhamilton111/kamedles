// Headless test for the Songs tab with Deezer/iTunes mocked (no network needed).
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const WAV = fs.readFileSync(path.resolve(__dirname, "silence.wav")), PH = fs.readFileSync(path.resolve(__dirname, "placeholder.png"));
  await page.route(/./, route => {
    const u = route.request().url();
    if (u.startsWith("file:")) return route.continue();
    if (/api\.deezer\.com\/track\//.test(u)) { const cb = new URL(u).searchParams.get("callback"); return route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}({"id":1,"preview":"https://cdnt-preview.dzcdn.net/test.wav","link":"https://www.deezer.com/track/1","album":{"cover_xl":"https://e-cdns-images.dzcdn.net/cover.png"}})` }); }
    if (/dzcdn\.net\/test\.wav/.test(u)) return route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
    if (/\.(png|jpe?g)|revision|cover/.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: PH });
    return route.abort();
  });
  const url = "file://" + path.resolve(__dirname, "../dist/index.html");
  await page.goto(url + "#songs");
  await page.waitForSelector(".player");
  await page.waitForSelector(".play-btn:not([disabled])", { timeout: 8000 });
  const info = await page.evaluate(() => { const g = window.KAMEDLES_SONGS.game; return { pool: window.KAMEDLES_SONGS.POOL.length, answer: g.answer.t, artist: g.answer.a }; });
  console.log("pool", info.pool, "answer", info.answer, "—", info.artist);
  await page.click(".play-btn"); await page.waitForTimeout(1500);
  console.log("after play time label:", await page.$eval(".bar-time", e => e.textContent));
  // skip once, then a wrong guess, then the right one
  await page.click('button:has-text("Skip")'); await page.waitForTimeout(300);
  console.log("clip after skip:", await page.$eval(".clip-label", e => e.textContent));
  const wrong = await page.evaluate(() => window.KAMEDLES_SONGS.POOL.find(s => s.id !== window.KAMEDLES_SONGS.game.answer.id).t);
  await page.fill("#guess", wrong); await page.waitForSelector(".sug"); await page.keyboard.press("Enter");
  await page.fill("#guess", info.answer); await page.waitForSelector(".sug");
  const sugs = await page.$$eval(".sug", els => els.map(e => e.textContent));
  const idx = await page.evaluate(({ t, a }) => [...document.querySelectorAll(".sug")].findIndex(e => e.textContent.includes(t) && e.textContent.includes(a.split(",")[0])), { t: info.answer, a: info.artist });
  await page.click(`.sug >> nth=${Math.max(0, idx)}`);
  await page.waitForSelector(".result");
  console.log("attempt row classes:", await page.$$eval(".att", els => els.map(e => e.className.replace("att ", "")).join(",")));
  console.log("result:", (await page.$eval(".result", e => e.textContent)).replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: path.resolve(__dirname, "shot-songs.png"), fullPage: true });
  // unlimited + filter + party
  await page.click('.seg[aria-label="Daily or unlimited"] button:has-text("Unlimited")');
  await page.waitForSelector(".people-filter");
  await page.click(".people-filter .chip >> nth=0");
  console.log("filter note:", await page.$eval(".filter-note", e => e.textContent));
  await page.click(".party summary");
  await page.click('.party-row >> nth=0 >> button:has-text("+1")');
  console.log("party top:", await page.$eval(".party-row", e => e.textContent.replace(/\s+/g, " ")));
  await page.screenshot({ path: path.resolve(__dirname, "shot-songs-unlimited.png"), fullPage: true });
  const m = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await m.route(/./, r => r.request().url().startsWith("file:") ? r.continue() : r.abort());
  await m.goto(url + "#songs"); await m.waitForSelector(".player");
  console.log("mobile no h-scroll:", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await m.screenshot({ path: path.resolve(__dirname, "shot-songs-mobile.png"), fullPage: true });
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
