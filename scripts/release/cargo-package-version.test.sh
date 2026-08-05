#!/usr/bin/env bash
# release/cargo-package-version.test.sh — scripts/release/cargo-package-version.sh 회귀 스위트 (#2169).
#
# 네트워크를 타지 않는다. 입력은 아래에서 만드는 Cargo.toml 픽스처 4벌과
# 저장소의 실제 `src-tauri/Cargo.toml` 이다.
#
# 실행:
#   bash scripts/release/cargo-package-version.test.sh
#
# 배선: scripts/__tests__/cargo-package-version.test.ts 가 이 파일을 실행하고,
# 그 래퍼를 `vitest run` 이 집는다 (vite.config.ts 의 test.exclude 에 scripts/ 가
# 없다). CI 에서는 `Frontend Tests (shard N/3)` 잡이 그 명령을 돌린다. 이미 도는
# 러너에 붙인 것이라 워크플로를 안 건드렸다 — 아무도 안 돌리는 스위트는 red 가
# 될 수 없다. 확인:
#   pnpm exec vitest list | grep cargo-package-version
#
# 검사 대상은 셋이다:
#   ① 파싱 — 픽스처 4벌
#   ② 배선 — auto-tag-release.yml 의 태그 스텝이 이 스크립트로만 Cargo.toml 을
#      읽는가. 파싱만 맞고 워크플로가 자기 파싱을 따로 들고 있으면 ①은 통과한다.
#   ③ mutation — #2169 이전 형태를 실제로 만들어 이 스위트가 red 가 되는지,
#      그리고 어느 입력이 그 형태를 잡는지. 양성 대조(미변조 사본)가 green 인
#      것까지 확인한다.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 자기 경로. mutation 단계가 자신을 다시 부른다 — 리터럴로 박으면 파일을 옮겼을 때
# "미변조 사본이 red" 라는 엉뚱한 실패로 나타난다.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${BASH_SOURCE[0]##*/}"
SCRIPT="${CARGO_PACKAGE_VERSION_SCRIPT:-$ROOT/scripts/release/cargo-package-version.sh}"
# 배선 대상 워크플로. env 로 갈아끼울 수 있는 것은 ②의 RED 를 손으로 재현하기
# 위해서다. 기본값은 저장소의 진짜 파일이다.
WORKFLOW="${CARGO_PACKAGE_VERSION_WORKFLOW:-$ROOT/.github/workflows/auto-tag-release.yml}"

if [ ! -f "$SCRIPT" ]; then
	echo "FAIL: 대상 스크립트가 없다: $SCRIPT" >&2
	exit 1
fi

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

FIX_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cargo-package-version.XXXXXX")"
trap 'rm -rf "$FIX_DIR"' EXIT

# ── 픽스처 ───────────────────────────────────────────────────────────────
# ① 현재 형태. src-tauri/Cargo.toml:1-3 의 배치 그대로다.
cat >"$FIX_DIR/plain.toml" <<'TOML'
[package]
name = "table-view"
version = "0.7.0"
edition = "2021"
TOML

# ② `[workspace.package]` 의 version 이 `[package]` 것보다 위 (#2161 이 만들 수
#    있는 배치). 파일의 첫 `version` 줄을 잡는 파싱은 여기서 9.9.9 를 낸다.
cat >"$FIX_DIR/workspace-first.toml" <<'TOML'
[workspace]
members = ["table-view-core"]

[workspace.package]
version = "9.9.9"

[package]
name = "table-view"
version = "0.7.0"
edition = "2021"
TOML

# ③ 값 뒤에 따옴표 낀 주석. 행의 마지막 따옴표 문자열을 잡는 greedy 파싱은
#    여기서 9.9.9 를 낸다.
cat >"$FIX_DIR/quoted-comment.toml" <<'TOML'
[package]
name = "table-view"
version = "0.7.0" # 다음 릴리스에서 "9.9.9" 로 올린다
edition = "2021"
TOML

# ④ `[package]` 에 읽을 version 이 없는 형태 (#2161 이 workspace 상속으로 갈
#    때의 모습). 값을 지어내지 말고 멈춰야 한다.
cat >"$FIX_DIR/inherited.toml" <<'TOML'
[workspace.package]
version = "9.9.9"

