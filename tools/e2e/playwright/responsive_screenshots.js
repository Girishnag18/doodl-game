const { chromium, devices } = require('playwright');
const fs = require('fs');

(async () => {
  const outDir = './tools/e2e/screenshots';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const configs = [
    { name: 'iPhone SE', device: devices['iPhone SE'] },
    { name: 'iPhone 12', device: devices['iPhone 12'] },
    { name: 'Pixel 5', device: devices['Pixel 5'] },
    { name: 'iPad (gen 7)', device: devices['iPad (gen 7)'] },
    { name: 'desktop-390x844', viewport: { width: 390, height: 844 } },
    { name: 'desktop-375x812', viewport: { width: 375, height: 812 } },
    { name: 'desktop-1024x768', viewport: { width: 1024, height: 768 } },
    { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  ];

  for (const cfg of configs) {
    console.log('Testing', cfg.name);
    const context = cfg.device ? await browser.newContext({ ...cfg.device }) : await browser.newContext({ viewport: cfg.viewport });
    const page = await context.newPage();
    try {
      await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const safeName = cfg.name.replace(/[ ()]/g, '_');
      const homePath = `${outDir}/home-${safeName}.png`;
      await page.screenshot({ path: homePath, fullPage: true });
      console.log('Saved', homePath);

      // Try create a room (fill username and click create) to capture lobby
      const hostName = `Host_${safeName}_${Date.now()}`;
      await page.evaluate((hn) => {
        const n = document.querySelector('#home-username'); if (n) n.value = hn;
        const btn = document.querySelector('#btn-create-room'); if (btn) btn.click();
      }, hostName);
      // wait for lobby UI to appear
      await page.waitForSelector('#lobby-code', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      const lobbyPath = `${outDir}/lobby-${safeName}.png`;
      await page.screenshot({ path: lobbyPath, fullPage: true });
      console.log('Saved', lobbyPath);
    } catch (err) {
      console.error('Error capturing', cfg.name, err.message);
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log('Screenshots complete');
  process.exit(0);
})();
