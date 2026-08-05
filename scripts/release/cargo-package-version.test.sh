#!/usr/bin/env bash
# release/cargo-package-version.test.sh — scripts/release/cargo-package-version.sh 회귀 스위트 (#2169).
#
# 네트워크를 타지 않는다. 입력은 아래에서 만드는 manifest 픽스처와
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
#   ① 파싱 — manifest 픽스처
#   ② 배선 — auto-tag-release.yml 의 태그 스텝이 이 스크립트를 부르는가, 그리고 그
#      스텝이 커밋된 기대본과 바이트 동일한가. 파싱만 맞고 워크플로가 이 스크립트를
#      안 부르면 ①은 통과한다.
#   ③ mutation — #2169 이전 형태를 실제로 만들어 이 스위트가 red 가 되는지,
#      그리고 어느 입력이 그 형태를 잡는지. 워크플로를 갈아끼우는 변조도 같이
#      돌린다. 양성 대조(미변조 사본)가 green 인 것까지 확인한다.
#
# ②의 핀 범위 — 넓히지도 줄이지도 말고 이대로 읽어라:
#   안: 태그 스텝의 `- name:` 줄부터 그 스텝의 마지막 줄까지. `if:` 같은 스텝 키와
#       `run:` 키 줄(`|` 인지 `>` 인지 포함), 그리고 블록 본문이 전부 들어간다.
#       그 이름이 워크플로에 두 번 나와도 red 다 — 같은 이름의 스텝을 앞에 심어
#       캡처를 가로채는 편집을 막는다.
#   밖: 그 스텝 앞의 줄 전부(다른 스텝 · job 키 · `on:` 트리거)와 다음 스텝부터.
#       예를 들어 앞 스텝이 `src-tauri/Cargo.toml` 을 미리 고쳐 두는 편집은 이 핀이
#       못 잡는다. 태그 스텝 자체가 바뀌지 않기 때문이다.
#
# 「스텝의 어떤 줄도 스크립트 밖에서 manifest 를 읽지 않는다」는 단언은 여기 없다.
# 반례 공간이 가능한 모든 shell 줄이라 닫는 명령이 없는 열린 집합 주장이었고, 세
# 라운드에 걸쳐 우회·거짓 양성·거짓 음성이 번갈아 나왔다 (#2172). ②의 바이트 비교가
# 그 자리를 대신한다 (#2175) — 임의의 줄을 분류하지 않고 위 범위를 통째로 대조하므로,
# 통과하는 캡처는 픽스처와 같은 한 벌뿐이다.
#
# 대신 태그 스텝을 정당하게 고치면 픽스처도 같이 갱신해야 한다. 그것이 이 가드의
# 목적이다 — 릴리스 태그를 만드는 스텝의 편집을 사람이 한 번 보게 만든다. 갱신
# 명령은 실패 메시지가 그대로 찍는다 (`--print-tag-step`).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 자기 경로. mutation 단계가 자신을 다시 부른다 — 리터럴로 박으면 파일을 옮겼을 때
# "미변조 사본이 red" 라는 엉뚱한 실패로 나타난다.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${BASH_SOURCE[0]##*/}"
SCRIPT="${CARGO_PACKAGE_VERSION_SCRIPT:-$ROOT/scripts/release/cargo-package-version.sh}"
# 배선 대상 워크플로. env 로 갈아끼우는 것은 아래 mutation 단계가 워크플로 변조본을
# 이 스위트에 물리기 위해서다. 기본값은 저장소의 진짜 파일이다.
WORKFLOW="${CARGO_PACKAGE_VERSION_WORKFLOW:-$ROOT/.github/workflows/auto-tag-release.yml}"
# 태그 스텝의 기대본. ②의 바이트 비교가 이 파일과 대조한다.
TAG_STEP_FIXTURE="$ROOT/scripts/release/fixtures/auto-tag-release-tag-step.txt"
# 캡처 시작점. 추출기와 중복 검사가 같은 리터럴을 써야 "한 스텝만 캡처했다" 가
# 검사 가능한 문장이 된다.
TAG_STEP_ANCHOR="- name: Tag release if version bumped"
# 픽스처 갱신 명령과 두 실패 라벨. 실패 메시지와 mutation 단계가 같은 문자열을
# 쓴다 — 손으로 두 번 적으면 파일을 옮기거나 문구를 고친 날 한쪽만 낡는다.
TAG_STEP_UPDATE_CMD="bash scripts/release/cargo-package-version.test.sh --print-tag-step > scripts/release/fixtures/auto-tag-release-tag-step.txt"
TAG_STEP_PIN_FAIL="coupling: 태그 스텝이 커밋된 기대본과 바이트로 다르다"
TAG_STEP_DUP_FAIL="coupling: 태그 스텝 이름이 워크플로에 한 번만 나오지 않는다"

