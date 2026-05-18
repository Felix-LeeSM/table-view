#!/usr/bin/env bash
# review/run-checks.sh
# sprint contract.md 의 "Required Checks" 섹션 numbered list 파싱 → 백틱 안의
# 명령 batch 실행 → PASS/FAIL list 출력. evaluator agent / 사용자가 호출.
#
# 사용:
#   bash scripts/review/run-checks.sh <sprint-number>
#
# 출력 형식:
#   ✓ <command>
#   ✗ <command>
#       <stderr 마지막 5줄>
# 마지막 1줄: SUMMARY: <pass>/<total> PASS

set -uo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ -z "${1:-}" ]; then
	cat <<EOF
review/run-checks.sh — sprint contract Required Checks batch

사용:
  bash scripts/review/run-checks.sh <sprint-number>

동작:
  - docs/sprints/sprint-<N>/contract.md 의 '### Required Checks' 섹션 numbered
    list 파싱
  - 각 항목의 백틱 안 명령 (\` ... \`) 추출 + bash 로 실행
  - PASS/FAIL list 출력

관련: memory/workflow/review/memory.md
EOF
	exit 0
fi

sprint="$1"
contract="docs/sprints/sprint-${sprint}/contract.md"

if [ ! -f "$contract" ]; then
	echo "ERROR: $contract 없음" >&2
	exit 1
fi

# "### Required Checks" 섹션 추출 (다음 "###" / "##" 시작 전까지)
section="$(awk '
	/^### Required Checks/ { f = 1; next }
	f && /^##/ { exit }
	f { print }
' "$contract")"

if [ -z "$section" ]; then
	echo "ERROR: contract 에 '### Required Checks' 섹션 없음" >&2
	exit 1
fi

total=0
pass=0
failures=()

# numbered list 의 각 줄에서 첫 백틱 명령 추출
while IFS= read -r line; do
	# 숫자. 로 시작하는 줄만
	echo "$line" | grep -qE '^[0-9]+\.' || continue

	# 첫 백틱 ... 백틱 추출
	cmd="$(echo "$line" | grep -oE '`[^`]+`' | head -1 | sed 's/^`//; s/`$//')"
	[ -z "$cmd" ] && continue

	total=$((total + 1))
	# 명령 실행 (subshell, stderr 캡쳐)
	tmp_err="$(mktemp)"
	if eval "$cmd" >/dev/null 2>"$tmp_err"; then
		echo "✓ $cmd"
		pass=$((pass + 1))
	else
		echo "✗ $cmd"
		tail -5 "$tmp_err" | sed 's/^/    /'
		failures+=("$cmd")
	fi
	rm -f "$tmp_err"
done <<< "$section"

echo ""
echo "SUMMARY: ${pass}/${total} PASS"

if [ "$pass" -lt "$total" ]; then
	exit 1
fi
exit 0
