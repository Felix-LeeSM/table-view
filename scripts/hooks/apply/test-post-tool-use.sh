#!/usr/bin/env bash
# post-tool-use.sh 의 경로 추출 검증 — 특히 Bash 명령이 쓴 파일을 잡는지.
#
# Bash 로 쓴 파일은 hook JSON 에 file_path 가 없어서 이 디스패처가 아무것도
# 하지 않고 종료했다. `sed -i`, `> file`, `git mv` 로 바뀐 파일이 포매터도
# 어드바이저리도 타지 않았다. fallback 은 명령을 파싱하지 않고 git 에게 묻는다.

set -uo pipefail

# See policy/test-check-main-worktree-source-edit.sh: git's hook env (GIT_DIR and
# friends) overrides `git -C`, so a fixture repo created below would be operated
# on the OUTER repository instead. Cut the inheritance here so the suite is
# correct however it is invoked.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars) 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/post-tool-use.sh"

PASS=0
FAIL=0
ok() {
	PASS=$((PASS + 1))
	printf 'PASS  %s\n' "$1"
}
no() {
	FAIL=$((FAIL + 1))
	printf 'FAIL  %s\n  %s\n' "$1" "$2"
}

FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT

git init -q "$FIX"
git -C "$FIX" config user.email t@e.x
git -C "$FIX" config user.name t
git -C "$FIX" config commit.gpgsign false
mkdir -p "$FIX/docs" "$FIX/src"
printf 'seed\n' > "$FIX/README.md"
git -C "$FIX" add -A
git -C "$FIX" commit -q -m seed

# 디스패처는 advisory 를 stdout 으로 낸다. 여기서는 "어떤 경로를 골랐나" 만
# 보면 되므로, ROOT 를 픽스처로 고정하고 doc-size advisory 헤더 유무로 판정한다.
run_hook() { # <json>
	printf '%s' "$1" | CLAUDE_PROJECT_DIR="$FIX" bash "$HOOK" 2>&1
}

# ── Bash 명령이 방금 쓴 파일을 집는다 ────────────────────────────────────────
printf 'a new doc\n' > "$FIX/docs/fresh.md"
out="$(run_hook '{"tool_name":"Bash","tool_input":{"command":"printf x > docs/fresh.md"}}')"
if [ -n "$out" ]; then
	ok "Bash: 방금 쓴 파일을 잡아 advisory 를 낸다"
else
	no "Bash: 방금 쓴 파일을 잡아 advisory 를 낸다" "출력 없음"
fi

# ── 쓰기 힌트가 없는 명령은 git 을 아예 묻지 않는다 (review #1860) ───────────
# mtime 창은 "언제"만 좁힌다. 창 안에서 사람이 손으로 고친 파일이 있으면 읽기
# 전용 명령 뒤에도 포매터가 그 파일을 다시 쓴다. 인과를 못 보는 것이 문제라
# "이 명령이 쓸 수 있는 형태인가"로 한 겹 더 좁힌다.
out="$(run_hook '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}')"
if [ -z "$out" ]; then
	ok "읽기 전용 명령(ls)은 dirty 파일을 건드리지 않는다"
else
	no "읽기 전용 명령(ls)은 dirty 파일을 건드리지 않는다" "출력=[$out]"
fi
out="$(run_hook '{"tool_name":"Bash","tool_input":{"command":"git log --oneline | head"}}')"
if [ -z "$out" ]; then
	ok "읽기 전용 파이프라인도 건드리지 않는다"
else
	no "읽기 전용 파이프라인도 건드리지 않는다" "출력=[$out]"
fi

# ── 오래된 dirty 파일은 이 명령의 결과가 아니다 ──────────────────────────────
printf 'stale\n' > "$FIX/docs/stale.md"
touch -t 202001010000 "$FIX/docs/stale.md"
rm -f "$FIX/docs/fresh.md"
out="$(run_hook '{"tool_name":"Bash","tool_input":{"command":"echo unrelated"}}')"
if [ -z "$out" ]; then
	ok "Bash: mtime 창 밖의 dirty 파일은 건드리지 않는다"
else
	no "Bash: mtime 창 밖의 dirty 파일은 건드리지 않는다" "출력=[$out]"
fi

# ── 명령이 없으면 fallback 자체가 돌지 않는다 ────────────────────────────────
printf 'fresh again\n' > "$FIX/docs/fresh2.md"
out="$(run_hook '{"tool_name":"Read","tool_input":{}}')"
if [ -z "$out" ]; then
	ok "명령도 경로도 없으면 아무것도 하지 않는다"
else
	no "명령도 경로도 없으면 아무것도 하지 않는다" "출력=[$out]"
fi

# ── file_path 가 있으면 그것이 우선이고 git 은 묻지 않는다 ───────────────────
out="$(run_hook "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$FIX/docs/fresh2.md\"}}")"
if [ -n "$out" ]; then
	ok "file_path 가 있으면 그 경로로 동작한다"
else
	no "file_path 가 있으면 그 경로로 동작한다" "출력 없음"
fi

# ── rename 은 오른쪽(도착지)이 쓰인 경로다 ───────────────────────────────────
git -C "$FIX" add -A >/dev/null 2>&1
git -C "$FIX" commit -q -m two
git -C "$FIX" mv docs/fresh2.md docs/renamed.md
touch "$FIX/docs/renamed.md"
out="$(run_hook '{"tool_name":"Bash","tool_input":{"command":"git mv docs/fresh2.md docs/renamed.md"}}')"
if [ -n "$out" ]; then
	ok "rename 은 도착 경로를 대상으로 삼는다"
else
	no "rename 은 도착 경로를 대상으로 삼는다" "출력 없음"
fi

printf '\n==== post-tool-use dispatcher summary ====\nPASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
