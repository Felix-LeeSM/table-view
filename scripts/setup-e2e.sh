#!/usr/bin/env bash
# Local E2E test environment setup guide.
#
# E2E tests run against the native Tauri window via tauri-driver.
# They are designed for CI (GitHub Actions ubuntu-latest) but can
# also run locally with the right dependencies.
#
# Usage:
#   ./scripts/setup-e2e.sh          # prints instructions
#   xvfb-run pnpm test:e2e          # run after installing deps

set -euo pipefail

echo "=== E2E Test Environment Setup ==="
echo ""
echo "Required system packages (Debian/Ubuntu):"
echo "  sudo apt install -y webkit2gtk-driver xvfb libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev"
echo ""
echo "Required Rust tool:"
echo "  cargo install tauri-driver --locked"
echo ""
echo "Required test database:"
echo "  docker compose -f docker-compose.test.yml up -d"
echo ""
echo "Run E2E tests:"
echo "  xvfb-run pnpm test:e2e"
echo ""
echo "Note: CI runs these automatically on every push."