[package]
name = "table-view"
version.workspace = true
TOML

OUT=""
RC=0
read_version() {
	OUT="$(bash "$SCRIPT" "$1" 2>&1)"
	RC=$?
}

assert_version() {
	local fixture="$1" want="$2" label="$3"
	read_version "$FIX_DIR/$fixture.toml"
	if [ "$RC" -ne 0 ]; then
		fail "$label" "rc=$RC
$OUT"
	elif [ "$OUT" = "$want" ]; then
		pass "$label"
	else
		fail "$label" "want: $want
got : $OUT"
	fi
}

assert_rc() {
	if [ "$RC" -eq "$1" ]; then
		pass "$2 (rc=$1)"
	else
		fail "$2: rc=$RC, 기대 $1" "$OUT"
	fi
}

assert_has() {
	if printf '%s\n' "$OUT" | grep -qF -- "$1"; then
		pass "$2"
	else
		fail "$2" "찾는 문자열: $1
$OUT"
	fi
}

echo "parse:"

assert_version plain "0.7.0" "① 현재 형태 — [package] 밑 version 하나"
assert_version workspace-first "0.7.0" "② [workspace.package] 가 위에 있어도 [package] 값을 잡는다"
assert_version quoted-comment "0.7.0" "③ 값 뒤 따옴표 낀 주석은 값이 아니다"

read_version "$FIX_DIR/inherited.toml"
assert_rc 1 "④ [package] 에 읽을 version 이 없으면 멈춘다"
assert_has "[package] 섹션에서 version 을 못 찾았다" "④ 못 찾은 이유를 에러로 찍는다"

read_version "$FIX_DIR/does-not-exist.toml"
assert_rc 1 "없는 manifest 는 빈 값이 아니라 실패다"

# 저장소의 진짜 manifest. 숫자를 박으면 다음 릴리스 bump 마다 낡으므로 형식만 본다.
read_version "$ROOT/src-tauri/Cargo.toml"
assert_rc 0 "저장소의 src-tauri/Cargo.toml 을 읽는다"
if printf '%s\n' "$OUT" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	pass "그 값이 X.Y.Z 다 (auto-tag-release.yml 이 요구하는 형식)"
else
	fail "저장소 manifest 의 값이 X.Y.Z 가 아니다" "$OUT"
fi

# ── 배선 — 워크플로가 이 스크립트로만 Cargo.toml 을 읽는가 ────────────────
# mutation 서브런에서는 끈다. 판정 대상이 변조된 스크립트이지 저장소의 워크플로가
# 아니라서다 — 켜 두면 워크플로가 바뀐 날 양성 대조와 변조본이 같은 이유로 red 가
# 되어 결과가 무의미해진다.
#
# RED 재현 2종. 둘 다 이 단계에서 red 가 나야 한다:
#   d="$(mktemp -d)"; git archive HEAD | tar -x -C "$d"
#   # (a) 스크립트 호출을 #2169 이전 파싱으로 되돌린다
#   perl -0pi -e "s|\Qbash scripts/release/cargo-package-version.sh src-tauri/Cargo.toml\E|grep -m1 '^version' src-tauri/Cargo.toml \| sed -E 's/.*\"([^\"]+)\".*/\\\\1/'|" \
#     "$d/.github/workflows/auto-tag-release.yml"
#   # (b) 스크립트는 부르되 다른 줄에서 manifest 를 또 읽는다
#   CARGO_PACKAGE_VERSION_WORKFLOW="$d/.github/workflows/auto-tag-release.yml" \
#     bash scripts/release/cargo-package-version.test.sh
#
# 스텝 본문은 10칸 이상 들여쓰기고, 다음 스텝의 `- name:` 앞에는 그 스텝의 주석이
# 먼저 올 수 있으므로 이름이 아니라 들여쓰기로 끊는다.
tag_step() {
	awk '/- name: Tag release if version bumped/{f=1}
	     f && /^[[:space:]]*run:/{g=1; next}
	     g && NF && substr($0, 1, 10) != "          " {exit}
	     g' "$WORKFLOW"
}

