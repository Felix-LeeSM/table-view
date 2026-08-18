#!/usr/bin/env bash
# release/update-homebrew-cask.test.sh — scripts/release/update-homebrew-cask.sh
# 회귀 스위트 (#2454).
#
# 네트워크를 타지 않는다. 입력은 아래에서 만드는 cask 픽스처와 저장소의 실제
# `.github/workflows/release.yml` 이다.
#
# 실행:
#   bash scripts/release/update-homebrew-cask.test.sh
#
# 배선: scripts/__tests__/update-homebrew-cask.test.ts 가 이 파일을 실행하고, 그
# 래퍼를 `vitest run` 이 집는다 (vite.config.ts 의 test.exclude 에 scripts/ 가
# 없다). CI 에서는 `Frontend Tests (shard N/3)` 잡이 그 명령을 돌린다. 이미 도는
# 러너에 붙인 것이라 워크플로를 안 건드렸다 — 아무도 안 돌리는 스위트는 red 가
# 될 수 없다. 옆 스위트 scripts/release/cargo-package-version.test.sh 와 같은
# 형태다. 확인:
#   pnpm exec vitest list | grep update-homebrew-cask
#
# 검사 대상은 셋이다:
#   1. 치환 — cask 픽스처. 두 값 줄만 바뀌고 `livecheck` · `caveats` · `url` 의
#      `#{version}` 보간은 그대로 남는가
#   2. 거부 — 형태가 어긋난 cask 와 값에서 멈추는가. 여기서 조용히 통과하면 job 은
#      green 인데 tap 은 옛 버전으로 남는다 (#2207 이 `Upload SHA256 checksums`
#      에서 낸 것과 같은 형태)
#   3. 배선 — release.yml 이 실제로 이 스크립트를 부르는가. 1·2 만 맞고 워크플로가
#      안 부르면 tap 은 여전히 손으로 고쳐야 한다
#
# mutation 은 하나다. `version` 줄이 둘인 cask 를 잡는 것은 개수 검사뿐이다 —
# 쓰고 나서 다시 읽는 검사는 두 줄 다 새 값으로 바뀌므로 통과한다. 그 검사를
# 지운 사본이 rc=0 을 내는지, 미변조 사본이 같은 입력에 rc=1 을 내는지 같이 본다.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${UPDATE_HOMEBREW_CASK_SCRIPT:-$ROOT/scripts/release/update-homebrew-cask.sh}"
RELEASE_WORKFLOW="${UPDATE_HOMEBREW_CASK_RELEASE_WORKFLOW:-$ROOT/.github/workflows/release.yml}"

for f in "$SCRIPT" "$RELEASE_WORKFLOW"; do
	if [ ! -f "$f" ]; then
		echo "FAIL: 대상 파일이 없다: $f" >&2
		exit 1
	fi
done

# 실제 v0.7.1 릴리스의 값이다. `Table.View_0.7.1_aarch64.dmg` 의 asset digest 를
# 그대로 옮긴 것이고, tap 의 `Casks/table-view.rb` 가 손으로 그 값을 담고 있다.
#   gh release view v0.7.1 --repo Felix-LeeSM/table-view --json assets
NEW_VERSION="0.7.1"
NEW_SHA="fd20e2497625aaee00e81237235f7f98ab5e46774e757f1fdc813c3ff225e8ee"

total=0
fails=0

pass() {
	total=$((total + 1))
	echo "  ok   $1"
}

fail() {
	total=$((total + 1))
	fails=$((fails + 1))
	echo "  FAIL $1" >&2
	if [ -n "${2:-}" ]; then
		printf '%s\n' "$2" | sed 's/^/         /' >&2
	fi
}

FIX_DIR="$(mktemp -d "${TMPDIR:-/tmp}/update-homebrew-cask.XXXXXX")"
trap 'rm -rf "$FIX_DIR"' EXIT

