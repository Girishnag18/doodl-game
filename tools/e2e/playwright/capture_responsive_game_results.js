const { chromium, devices } = require('playwright');
const run = require('./multi_round');
const fs = require('fs');

(async () => {
  const outDir = './tools/e2e/screenshots';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const configs = [
    { name: 'iPhone SE', device: devices['iPhone SE'] },
    { name: 'iPhone 12', device: devices['iPhone 12'] },
    { name: 'Pixel 5', device: devices['Pixel 5'] },
    { name: 'iPad (gen 7)', device: devices['iPad (gen 7)'] },
    { name: 'desktop-375x812', viewport: { width: 375, height: 812 } },
    { name: 'desktop-390x844', viewport: { width: 390, height: 844 } },
    { name: 'desktop-1024x768', viewport: { width: 1024, height: 768 } },
  ];

  const browser = await chromium.launch({ headless: true });

  for (const cfg of configs) {
    console.log('Running game capture for', cfg.name);
    const context = cfg.device ? await browser.newContext({ ...cfg.device }) : await browser.newContext({ viewport: cfg.viewport });
    const page = await context.newPage();
    const safeName = cfg.name.replace(/[ ()]/g, '_');
    const prefix = `${outDir}/${safeName}`;
    try {
      const res = await run(page, { bots: 3, rounds: 2, screenshotPrefix: prefix });
      console.log('Run result for', cfg.name, res);
    } catch (err) {
      console.error('Error running for', cfg.name, err.message);
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log('All captures complete');
  process.exit(0);
})();