check_workflow_coupling() {
	[ "${CARGO_PACKAGE_VERSION_SKIP_COUPLING:-0}" = "1" ] && return 0

	echo "workflow coupling:"

	if [ ! -f "$WORKFLOW" ]; then
		fail "coupling: 워크플로가 없다: $WORKFLOW"
		return
	fi

	local step
	step="$(tag_step)"
	if [ -z "$step" ]; then
		fail "coupling: 'Tag release if version bumped' 스텝의 run: 블록을 못 찾았다" \
			"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 tag_step() 을 같이 고쳐라."
		return
	fi

	# ① 태그 스텝이 이 스크립트를 저장소의 manifest 로 부르는가.
	if printf '%s\n' "$step" | grep -qF 'bash scripts/release/cargo-package-version.sh src-tauri/Cargo.toml'; then
		pass "태그 스텝이 이 스크립트로 src-tauri/Cargo.toml 을 읽는다"
	else
		fail "coupling: 태그 스텝이 이 스크립트를 안 부른다" \
			"이 스위트가 green 이어도 워크플로가 자기 파싱을 들고 있으면 릴리스는 그 파싱으로 돈다.
현재 스텝:
$step"
	fi

	# ② 그 스텝의 다른 줄이 manifest 를 따로 읽지 않는가. ①만으로는 호출을
	#    남긴 채 값을 다른 줄에서 덮어쓰는 편집을 못 잡는다. 주석은 뺀다.
	local stray
	stray="$(printf '%s\n' "$step" | grep -v '^[[:space:]]*#' | grep -F 'src-tauri/Cargo.toml' | grep -vF 'cargo-package-version.sh')"
	if [ -z "$stray" ]; then
		pass "태그 스텝에 manifest 를 따로 읽는 줄이 없다"
	else
		fail "coupling: 태그 스텝이 src-tauri/Cargo.toml 을 스크립트 밖에서도 읽는다" \
			"$stray"
	fi
}
check_workflow_coupling

# ── mutation — 이 스위트가 실제로 잡는지 ─────────────────────────────────
if [ "${CARGO_PACKAGE_VERSION_SKIP_MUTATION:-0}" != "1" ]; then
	echo "mutation:"

	MUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cargo-package-version-mut.XXXXXX")"
	trap 'rm -rf "$FIX_DIR" "$MUT_DIR"' EXIT

	# #2169 이전 형태 그대로. manifest 경로만 인자로 받는다.
	cat >"$MUT_DIR/old-form.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
