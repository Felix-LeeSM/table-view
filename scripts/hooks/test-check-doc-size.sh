#!/usr/bin/env bash
# Smoke tests for scripts/hooks/check-doc-size.sh (chars cap + 일회성 디렉토리 prune).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/hooks/check-doc-size.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/doc-size-test.XXXXXX")"
TMP2=""
trap 'rm -rf "$TMP_DIR" "$TMP2"' EXIT

# chars 개 x 로 채운 파일 생성 (개행 없음).
gen_big() {
	local n="$1" file="$2" remaining chunk
	: >"$file"
	chunk="$(printf 'x%.0s' $(seq 1 1000))"
	remaining="$n"
	while [ "$remaining" -gt 1000 ]; do
		printf '%s' "$chunk" >>"$file"
		remaining=$((remaining - 1000))
	done
	[ "$remaining" -gt 0 ] && printf '%s' "$(printf 'x%.0s' $(seq 1 "$remaining"))" >>"$file"
}

assert_contains() {
	local text="$1" needle="$2" label="$3"
	if ! grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		echo "$text" >&2
		exit 1
	fi
}

mkdir -p "$TMP_DIR/docs/product" \
	"$TMP_DIR/docs/sprints/sprint-x" "$TMP_DIR/docs/archives/a" \
	"$TMP_DIR/docs/table_plus" "$TMP_DIR/docs/explorations"

# product 위반 (121000 > 120000)
gen_big 121000 "$TMP_DIR/docs/product/big.md"
# 일회성 디렉토리 대용량 (300000 chars) — prune 되어야
for d in docs/sprints/sprint-x docs/archives/a docs/table_plus docs/explorations; do
	gen_big 300000 "$TMP_DIR/$d/huge.md"
done

out="$(cd "$TMP_DIR" && bash "$CHECK")"
assert_contains "$out" "docs/product/big.md" "product 위반 감지"
if grep -Eq "docs/(sprints|archives|table_plus|explorations)/" <<<"$out"; then
	echo "FAIL: 일회성 디렉토리가 경고에 누출됨" >&2
	echo "$out" >&2
	exit 1
fi
if (cd "$TMP_DIR" && bash "$CHECK" --strict) >/dev/null 2>&1; then
	echo "FAIL: 위반 존재 시 --strict exit 1 이어야" >&2
	exit 1
fi

# 정상 only: --strict exit 0
TMP2="$(mktemp -d "${TMPDIR:-/tmp}/doc-size-test2.XXXXXX")"
mkdir -p "$TMP2/docs/product"
gen_big 1000 "$TMP2/docs/product/ok.md"
if ! (cd "$TMP2" && bash "$CHECK" --strict) >/dev/null 2>&1; then
	echo "FAIL: 정상 파일 --strict 시 exit 0 이어야" >&2
	exit 1
fi

echo "PASS: doc size cap + prune smoke check"
