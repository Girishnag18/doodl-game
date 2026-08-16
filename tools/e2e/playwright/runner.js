const { chromium } = require('playwright');
const run = require('./multi_round');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const result = await run(page, { bots: 4, rounds: 3 });
    console.log('E2E result:', result);
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('E2E run failed:', err);
    await browser.close();
    process.exit(1);
  }
})();
