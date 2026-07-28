#!/usr/bin/env bash
# surface-rules.sh 의 glob 매칭 + 인덱스 파싱 검증.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./surface-rules.sh
source "$SCRIPT_DIR/surface-rules.sh"

PASS=0
FAIL=0
FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT

INDEX="$FIX/by-surface.md"
cat > "$INDEX" <<'EOF'
---
title: By-surface 인덱스
---

# By-surface 인덱스

산문 줄은 무시된다.

## Surface → 룰 매핑

### `**/*.ts`

- [모든 TS](../../memory/all-ts/memory.md)

### `src/lib/**`

- [Lib 전용](../../memory/lib/memory.md)
- [모든 TS](../../memory/all-ts/memory.md)

### `src/types/dataSource*`

- [Data Source](../../memory/ds/memory.md)

### `src-tauri/**/*.rs`

- [Rust](../../memory/rust/memory.md)

## 다른 섹션

- [여기 링크는 surface 룰이 아니다](../../memory/nope/memory.md)
EOF

expect() { # <name> <path> <expected-csv-of-links>
	local name="$1" p="$2" want="$3" got
	got="$(surface_rules_for_path "$p" "$INDEX" | cut -f2 | sort -u | paste -sd, -)"
	if [ "$got" = "$want" ]; then
		PASS=$((PASS + 1))
		printf 'PASS  %s\n' "$name"
	else
		FAIL=$((FAIL + 1))
		printf 'FAIL  %s\n  want: [%s]\n  got : [%s]\n' "$name" "$want" "$got"
	fi
}

expect "**/*.ts 는 중첩 경로에 매칭" "src/a/b.ts" "memory/all-ts/memory.md"
expect "src/lib/** 와 **/*.ts 가 함께 매칭" "src/lib/sql/x.ts" \
	"memory/all-ts/memory.md,memory/lib/memory.md"
expect "** 는 / 를 가로지른다" "src/lib/deep/nested/y.ts" \
	"memory/all-ts/memory.md,memory/lib/memory.md"
expect "접미 glob (dataSource*)" "src/types/dataSourceKind.ts" \
	"memory/all-ts/memory.md,memory/ds/memory.md"
expect "확장자가 다르면 TS 룰이 안 붙는다" "src-tauri/src/db/x.rs" "memory/rust/memory.md"
expect "매칭 없는 경로는 빈 결과" "README.md" ""
# `## 다른 섹션` 아래 링크는 surface 섹션이 아니므로 어떤 경로에도 붙지 않는다.
expect "surface 섹션 밖 링크는 새지 않는다" "nope/x.ts" "memory/all-ts/memory.md"
expect "빈 경로는 조용히 빈 결과" "" ""

# 인덱스 파일 부재
got="$(surface_rules_for_path "src/a.ts" "$FIX/missing.md")"
if [ -z "$got" ]; then
	PASS=$((PASS + 1))
	printf 'PASS  %s\n' "인덱스 파일이 없으면 실패하지 않는다"
else
	FAIL=$((FAIL + 1))
	printf 'FAIL  %s\n' "인덱스 파일이 없으면 실패하지 않는다"
fi

# 실제 레포 인덱스로 스모크: 형식이 바뀌면 여기서 깨진다.
REPO_INDEX="$SCRIPT_DIR/../../../memory/index/by-surface.md"
if [ -f "$REPO_INDEX" ]; then
	got="$(surface_rules_for_path "src-tauri/src/db/postgres/mutations.rs" "$REPO_INDEX" | wc -l | tr -d ' ')"
	if [ "$got" -ge 3 ]; then
		PASS=$((PASS + 1))
		printf 'PASS  %s (%s개)\n' "실제 by-surface.md 에서 rust 경로가 룰을 얻는다" "$got"
	else
		FAIL=$((FAIL + 1))
		printf 'FAIL  %s — %s개만 나옴 (인덱스 형식 변경?)\n' "실제 by-surface.md 에서 rust 경로가 룰을 얻는다" "$got"
	fi
fi

printf '\n==== surface-rules analyzer summary ====\nPASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