if [ ! -f "$SCRIPT" ]; then
	echo "FAIL: 대상 스크립트가 없다: $SCRIPT" >&2
	exit 1
fi

# 태그 스텝 전체 — `- name:` 줄부터 스텝의 마지막 줄까지. 스텝의 첫 줄만 6칸이고
# 그 뒤 스텝에 속한 줄은 키(8칸)든 블록 본문(10칸)이든 8칸 이상이므로, 8칸 미만인
# 첫 비어있지 않은 줄에서 끊는다 — 다음 스텝의 `- name:` 도 그 앞에 붙는 주석도
# 6칸이라 같이 걸린다.
#
# 키 줄을 건너뛰는 규칙을 두지 않는다. `run:` 을 건너뛰던 판(#2175 첫 커밋)은
# `- name:` 과 `run:` 사이(`if:` 등)를 통째로 핀 밖에 뒀고, 첫 토큰이 `run:` 인
# 본문 줄도 캡처에서 지웠다. 이 판은 그 사이 줄을 전부 담는다.
#
# ②의 단언들과 `--print-tag-step` 이 이 추출기를 공유한다 — 갈라지면 픽스처를
# 갱신한 그다음 실행이 red 가 된다.
tag_step() {
	awk -v anchor="$TAG_STEP_ANCHOR" '
		!f && index($0, anchor) {f = 1; print; next}
		f && NF && substr($0, 1, 8) != "        " {exit}
		f' "$WORKFLOW"
}

# 픽스처 생성기. 단언 출력이 섞이지 않도록 스위트 본문보다 먼저 끝낸다. 추출이
# 비면 멈춘다 — 빈 픽스처를 커밋하면 빈 추출과 바이트 동일해져 ②가 영영 green 이다.
if [ "${1:-}" = "--print-tag-step" ]; then
	if [ -z "$(tag_step)" ]; then
		echo "FAIL: 태그 스텝을 못 찾았다: $WORKFLOW" >&2
		exit 1
	fi
	tag_step
	exit 0
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

# ── 배선 — 태그 스텝이 이 스크립트를 부르는가 + 스텝이 기대본과 바이트 동일한가 ──
# **스크립트** 변조 서브런에서는 끈다. 판정 대상이 변조된 스크립트이지 저장소의
# 워크플로가 아니라서다 — 켜 두면 워크플로가 바뀐 날 양성 대조와 변조본이 같은
# 이유로 red 가 되어 결과가 무의미해진다. 반대로 **워크플로** 변조 서브런에서는
# 켜 둔다. 거기서는 이 단계가 판정 대상이다.
#
# 이 단계의 RED 는 아래 mutation 의 "워크플로 변조" 가 실제로 돌린다 — 손으로
# 재현하는 절차를 주석에 적어 두면 그 사본만 낡는다.

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
		fail "coupling: 'Tag release if version bumped' 스텝을 못 찾았다" \
			"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 tag_step() 을 같이 고쳐라."
		return
	fi

	# 캡처가 한 스텝을 봤는가. 추출기는 앵커의 첫 등장부터 담으므로, 같은 이름을
	# 품은 스텝을 앞에 심으면 진짜 스텝은 안 읽힌다. 그 사본이 기대본과 바이트
	# 동일하면 아래 cmp 는 통과한다 — 그래서 개수를 따로 센다. 닫힌 검사다:
	# 앵커를 품은 줄이 정확히 하나거나 아니거나 둘 중 하나다.
	local anchors
	anchors="$(grep -cF -- "$TAG_STEP_ANCHOR" "$WORKFLOW")"
	if [ "$anchors" = "1" ]; then
		pass "태그 스텝 이름이 워크플로에 한 번 나온다 (캡처가 그 스텝을 봤다)"
	else
		fail "$TAG_STEP_DUP_FAIL" \
			"'$TAG_STEP_ANCHOR' 를 품은 줄이 $anchors 개다. 캡처는 첫 등장부터 담으므로