# ── 픽스처 ───────────────────────────────────────────────────────────────
# tap `Felix-LeeSM/homebrew-table-view` 의 `Casks/table-view.rb` 배치 그대로에,
# 값만 갱신 전 상태로 되돌린 것이다 (tap PR #9 로 들어간 `livecheck` 와 `caveats`
# 포함). 저 파일을 픽스처로 복사해 두지 않는 이유: 다른 저장소의 파일이라 여기
# 사본이 낡아도 알려 주는 것이 없다. 이 스위트가 지키는 것은 그 저장소의 현재
# 내용이 아니라 **형태**다.
write_cask() {
	cat >"$1" <<'RUBY'
cask "table-view" do
  version "0.4.1"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/Felix-LeeSM/table-view/releases/download/v#{version}/Table.View_#{version}_aarch64.dmg"
  name "Table View"
  desc "Table View for MongoDB and SQL databases."
  homepage "https://github.com/Felix-LeeSM/table-view"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64

  app "Table View.app"

  caveats <<~EOS
    Table View is signed ad-hoc, not with a Developer ID certificate, so
    Gatekeeper refuses the first launch with "the app is damaged".

    Install with the quarantine attribute skipped:
      brew install --cask --no-quarantine table-view
  EOS
end
RUBY
}

# ── 1. 치환 ──────────────────────────────────────────────────────────────
echo "substitution:"

CASK="$FIX_DIR/table-view.rb"
BEFORE="$FIX_DIR/before.rb"
write_cask "$CASK"
cp "$CASK" "$BEFORE"

OUT="$(bash "$SCRIPT" "$CASK" "$NEW_VERSION" "$NEW_SHA" 2>&1)"
RC=$?
if [ "$RC" -eq 0 ]; then
	pass "정상 cask 에 rc=0"
else
	fail "정상 cask 에 rc=0" "rc=$RC / $OUT"
fi

# 바뀐 줄이 정확히 둘이라는 것이 `livecheck` · `caveats` · `depends_on` · `app`
# 보존의 증명이다 — 이름을 하나씩 세면 목록에 없는 줄이 사라져도 통과한다.
CHANGED_OUT="$(diff "$BEFORE" "$CASK")"
REMOVED="$(printf '%s\n' "$CHANGED_OUT" | grep -c '^< ')"
ADDED="$(printf '%s\n' "$CHANGED_OUT" | grep -c '^> ')"
if [ "$REMOVED" = "2" ] && [ "$ADDED" = "2" ]; then
	pass "바뀐 줄이 정확히 둘이다 (나머지 블록 전부 보존)"
else
	fail "바뀐 줄이 정확히 둘이다 (나머지 블록 전부 보존)" "지운 줄 $REMOVED / 더한 줄 $ADDED
$CHANGED_OUT"
fi

if grep -qxF "  version \"$NEW_VERSION\"" "$CASK"; then
	pass "version 줄이 새 값이다"
else
	fail "version 줄이 새 값이다" "$(grep -n 'version' "$CASK")"
fi

if grep -qxF "  sha256 \"$NEW_SHA\"" "$CASK"; then
	pass "sha256 줄이 새 값이다"
else
	fail "sha256 줄이 새 값이다" "$(grep -n 'sha256' "$CASK")"
fi

# `url` 줄은 값 안에 `version` 이라는 낱말을 담는다. 줄 전체를 보지 않는 패턴은
# 이 줄을 잡아 URL 을 통째로 버전 문자열로 바꾼다.
if grep -qF 'v#{version}/Table.View_#{version}_aarch64.dmg' "$CASK"; then
	pass "url 의 #{version} 보간이 안 깨진다"
else
	fail "url 의 #{version} 보간이 안 깨진다" "$(grep -n 'url ' "$CASK")"
fi

# `$CASK` 는 한 번, `$AGAIN` 은 두 번 돌린 결과다. 둘을 대조해야 "두 번째 실행이
# 아무것도 안 바꾼다" 가 증명된다 — 양쪽 다 두 번 돌리면 서로 같은 것이 당연해서
# 어떤 값이 들어가도 통과한다.
AGAIN="$FIX_DIR/again.rb"
write_cask "$AGAIN"
bash "$SCRIPT" "$AGAIN" "$NEW_VERSION" "$NEW_SHA" >/dev/null 2>&1
bash "$SCRIPT" "$AGAIN" "$NEW_VERSION" "$NEW_SHA" >/dev/null 2>&1
if cmp -s "$CASK" "$AGAIN"; then
	pass "멱등 — 두 번 돌려도 바이트 동일"
