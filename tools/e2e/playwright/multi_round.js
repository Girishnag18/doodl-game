// Playwright helper script for deterministic multi-round run
// Usage: run in Playwright context or adapt into a Playwright test runner.

module.exports = async function runMultiRound(page, opts = {}) {
  // opts: { roomCode, hostName, bots, rounds, wordChoiceCount, wordMode, customWords, screenshotPrefix }
  const { hostName = 'AutoHost', bots = 4, rounds = 3, screenshotPrefix } = opts;

  // Helper sleep
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.goto('http://127.0.0.1:3001');
  await page.waitForTimeout(300);
  // fill host name and create room using Playwright actions to avoid evaluate-arg limitations
  await page.fill('#home-username', hostName).catch(() => {});
  await page.click('#btn-create-room').catch(() => {});
  await page.waitForTimeout(800);

  const roomCode = await page.evaluate(() => document.querySelector('#lobby-code')?.textContent?.trim());

  const contexts = [];
  for (let i = 1; i <= bots; i++) {
    const p = await page.context().newPage();
    await p.goto('http://localhost:3001');
    await p.waitForTimeout(200);
    // join bot using Playwright actions to avoid evaluate argument issues
    await p.fill('#home-username', `Bot${i}`).catch(() => {});
    await p.fill('#home-roomcode', roomCode).catch(() => {});
    await p.click('#btn-join-room').catch(() => {});
    contexts.push(p);
    await sleep(400);
  }

  // Start game
  await page.evaluate(() => { const btn = document.querySelector('#btn-start-game'); if (btn) btn.click(); });
  await page.waitForTimeout(1000);

  // rounds loop (simple): wait for drawer choices, select first, have bots submit the word
  for (let round = 1; round <= rounds; round++) {
    // wait for drawer choices on whichever page has them
    let word;
    let clicked = false;
    const pagesToCheck = [page, ...contexts];
    for (const p of pagesToCheck) {
      const count = await p.$$eval('#word-choice-buttons .word-choice-btn', els => els.length).catch(() => 0);
      if (count > 0) {
        word = await p.$$eval('#word-choice-buttons .word-choice-btn', els => els[0].textContent.trim());
        await p.evaluate(() => document.querySelectorAll('#word-choice-buttons .word-choice-btn')[0]?.click()).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // fallback: wait longer on host page
      await page.waitForSelector('#word-choice-buttons .word-choice-btn', { timeout: 30000 });
      word = await page.evaluate(() => document.querySelector('#word-choice-buttons .word-choice-btn')?.textContent?.trim());
      await page.evaluate(() => document.querySelector('#word-choice-buttons .word-choice-btn')?.click());
    }
    await sleep(300);

    // optional screenshot of game screen after choice selected
    if (screenshotPrefix) {
      try {
        const path = `${screenshotPrefix}-round${round}-game.png`;
        await page.screenshot({ path, fullPage: true }).catch(() => {});
      } catch (e) { /* ignore */ }
    }

    for (const p of contexts) {
      // use Playwright input + press Enter to submit chat (works with typical chat forms)
      await p.fill('#chat-input', word).catch(() => {});
      await p.press('#chat-input', 'Enter').catch(() => {});
      await sleep(150);
    }
    await sleep(800);
  }

  // wait for results
  await page.waitForSelector('#screen-results', { timeout: 10000 }).catch(() => {});

  // optional screenshot of results
  if (screenshotPrefix) {
    try {
      const path = `${screenshotPrefix}-results.png`;
      await page.screenshot({ path, fullPage: true }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  const winner = await page.evaluate(() => document.querySelector('#winner-badge')?.textContent?.trim());
  return { roomCode, winner };
};
