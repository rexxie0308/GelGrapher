#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs the test runner (Playwright, the only
# dev dependency) so `npm test`, `npm run check` and `npm run build` work right away.
# Cloud images ship Chromium for Playwright under $PLAYWRIGHT_BROWSERS_PATH, so no browser download.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
# npm install (not ci): the container is cached after this hook, and install reuses node_modules
npm install --no-audit --no-fund
