Test and E2E guide

Unit tests:
- A small set of unit tests for core Room behavior is available at:
  server/src/tests/unit/room_tests.js

Run locally:
  cd server
  node src/tests/unit/room_tests.js

Playwright E2E helper:
- A Playwright helper script (tools/e2e/playwright/multi_round.js) is included to run a deterministic multi-round session (host + N bots). It assumes you have Playwright and a browser environment set up.

Example (developer machine):
- Install Playwright: `npm i -D playwright` or follow Playwright docs
- Run a node script that imports the helper and launches a browser context, e.g.:

  const { chromium } = require('playwright');
  const run = require('./tools/e2e/playwright/multi_round');
  (async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    const result = await run(page, { bots: 4, rounds: 3 });
    console.log(result);
    await browser.close();
  })();

Notes:
- The helper script does not bundle Playwright as a dependency; add Playwright to your devDependencies if you want CI to run it.
- The helper is deterministic: it selects the first shown word choice and instructs bot pages to submit that exact word so rounds complete reliably.

Stress testing recommendation:
- Use the Playwright helper to spawn many pages (20+) and verify room capacity and rate-limiting behaviour.
- For automated CI, prefer a headless run and limit concurrency to avoid resource exhaustion.
