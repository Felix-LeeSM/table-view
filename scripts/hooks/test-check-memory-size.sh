#!/usr/bin/env bash
# Smoke tests for scripts/hooks/check-memory-size.sh (복합 게이트: lines + chars).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/hooks/check-memory-size.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/memory-size-test.XXXXXX")"
TMP2=""
trap 'rm -rf "$TMP_DIR" "$TMP2"' EXIT

# per_line_chars × lines 인 파일 생성 (마지막 개행 포함).
gen_file() {
	local chars="$1" lines="$2" file="$3" line i
	line="$(printf 'x%.0s' $(seq 1 "$chars"))"
	for ((i = 0; i < lines; i++)); do printf '%s\n' "$line"; done >"$file"
}

assert_contains() {
	local text="$1" needle="$2" label="$3"
	if ! grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		echo "$text" >&2
		exit 1
	fi
}
assert_not_contains() {
	local text="$1" needle="$2" label="$3"
	if grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: unexpected '$needle'" >&2
		echo "$text" >&2
		exit 1
	fi
}

mkdir -p "$TMP_DIR/memory/char_only" "$TMP_DIR/memory/line_only" "$TMP_DIR/memory/both" "$TMP_DIR/memory/ok"
gen_file 86 150 "$TMP_DIR/memory/char_only/memory.md"   # 줄<200, ~13050 chars → chars 위반만
gen_file 19 250 "$TMP_DIR/memory/line_only/memory.md"   # 줄>200, ~5000 chars → 줄 위반만
gen_file 51 250 "$TMP_DIR/memory/both/memory.md"        # 둘 다 (~13000 chars)
gen_file 29 100 "$TMP_DIR/memory/ok/memory.md"          # 정상

out="$(cd "$TMP_DIR" && bash "$CHECK")"

char_line="$(grep "char_only" <<<"$out")"
line_line="$(grep "line_only" <<<"$out")"
both_line="$(grep "/both/" <<<"$out")"

assert_contains "$char_line" "13050 chars > 12000" "char-only: chars 위반"
assert_not_contains "$char_line" "lines >" "char-only: 줄 위반이 표시되면 안 됨"
assert_contains "$line_line" "250 lines > 200" "line-only: 줄 위반"
assert_not_contains "$line_line" "chars >" "line-only: chars 위반이 표시되면 안 됨"
assert_contains "$both_line" "250 lines > 200 / 13000 chars > 12000" "both: 둘 다 표시"
assert_not_contains "$out" "ok/memory.md" "정상 파일은 경고에 없어야"

# 위반 존재 시 --strict exit 1
if (cd "$TMP_DIR" && bash "$CHECK" --strict) >/dev/null 2>&1; then
	echo "FAIL: 위반 존재 시 --strict exit 1 이어야" >&2
	exit 1
fi

# 정상 only: 경고 없음 + --strict exit 0
TMP2="$(mktemp -d "${TMPDIR:-/tmp}/memory-size-test2.XXXXXX")"
mkdir -p "$TMP2/memory/ok"
gen_file 29 100 "$TMP2/memory/ok/memory.md"
out2="$(cd "$TMP2" && bash "$CHECK")"
[ -z "$out2" ] || { echo "FAIL: 정상인데 경고 출력: $out2" >&2; exit 1; }
if ! (cd "$TMP2" && bash "$CHECK" --strict) >/dev/null 2>&1; then
	echo "FAIL: 정상 파일 --strict 시 exit 0 이어야" >&2
	exit 1
fi

echo "PASS: memory size 복합 게이트 smoke check"