grep -m1 '^version' "${1:?}" | sed -E 's/.*"([^"]+)".*/\1/'
SH

	# 아래 단언들이 물릴 변조본. env 로 갈아끼우면 임의의 변조본에 같은 단언을
	# 물릴 수 있다 — "이 단언이 실제로 fail 할 수 있나" 를 반례로 확인하는 용도다.
	# 반례 둘, 각각 아래 mutant_* 단언이 fail 이어야 한다:
	#   # ① null mutation — 고친 스크립트 자신. 변조가 아니므로 아무 입력도 못 잡는다
	#   CARGO_PACKAGE_VERSION_MUTANT="$PWD/scripts/release/cargo-package-version.sh" \
	#     bash scripts/release/cargo-package-version.test.sh
	#   # ② 완전 fail-closed — 무엇을 받아도 멈춘다. 값을 지어내지 않으므로
	#   #    "멈춰야 하는 입력" 은 이것을 구별하지 못한다
	#   m="$(mktemp)"; printf '#!/usr/bin/env bash\nexit 1\n' >"$m"
	#   CARGO_PACKAGE_VERSION_MUTANT="$m" bash scripts/release/cargo-package-version.test.sh
	MUTANT="${CARGO_PACKAGE_VERSION_MUTANT:-$MUT_DIR/old-form.sh}"
	MUT_NAME="${MUTANT##*/}"

	# 서브런 출력. 버리면 양성 대조가 red 일 때 어느 단언이 깨졌는지가 사라진다.
	SUB_OUT=""
	run_suite_against() {
		SUB_OUT="$(CARGO_PACKAGE_VERSION_SCRIPT="$1" CARGO_PACKAGE_VERSION_SKIP_MUTATION=1 \
			CARGO_PACKAGE_VERSION_SKIP_COUPLING=1 bash "$SELF" 2>&1)"
	}

	# 양성 대조. 이게 red 면 아래 변조본의 red 는 아무것도 증명하지 못한다.
	cp "$SCRIPT" "$MUT_DIR/control.sh"
	if diff -q "$SCRIPT" "$MUT_DIR/control.sh" >/dev/null 2>&1; then
		if run_suite_against "$MUT_DIR/control.sh"; then
			pass "positive control: 미변조 사본은 green"
		else
			fail "positive control: 미변조 사본이 red — harness 가 깨졌다" "$SUB_OUT"
		fi
	else
		fail "positive control: 사본이 원본과 다르다"
	fi

	# 스위트 전체. 변조본을 물리면 red 여야 한다.
	if run_suite_against "$MUTANT"; then
		fail "mutation[$MUT_NAME]: 변조본이 green — 이 스위트가 그 변조를 못 잡는다" "$SUB_OUT"
	else
		pass "mutation[$MUT_NAME]: 변조본을 물리면 스위트가 red"
	fi

	# 어느 입력이 잡는지. "스위트가 red" 만으로는 이슈가 지정한 입력 ②③ 이 각각
	# 잡는다는 것을 증명하지 못한다.
	#
	# rc 와 출력을 **한 문자열로 합치지 않는다.** 합치면 `rc=N` 같은 기대 리터럴이
	# 실제 문자열과 바이트 동일해질 수 없어(빈 출력이면 후행 공백, stderr 를 캡처하면
	# 에러 문구가 붙는다) 단언의 한쪽 가지가 영영 안 도는 죽은 코드가 된다 —
	# PR #2172 라운드 1 blocking 이 그것이었다. 비교는 rc 와 출력을 따로 본다.
	MUT_RC=0
	MUT_OUT=""
	mutant_run() {
		MUT_OUT="$(bash "$MUTANT" "$FIX_DIR/$1.toml" 2>&1)"
		MUT_RC=$?
	}

	# 값을 내야 하는 입력. 변조본이 정답 값을 그대로 내면 이 입력은 그 변조를
	# 구별하지 못한다.
	mutant_differs() {
		local fixture="$1" want="$2"
		mutant_run "$fixture"
		if [ "$MUT_RC" -eq 0 ] && [ "$MUT_OUT" = "$want" ]; then
			fail "mutation[$fixture]: 변조본도 $want 을 낸다 — 이 입력은 그 변조를 못 잡는다"
		else
			pass "mutation[$fixture]: 변조본은 rc=$MUT_RC '$(printf '%s' "$MUT_OUT" | head -1 | cut -c1-40)' 을 내 이 단언이 RED (기대 $want)"
		fi
	}

	# 멈춰야 하는 입력. 변조본이 값을 지어내면(rc 0) 구별된다. 같이 멈추는 변조본은
	# 이 입력으로 구별되지 않으므로 fail 이다 — 라운드 1 에 죽어 있던 가지가 여기다.
	mutant_invents_value() {
		local fixture="$1"
		mutant_run "$fixture"
		if [ "$MUT_RC" -eq 0 ]; then
			pass "mutation[$fixture]: 변조본은 rc=0 으로 '$MUT_OUT' 을 지어내 이 단언이 RED (정답은 실패)"
		else
			fail "mutation[$fixture]: 변조본도 rc=$MUT_RC 로 멈춘다 — 이 입력은 그 변조를 못 잡는다"
		fi
	}

	mutant_differs workspace-first "0.7.0"
	mutant_differs quoted-comment "0.7.0"
	mutant_invents_value inherited

	# 왜 지금까지 안 터졌나 — 현재 배치에서는 옛 형태도 맞는 값을 낸다. 이 한 줄이
	# 위 세 줄을 "회귀 재현" 으로 만든다 (전부 틀리는 파서면 아무 입력이나 잡는다).
	mutant_run plain
	if [ "$MUT_RC" -eq 0 ] && [ "$MUT_OUT" = "0.7.0" ]; then
		pass "mutation[plain]: 현재 배치에서는 변조본도 0.7.0 — 결함이 red 가 아니라 green 이던 이유"
	else
		fail "mutation[plain]: 변조본이 현재 배치에서 0.7.0 을 못 낸다 (rc=$MUT_RC) — 재현본이 옛 형태가 아니다"
	fi
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