else
	fail "멱등 — 두 번 돌려도 바이트 동일" "$(diff "$CASK" "$AGAIN")"
fi

# ── 2. 거부 ──────────────────────────────────────────────────────────────
echo ""
echo "refusal:"

# 인자를 그대로 넘겨 rc 와 "파일이 안 바뀌었는가" 를 같이 본다. 멈췄다고 보고하면서
# 반쯤 고쳐 놓는 것이 tap 에 밀리면 원래 상태보다 나쁘다.
refuses() {
	local label="$1" cask_body="$2" ver="$3" sum="$4"
	local target="$FIX_DIR/refuse.rb" snapshot="$FIX_DIR/refuse.before.rb"
	if [ "$cask_body" = "MISSING" ]; then
		rm -f "$target"
		local out rc
		out="$(bash "$SCRIPT" "$target" "$ver" "$sum" 2>&1)"
		rc=$?
		if [ "$rc" -ne 0 ]; then
			pass "$label"
		else
			fail "$label" "rc=$rc / $out"
		fi
		return
	fi
	printf '%s' "$cask_body" >"$target"
	cp "$target" "$snapshot"
	local out rc
	out="$(bash "$SCRIPT" "$target" "$ver" "$sum" 2>&1)"
	rc=$?
	if [ "$rc" -eq 0 ]; then
		fail "$label" "rc=0 으로 통과했다 / $out"
	elif ! cmp -s "$target" "$snapshot"; then
		fail "$label" "rc=$rc 인데 파일이 바뀌었다:
$(diff "$snapshot" "$target")"
	else
		pass "$label"
	fi
}

VALID_CASK="$(cat "$BEFORE")"
NO_VERSION="$(printf '%s\n' "$VALID_CASK" | grep -v '^  version ')"
TWO_VERSION="$(printf '%s\n' "$VALID_CASK" | sed 's/^  version "0.4.1"$/  version "0.4.1"\
  version "9.9.9"/')"
NO_SHA="$(printf '%s\n' "$VALID_CASK" | grep -v '^  sha256 ')"

refuses "version 줄이 없으면 거부" "$NO_VERSION" "$NEW_VERSION" "$NEW_SHA"
refuses "version 줄이 둘이면 거부" "$TWO_VERSION" "$NEW_VERSION" "$NEW_SHA"
refuses "sha256 줄이 없으면 거부" "$NO_SHA" "$NEW_VERSION" "$NEW_SHA"
refuses "태그 그대로인 version(v0.7.1) 거부" "$VALID_CASK" "v$NEW_VERSION" "$NEW_SHA"
refuses "자리가 모자란 version(0.7) 거부" "$VALID_CASK" "0.7" "$NEW_SHA"
refuses "sha256: 접두사가 붙은 checksum 거부" "$VALID_CASK" "$NEW_VERSION" "sha256:$NEW_SHA"
refuses "63자 checksum 거부" "$VALID_CASK" "$NEW_VERSION" "${NEW_SHA%?}"
refuses "대문자 checksum 거부" "$VALID_CASK" "$NEW_VERSION" "$(printf '%s' "$NEW_SHA" | tr 'a-f' 'A-F')"
refuses "없는 파일 거부" "MISSING" "$NEW_VERSION" "$NEW_SHA"

# ── 3. 배선 ──────────────────────────────────────────────────────────────
echo ""
echo "wiring:"

# 주석 줄은 안 센다 — 진짜 호출을 지우고 이력 주석만 남긴 편집이 통과하면 이
# 단언이 지키는 것이 없다 (scripts/check-ci-test-calls.sh 와 같은 사유).
CALL_LINES="$(grep -n 'scripts/release/update-homebrew-cask\.sh' "$RELEASE_WORKFLOW" |
	grep -vE '^[0-9]+:[[:space:]]*#')"
if [ -n "$CALL_LINES" ]; then
	pass "release.yml 의 주석 아닌 줄이 이 스크립트를 부른다"
else
	fail "release.yml 의 주석 아닌 줄이 이 스크립트를 부른다" \
		"안 부르면 tap 은 여전히 손으로 고쳐야 한다 (#2454)"
