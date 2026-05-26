#!/usr/bin/env bash
# Validate SKILL.md frontmatter and runtime wrapper source links.

set -euo pipefail

pnpm exec tsx scripts/checks/skill-metadata.ts
