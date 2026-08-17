PR checklist and next steps

1. Create draft PR
   - Open: https://github.com/Girishnag18/doodl-game/pull/new/feat/e2e-tests-and-docs
   - Paste contents of PR_BODY.md into the PR description and mark it as Draft.

2. Let CI run
   - On PR creation GitHub Actions will run the workflow .github/workflows/ci.yml
   - Wait for both 'unit-tests' and 'e2e-playwright' jobs to complete; re-run failed jobs if necessary.

3. Manual QA
   - Clone branch locally or pull the branch and run tests locally:
     - Unit tests: cd server && node src/tests/unit/room_tests.js
     - Deterministic E2E: node tools/e2e/playwright/runner.js (requires Playwright installed)
     - Responsive screenshots: node tools/e2e/playwright/responsive_screenshots.js
   - Review screenshots in tools/e2e/screenshots/ for layout issues.

4. Device testing
   - For exact iOS Safari verification use BrowserStack or a physical device. If you want, provide BrowserStack credentials and I'll prepare a script.

5. Finalize
   - Address any CI or review feedback.
   - Merge when green and perform a staging deployment for broader QA.

If you want me to open the draft PR automatically I'll need GH auth in this environment (GH_TOKEN or gh auth login). After PR is open I can monitor CI and fix any failures.
