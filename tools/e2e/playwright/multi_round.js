// Playwright helper script for deterministic multi-round run
// Usage: run in Playwright context or adapt into a Playwright test runner.

module.exports = async function runMultiRound(page, opts = {}) {
  // opts: { roomCode, hostName, bots, rounds, wordChoiceCount, wordMode, customWords }
  const { hostName = 'AutoHost', bots = 4, rounds = 3 } = opts;

  // Helper sleep
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.goto('http://localhost:3001');
  await page.waitForTimeout(300);
  await page.evaluate((host) => {
    const n = document.querySelector('#home-username'); if (n) n.value = host;
    const btn = document.querySelector('#btn-create-room'); if (btn) btn.click();
  }, hostName);
  await page.waitForTimeout(800);

  const roomCode = await page.evaluate(() => document.querySelector('#lobby-code')?.textContent?.trim());

  const contexts = [];
  for (let i = 1; i <= bots; i++) {
    const p = await page.context().newPage();
    await p.goto('http://localhost:3001');
    await p.waitForTimeout(200);
    await p.evaluate((name, rc) => {
      const n = document.querySelector('#home-username'); if (n) n.value = name;
      const r = document.querySelector('#home-roomcode'); if (r) r.value = rc;
      const b = document.querySelector('#btn-join-room'); if (b) b.click();
    }, `Bot${i}`, roomCode);
    contexts.push(p);
    await sleep(400);
  }

  // Start game
  await page.evaluate(() => { const btn = document.querySelector('#btn-start-game'); if (btn) btn.click(); });
  await page.waitForTimeout(1000);

  // rounds loop (simple): wait for drawer choices, select first, have bots submit the word
  for (let round = 1; round <= rounds; round++) {
    // wait for drawer choices on whichever page has them
    const drawerPage = page; // in deterministic runs earlier the host's page works
    await page.waitForSelector('#word-choice-buttons .word-choice-btn', { timeout: 10000 });
    const word = await page.evaluate(() => document.querySelector('#word-choice-buttons .word-choice-btn')?.textContent?.trim());
    await page.evaluate(() => document.querySelector('#word-choice-buttons .word-choice-btn')?.click());
    await sleep(300);
    for (const p of contexts) {
      await p.evaluate((w) => {
        const input = document.querySelector('#chat-input'); if (input) input.value = w;
        const form = document.querySelector('#chat-form'); if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
      }, word);
      await sleep(150);
    }
    await sleep(800);
  }

  // wait for results
  await page.waitForSelector('#screen-results', { timeout: 10000 }).catch(() => {});
  const winner = await page.evaluate(() => document.querySelector('#winner-badge')?.textContent?.trim());
  return { roomCode, winner };
};
