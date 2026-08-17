Title: feat: premium multiplayer upgrade — server authority, custom words, word-choice (4/5), maxPlayers (2–20), UI polish, tests & CI

Description:

This branch implements a large, focused upgrade to Doodl to make it a premium, server-authoritative multiplayer drawing-and-guessing game while preserving existing functionality.

Summary of changes:
- Server-side settings validation (maxPlayers 2–20, wordChoiceCount 4–5, customWords cap 1000) and centralized sanitizeSettings.
- Custom word bank support: add/remove/clear/import, dedupe, trim, per-word length validation, server-side enforcement.
- Word source modes: official, custom, mixed; fair word selection, usedWords tracking, and auto-select fallback when drawer times out.
- Enforced room capacity on the server and spectator handling via RoomManager.joinRoom.
- Drawer selection validation: server validates the drawer's selected word was one of the server-provided choices.
- UI redesign: premium design system, home/lobby/game/results redesign, word-choice overlay, toasts, modals, improved mobile responsiveness.
- Drawing toolbar and player cards polish; preserves existing drawing features and WebRTC voice chat.
- Tests and CI: added Room unit tests and deterministic Playwright E2E helpers + CI workflow (.github/workflows/ci.yml).
- Repo hygiene: removed tracked server/node_modules and updated .gitignore.
- Tools: E2E runner, responsive and game/results screenshots under tools/e2e/screenshots.

Notes for reviewers:
- Branch: feat/e2e-tests-and-docs
- Key files to review:
  - server/src/game/Room.js (word selection, validation)
  - server/src/socket/gameSocket.js (sanitization, event handlers)
  - server/src/game/RoomManager.js (join logic, capacity enforcement)
  - client/index.html, client/src/styles.css, client/src/main.js (UI redesign and wiring)
  - server/src/tests/unit/room_tests.js (unit tests)
  - tools/e2e/playwright/* (deterministic E2E helpers and runners)
- Run unit tests: cd server && node src/tests/unit/room_tests.js
- Run deterministic E2E locally: node tools/e2e/playwright/runner.js (Playwright and Chromium required).
- Screenshots and captures saved under tools/e2e/screenshots/ for quick visual QA.

CI behaviour:
- The workflow runs unit-tests and a headless Playwright deterministic E2E.
- If CI E2E fails due to timing in a hosted runner, please allow a retry — the runner is deterministic but low-resource runners can need slightly higher timeouts.

Security notes:
- All game-critical rules are server-authoritative. Do not rely on client-side validation.

If you want me to create the draft PR here, provide GH auth (GH_TOKEN or run gh auth in this environment). Otherwise paste this Title + Description into GitHub UI at:
https://github.com/Girishnag18/doodl-game/pull/new/feat/e2e-tests-and-docs

Checklist before merge:
- [ ] CI unit-tests pass
- [ ] CI E2E deterministic run passes
- [ ] Manual smoke test: start room, join 2 players, start game, ensure word choice, guess flow, round transition
- [ ] Responsive validation on iPhone/Android/desktop (screenshots attached under tools/e2e/screenshots)
- [ ] Confirm no node_modules committed
- [ ] Optional: run 20-player stress test and review logs

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
