const { chromium } = require('playwright');
const run = require('./multi_round');

(async () => {
  const bots = 19; // host + 19 bots = 20 players
  const rounds = 3;
  console.log(`Starting 20-player run: host + ${bots} bots, ${rounds} rounds`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const result = await run(page, { bots, rounds });
    console.log('E2E result:', result);
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('E2E run failed:', err);
    await browser.close();
    process.exit(1);
  }
})();