fi

if grep -qE '^[[:space:]]+TAP_TOKEN:[[:space:]]+\$\{\{[[:space:]]*secrets\.HOMEBREW_TAP_TOKEN[[:space:]]*\}\}' "$RELEASE_WORKFLOW"; then
	pass "그 스텝이 HOMEBREW_TAP_TOKEN 을 받는다"
else
	fail "그 스텝이 HOMEBREW_TAP_TOKEN 을 받는다" "$(grep -n 'TAP_TOKEN' "$RELEASE_WORKFLOW")"
fi

# 트리거가 tag push 로 바뀌면 maintainer 가 draft 를 검토하기 전에 tap 이 먼저
# 움직인다 — 취소된 릴리스의 버전이 사용자에게 나간다.
if grep -qE "^[[:space:]]+if: github\.event_name == 'release' && github\.event\.release\.prerelease == false$" "$RELEASE_WORKFLOW"; then
	pass "tap job 이 published 이고 prerelease 가 아닐 때만 돈다"
else
	fail "tap job 이 published 이고 prerelease 가 아닐 때만 돈다" \
		"$(grep -n 'event_name' "$RELEASE_WORKFLOW")"
fi

# ── mutation ─────────────────────────────────────────────────────────────
if [ -z "${UPDATE_HOMEBREW_CASK_SKIP_MUTATION:-}" ]; then
	echo ""
	echo "mutation:"

	MUT="$FIX_DIR/mutated.sh"
	# 개수 검사 루프를 통째로 지운다. 지우는 대상이 실제로 있었는지 먼저 본다 —
	# 못 찾은 채 "변조본이 rc=0" 을 보고하면 그건 변조가 아니라 원본의 판정이다.
	COUNT_LOOP='for key in version sha256; do'
	if grep -qF "$COUNT_LOOP" "$SCRIPT"; then
		awk -v marker="$COUNT_LOOP" '
			index($0, marker) { skip = 1 }
			skip && /^done$/ { skip = 0; next }
			!skip { print }
		' "$SCRIPT" >"$MUT"

		if grep -qF "$COUNT_LOOP" "$MUT"; then
			fail "mutation[count-check-dropped]: 변조가 실제로 지웠다" "루프가 사본에 남아 있다"
		else
			pass "mutation[count-check-dropped]: 변조가 실제로 지웠다"
		fi

		MUT_TARGET="$FIX_DIR/mutation.rb"
		printf '%s' "$TWO_VERSION" >"$MUT_TARGET"
		bash "$MUT" "$MUT_TARGET" "$NEW_VERSION" "$NEW_SHA" >/dev/null 2>&1
		MUT_RC=$?
		if [ "$MUT_RC" -eq 0 ]; then
			pass "mutation[count-check-dropped]: 개수 검사를 지우면 version 줄 둘짜리가 조용히 통과한다"
		else
			fail "mutation[count-check-dropped]: 개수 검사를 지우면 version 줄 둘짜리가 조용히 통과한다" \
				"rc=$MUT_RC — 다른 검사가 이미 잡고 있다면 이 mutation 은 개수 검사를 증명하지 못한다"
		fi

		# 양성 대조. 같은 입력에 미변조본이 red 여야 위 rc=0 이 변조의 효과다.
		printf '%s' "$TWO_VERSION" >"$MUT_TARGET"
		bash "$SCRIPT" "$MUT_TARGET" "$NEW_VERSION" "$NEW_SHA" >/dev/null 2>&1
		PLAIN_RC=$?
		if [ "$PLAIN_RC" -ne 0 ]; then
			pass "mutation[count-check-dropped] 양성 대조: 미변조본은 같은 입력에 red"
		else
			fail "mutation[count-check-dropped] 양성 대조: 미변조본은 같은 입력에 red" "rc=$PLAIN_RC"
		fi
	else
		fail "mutation[count-check-dropped]: 변조 대상이 스크립트에 있다" \
			"'$COUNT_LOOP' 을 못 찾았다 — 스크립트가 바뀌었으면 이 변조도 같이 고쳐라"
	fi
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
