const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const hosts = ['http://127.0.0.1:3001/', 'http://localhost:3001/'];
    for (const h of hosts) {
      try {
        console.log('Trying', h);
        const resp = await page.goto(h, { waitUntil: 'load', timeout: 10000 });
        console.log('goto resolved for', h, 'status:', resp && resp.status());
        break;
      } catch (err) {
        console.error('Navigation failed for', h, ':', err.message);
      }
    }
  } catch (err) {
    console.error('Navigation failed:', err.message);
    console.error(err);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();