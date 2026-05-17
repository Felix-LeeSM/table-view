#!/usr/bin/env bash
# Index 자동 생성.
#
# `memory/**/memory.md` frontmatter (yq 또는 awk) 의
#   - `task:` (작업 의도 키워드, 콤마 분리)
#   - `surface:` (코드 영역 / 모듈, 콤마 분리)
# 필드를 읽어 `memory/index/by-task.md` + `memory/index/by-surface.md` 재생성.
#
# 룰: docs/sprints/sprint-386/contract.md AC-08.
# 자동 호출: PostToolUse(Edit|Write memory/**).

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 1

INDEX_DIR="memory/index"
BY_TASK="$INDEX_DIR/by-task.md"
BY_SURFACE="$INDEX_DIR/by-surface.md"

mkdir -p "$INDEX_DIR"

# Awk 가 frontmatter 의 task / surface 필드 + 첫 # 헤더 + path 추출.
# 각 메모리 파일 한 줄: <task_csv>|<surface_csv>|<path>|<title>
extract() {
  find memory -name "memory.md" \
    -not -path "memory/index/*" \
    | sort \
    | while read -r f; do
        awk -v file="$f" '
          BEGIN { in_fm=0; fm_seen=0; task=""; surface=""; title="" }
          /^---$/ {
            if (in_fm) { in_fm=0; next }
            if (!fm_seen) { in_fm=1; fm_seen=1; next }
          }
          in_fm && /^task:/ { sub(/^task:[ ]*/, ""); task=$0; next }
          in_fm && /^surface:/ { sub(/^surface:[ ]*/, ""); surface=$0; next }
          !in_fm && /^# / && title=="" {
            sub(/^# /, ""); title=$0
          }
          END {
            if (task != "" || surface != "") {
              print task "|" surface "|" file "|" title
            }
          }
        ' "$f"
      done
}

# By-task 인덱스 생성
{
  cat <<EOF
---
title: By-task 인덱스
type: index
generated: $(date +%Y-%m-%d)
generator: scripts/regenerate-indexes.sh
---

# By-task 인덱스

작업 의도 키워드 → 관련 룰/방. 자동 생성 — 직접 편집 금지. 메모리 frontmatter 의 \`task:\` 필드를 input 으로 한다.

수동 추가 또는 task 필드 누락된 룰은 본 인덱스에 빠질 수 있음 — \`/remember\` skill 로 frontmatter 갱신 시 자동 등록됨.

## 작업 → 룰 / 방 매핑

EOF

  # Task 키워드 별로 묶음
  extract | awk -F'|' '
    {
      task=$1; surface=$2; path=$3; title=$4
      if (task == "") next
      # task 가 콤마 분리면 각각 키 등록
      n = split(task, arr, /,[ ]*/)
      for (i=1; i<=n; i++) {
        k = arr[i]
        gsub(/^[ ]+|[ ]+$/, "", k)
        if (k == "") continue
        entries[k] = entries[k] "- [" title "](../../" path ")\n"
      }
    }
    END {
      # Task 키 sort
      n = 0
      for (k in entries) keys[++n] = k
      # 간단 sort
      for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) if (keys[i] > keys[j]) { t=keys[i]; keys[i]=keys[j]; keys[j]=t }
      for (i=1; i<=n; i++) {
        print "### " keys[i]
        print ""
        printf "%s", entries[keys[i]]
        print ""
      }
    }
  '
} > "$BY_TASK"

# By-surface 인덱스 생성
{
  cat <<EOF
---
title: By-surface 인덱스
type: index
generated: $(date +%Y-%m-%d)
generator: scripts/regenerate-indexes.sh
---

# By-surface 인덱스

코드 surface (모듈 / 디렉토리) → 관련 ADR/lesson/convention. 자동 생성 — 직접 편집 금지. 메모리 frontmatter 의 \`surface:\` 필드를 input 으로 한다.

## Surface → 룰 매핑

EOF

  extract | awk -F'|' '
    {
      task=$1; surface=$2; path=$3; title=$4
      if (surface == "") next
      n = split(surface, arr, /,[ ]*/)
      for (i=1; i<=n; i++) {
        k = arr[i]
        gsub(/^[ ]+|[ ]+$/, "", k)
        if (k == "") continue
        entries[k] = entries[k] "- [" title "](../../" path ")\n"
      }
    }
    END {
      n = 0
      for (k in entries) keys[++n] = k
      for (i=1; i<=n; i++) for (j=i+1; j<=n; j++) if (keys[i] > keys[j]) { t=keys[i]; keys[i]=keys[j]; keys[j]=t }
      for (i=1; i<=n; i++) {
        print "### `" keys[i] "`"
        print ""
        printf "%s", entries[keys[i]]
        print ""
      }
    }
  '
} > "$BY_SURFACE"

# Stat 출력
TASK_LINES=$(wc -l < "$BY_TASK" | tr -d ' ')
SURFACE_LINES=$(wc -l < "$BY_SURFACE" | tr -d ' ')
echo "[regenerate-indexes] by-task.md ($TASK_LINES lines), by-surface.md ($SURFACE_LINES lines)"

exit 0
