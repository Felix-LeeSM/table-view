#!/usr/bin/env bash
# Validate .agents SKILL.md frontmatter and reject brain-specific skill copies.

set -euo pipefail

pnpm exec tsx scripts/checks/skill-metadata.ts
