#!/usr/bin/env bash
#
# sprint-375 (Phase 6 cleanup, 2026-05-17) — AC-375-01 / AC-375-02 grep CI.
#
# `src/lib/session-storage.ts` 는 `src/lib/scopedLocalStorage.ts` 로
# rename 되었다 (M-4 미스노머 정리). `from "@lib/session-storage"` 또는
# `@lib/session-storage` 같은 import path 가 다시 등장하면 본 script 가
# 즉시 fail — 사용자가 새 모듈명 (`scopedLocalStorage`) 으로 다시 갱신해야
# 한다.
#
# Scope: `src/` 트리만 검사한다 — `docs/` 안의 retire/migration 노트는
# 의도적으로 옛 이름을 docs-only 로 언급하므로 (`docs/sprints/sprint-375/contract.md`,
# `docs/state-management-strategy-2026-05-15.md` 등) 허용.
#
# Pattern: `@lib/session-storage` import path. doc-comment mentions of the
# old filename (예: "renamed from session-storage.ts") 는 허용. 진짜
# 잡고 싶은 회귀는 `from "@lib/session-storage"` 또는 `import("@lib/session-storage")`.
#
# Exit codes:
#   0 — clean (no session-storage import in src/).
#   1 — match found; prints offending lines.

set -euo pipefail

cd "$(dirname "$0")/.."

SEARCH_TOOL=""
if command -v rg >/dev/null 2>&1; then
  SEARCH_TOOL="rg"
elif command -v grep >/dev/null 2>&1; then
  SEARCH_TOOL="grep"
else
  echo "[check-no-session-storage-import.sh] need either ripgrep (rg) or grep" >&2
  exit 2
fi

# 검사 대상은 src/ 전체. docs/ / scripts/ 는 의도적 mention 허용 (이 script
# 자체 + sprint-375 contract 등).
TARGET_DIR="src"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "[check-no-session-storage-import.sh] no src/ to scan" >&2
  exit 0
fi

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  MATCHED=$(rg -n "@lib/session-storage" "$TARGET_DIR" || true)
else
  MATCHED=$(grep -rEn "@lib/session-storage" "$TARGET_DIR" || true)
fi

if [[ -n "$MATCHED" ]]; then
  printf '%s\n' "$MATCHED"
  echo
  echo "[check-no-session-storage-import.sh] FAIL — \`@lib/session-storage\` import" >&2
  echo "  detected in src/. The module was renamed in sprint-375; use" >&2
  echo "  \`@lib/scopedLocalStorage\` (camelCase) instead." >&2
  exit 1
fi

echo "[check-no-session-storage-import.sh] OK — src/ is free of @lib/session-storage imports."
