#!/usr/bin/env bash
# God file 인지 hook. PostToolUse(Edit|Write) 에서 자동 호출.
#
# 룰: memory/engineering/conventions/refactoring/god-file/memory.md
# 임계: 700 lines (≥). 초과 시 stderr 경고 + 룰 path 출력.
#
# 입력: stdin JSON (`tool_input.file_path`).
# 출력: 위반 시 stderr 만, 통과 시 nothing.
# Exit: 항상 0 — 경고만, hook chain 중단 X.
#
# 직접 호출 (테스트):
#   echo '{"tool_input":{"file_path":"/tmp/foo.ts"}}' | bash scripts/hooks/check-god-file.sh

set -u

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

# Source 파일만 검사 — test / fixture / generated / vendored 는 제외.
case "$FILE" in
  *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx) exit 0 ;;
  */node_modules/* | */target/* | */dist/* | */coverage/*) exit 0 ;;
  */fixtures/* | */__tests__/* | */__mocks__/*) exit 0 ;;
  *.d.ts | *.snap) exit 0 ;;
esac

# .ts / .tsx / .rs 만 검사. 다른 확장자는 god file 임계 적용 X.
case "$FILE" in
  *.ts | *.tsx | *.rs) ;;
  *) exit 0 ;;
esac

LINE_COUNT=$(wc -l < "$FILE" | tr -d ' ')
THRESHOLD=700

if [ "$LINE_COUNT" -ge "$THRESHOLD" ]; then
  REL_FILE="${FILE#"$CLAUDE_PROJECT_DIR/"}"
  cat >&2 <<EOF
⚠️  god file ($LINE_COUNT lines ≥ $THRESHOLD): $REL_FILE
   룰: memory/engineering/conventions/refactoring/god-file/memory.md
   시퀀스: 주석 단순화 → memory 이관 → 그래도 크면 리팩토링 (5+ commit)
EOF
fi

exit 0