같은 이름의 스텝을 앞에 두면 진짜 태그 스텝이 판정 밖으로 나간다."
	fi

	# 태그 스텝이 이 스크립트를 저장소의 manifest 로 부르는가. 닫힌 검사다 —
	# 찾는 문자열 하나가 그 스텝에 있거나 없거나 둘 중 하나다.
	if printf '%s\n' "$step" | grep -qF 'bash scripts/release/cargo-package-version.sh src-tauri/Cargo.toml'; then
		pass "태그 스텝이 이 스크립트로 src-tauri/Cargo.toml 을 읽는다"
	else
		fail "coupling: 태그 스텝이 이 스크립트를 안 부른다" \
			"이 스위트가 green 이어도 워크플로가 자기 파싱을 들고 있으면 릴리스는 그 파싱으로 돈다.
현재 스텝:
$step"
	fi

	# 스텝 전체를 커밋된 기대본과 바이트로 대조한다 (#2175). 위 grep 은 호출 줄
	# 하나만 보므로, 그 줄을 남긴 채 밑에 옛 파싱을 한 줄 더하는 편집을 통과시킨다 —
	# 나중 대입이 이겨서 릴리스는 그 파싱으로 돈다. 그리고 `if: false` 한 줄이면
	# 스텝이 통째로 안 돌아 태그가 안 붙는데, 그 줄은 호출 줄을 건드리지 않는다.
	# 판정은 cmp 다: 통과하는 캡처는 픽스처와 같은 한 벌뿐이라 임의의 줄을 "읽기냐
	# 아니냐" 로 분류할 필요가 없다.
	if [ ! -f "$TAG_STEP_FIXTURE" ]; then
		fail "coupling: 기대본 픽스처가 없다: ${TAG_STEP_FIXTURE#"$ROOT/"}" \
			"만드는 법:
  $TAG_STEP_UPDATE_CMD"
		return
	fi

	tag_step >"$FIX_DIR/tag-step.actual"
	if cmp -s "$TAG_STEP_FIXTURE" "$FIX_DIR/tag-step.actual"; then
		pass "태그 스텝이 커밋된 기대본과 바이트 동일하다"
	else
		fail "$TAG_STEP_PIN_FAIL" \
			"$(diff -u -L expected -L actual "$TAG_STEP_FIXTURE" "$FIX_DIR/tag-step.actual")

바이트 비교라서 공백·주석만 바뀌어도 여기서 걸린다. 릴리스 태그를 만드는 스텝이
바뀌었다는 뜻이므로, 의도한 변경이면 픽스처를 갱신해 같은 커밋에 담아라:
  $TAG_STEP_UPDATE_CMD"
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

	# ── 워크플로 변조 — ②의 바이트 비교가 실제로 잡는지 ──────────────────────
	# 위 변조는 스크립트를 갈아끼웠다. 여기서는 워크플로를 갈아끼우고 배선 단계를
	# 켜 둔 채 이 스위트를 다시 돌린다.
	#
	# 변조는 **대상 파일의 실제 표기**로 만든다. PR #2172 에서 심었던 `cat … | tail -1`
	# 은 당시 필터가 정확히 잡는 모양이라, 필터가 잡는 한 모양으로 필터를 증명한
	# 셈이었다. 아래 것들은 그 워크플로에 실제로 있었거나(#2169 이전 파싱 줄) 사람이
	# 할 법한 편집이고, 뒤쪽 넷은 PR #2179 리뷰가 손으로 재현해 낸 구멍이다.
	echo "mutation (workflow):"

	# 변조들이 쓰는 앵커. 각각 워크플로에 한 번만 나온다 — 아니면 perl 이 죽는다.
	CALL_LINE='          cargo_version="$(bash scripts/release/cargo-package-version.sh src-tauri/Cargo.toml)"'
	NAME_LINE="      $TAG_STEP_ANCHOR"
	RUN_KEY_LINE="        run: |"
	# #2169 이전 파싱 줄 원문. 따옴표와 백슬래시가 그대로라 heredoc 으로 받는다.
	OLD_PARSE_LINE="$(cat <<'YML'
          cargo_version="$(grep -m1 '^version' src-tauri/Cargo.toml | sed -E 's/.*"([^"]+)".*/\1/')"
YML
	)"

	# 리터럴 치환. 정규식이 아니라 index/substr 이라 메타문자 이스케이프 문제가 없고,
	# 대상이 없거나 둘 이상이면 죽는다 — 조용한 no-op 이 불가능하다.
	write_workflow_mutant() {
		local dst="$1" old="$2" new="$3"
		perl -e '
			my ($src, $o, $n) = @ARGV;
			open my $fh, "<", $src or die "open: $!\n";
			local $/;
			my $t = <$fh>;
			close $fh;
			my $i = index($t, $o);
			die "MUTATION TARGET NOT FOUND\n" if $i < 0;
			die "MUTATION TARGET NOT UNIQUE\n" if index($t, $o, $i + length($o)) >= 0;
			substr($t, $i, length($o), $n);
			print $t;
		' "$WORKFLOW" "$old" "$new" >"$dst"
	}

	# 워크플로만 갈아끼운 서브런. 배선 단계는 켜 둔다 (판정 대상이 그것이다).
	# 대입문의 exit status 는 명령 치환의 것이라 전역이어야 한다 — 위 run_suite_against
	# 와 같은 이유다.
	run_suite_against_workflow() {
		SUB_OUT="$(CARGO_PACKAGE_VERSION_WORKFLOW="$1" CARGO_PACKAGE_VERSION_SKIP_MUTATION=1 \
			bash "$SELF" 2>&1)"
	}

	# 양성 대조. 미변조 사본이 red 면 아래 red 들은 아무것도 증명하지 못한다.
	# 실패 원인이 둘이라 메시지가 둘 다 적는다 — 태그 스텝을 고치고 픽스처를 안
	# 고치면 사본도 같은 이유로 red 라, 여기서 harness 탓만 하면 오진이다.
	cp "$WORKFLOW" "$MUT_DIR/workflow-control.yml"
	if run_suite_against_workflow "$MUT_DIR/workflow-control.yml"; then
		pass "positive control: 미변조 워크플로 사본은 green"
	else
		fail "positive control: 미변조 워크플로 사본이 red" \
			"위 배선 단계도 red 면 원인은 그것과 같다 — 저장소의 태그 스텝과 픽스처가 어긋났다.
배선 단계가 green 인데 여기만 red 면 harness(워크플로 갈아끼우기)가 깨진 것이다.
$SUB_OUT"
	fi

	# 인자: 이름 · 앵커 · 치환문 · 이 변조가 깨야 하는 단언의 라벨. "스위트가 red" 로
	# 끝내지 않고 **그 단언이** 낸 red 인지까지 본다 — 안 그러면 다른 단언이 깨져도
	# 통과로 읽힌다.
	workflow_mutation_case() {
		local name="$1" old="$2" new="$3" want="${4:-$TAG_STEP_PIN_FAIL}"
		local dst="$MUT_DIR/workflow-$name.yml"
		rm -f "$dst"
		if ! write_workflow_mutant "$dst" "$old" "$new"; then
			fail "mutation[$name]: 치환 실패 (대상 없음/중복)"
			return
		fi
		if cmp -s "$WORKFLOW" "$dst"; then
			fail "mutation[$name]: 변조본이 원본과 동일하다 — 치환이 no-op 이다"
			return
		fi
		if run_suite_against_workflow "$dst"; then
			fail "mutation[$name]: 변조본이 green — 배선 단계가 이 편집을 못 잡는다" "$SUB_OUT"
		elif printf '%s\n' "$SUB_OUT" | grep -qF "$want"; then
			pass "mutation[$name]: '$want' 가 red 를 낸다"
		else
			fail "mutation[$name]: 스위트는 red 인데 기대한 단언이 아니다 (기대: $want)" "$SUB_OUT"
		fi
	}

	# ① 호출 줄을 남기고 그 밑에 옛 파싱 줄을 더한다. 나중 대입이 이기므로 릴리스는
	#    옛 파싱으로 도는데, 호출 존재만 보는 grep 은 이걸 통과시킨다.
	workflow_mutation_case "old-parse-appended" "$CALL_LINE" "$CALL_LINE
$OLD_PARSE_LINE"
	# ② 호출을 지우고 인라인 파싱으로 되돌린다 (#2169 이전 상태).
	workflow_mutation_case "call-replaced-by-inline-parse" "$CALL_LINE" "$OLD_PARSE_LINE"
	# ③ 빈 줄 하나. 의미는 그대로지만 바이트 비교라 red 가 맞다 — 주석만 고친
	#    편집도 같은 류이고, 실패 메시지가 픽스처 갱신 명령을 찍는다.
	workflow_mutation_case "whitespace-only" "$CALL_LINE" "
$CALL_LINE"

	# 아래 넷은 PR #2179 리뷰가 손으로 재현한 구멍이다. 캡처를 `run:` 이 아니라
	# `- name:` 부터로 넓히고 이름 개수를 세는 것으로 닫혔다.
	#
	# ④ `if: false` 한 줄. 스텝이 통째로 안 돌아 태그가 안 붙고 release.yml 도 안
	#    뜨는데 본문은 한 글자도 안 바뀐다 — `run:` 부터 담던 판에서는 이 줄이 핀
	#    밖이라 스위트가 green 이었다.
	workflow_mutation_case "step-disabled-by-if-false" "$NAME_LINE" "$NAME_LINE
        if: false"
	# ⑤ 블록 스칼라를 접는 형(`>`)으로 바꾼다. 본문 줄은 그대로인데 셸이 받는
	#    스크립트가 달라진다. 앵커에 이름 줄을 붙이는 것은 `run: |` 이 이 파일에
	#    여러 번 나와서다 — 앵커가 중복이면 perl 이 죽는다.
	workflow_mutation_case "run-key-folded" "$NAME_LINE
$RUN_KEY_LINE" "$NAME_LINE
        run: >"
	# ⑥ 첫 토큰이 `run:` 인 본문 줄. `run:` 을 만나면 캡처를 다시 시작하던 판은 이
	#    줄을 캡처에서 지워, 픽스처와 실제 양쪽에서 안 보이게 만들었다.
	workflow_mutation_case "run-first-token-body-line" "$CALL_LINE" "$CALL_LINE
          run: echo body-line-starting-with-run"
	# ⑦ 같은 이름의 스텝을 앞에 심는다. 심는 내용이 픽스처 자신이라 캡처는 바이트
	#    동일해 cmp 가 통과한다 — 이름 개수를 세는 단언만 이걸 잡으므로 기대 라벨이
	#    다르다.
	workflow_mutation_case "duplicate-step-hijacks-capture" "$NAME_LINE" "$(cat "$TAG_STEP_FIXTURE")
$NAME_LINE" "$TAG_STEP_DUP_FAIL"
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
