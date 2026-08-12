#!/usr/bin/env bash
# release/checksum-sidecars.test.sh — release.yml 의 `Upload SHA256 checksums`
# 스텝 회귀 스위트 (#2207).
#
# 네트워크를 타지 않는다. 대상은 저장소의 진짜 워크플로 파일이고, GitHub API 는
# PATH 앞에 놓는 `gh` 스텁이 가로챈다.
#
# 실행:
#   bash scripts/release/checksum-sidecars.test.sh
#
# 배선: scripts/__tests__/checksum-sidecars.test.ts 가 이 파일을 실행하고, 그
# 래퍼를 `vitest run` 이 집는다 (vite.config.ts 의 test.exclude 에 scripts/ 가
# 없다). CI 에서는 `Frontend Tests (shard N/3)` 잡이 그 명령을 돌린다. 이미 도는
# 러너에 붙인 것이라 워크플로를 안 건드렸다 — 아무도 안 돌리는 스위트는 red 가
# 될 수 없다. 확인:
#   pnpm exec vitest list | grep checksum-sidecars
#
# 형태는 옆 스텝의 스위트 scripts/release/verify-tag-ci.test.sh 를 그대로 따랐다
# (#2168) — `run:` 블록 추출 · 스텁 · 커밋된 픽스처 기반 mutation.
#
# ## 무엇을 막는가
#
# v0.7.0 · v0.7.1 은 Windows `.msi` / `.exe` 를 `.sha256` 없이 냈고 스텝은 green
# 이었다. tauri-action 이 Windows 러너에서 백슬래시 경로를 주는데 Git Bash 가 그
# 걸 stat 하지 못하고, 스텝 첫 줄이 `[ -f "$f" ] || continue` 였다. 실패가 조용히
# 통과로 강등되는 그 형태가 이 스위트의 판정 대상이다:
#
#   ① 해석 안 되는 항목은 red 다 (건너뛰기가 아니다)
#   ② 백슬래시 경로는 `cygpath -u` 를 지나 사이드카를 얻는다
#   ③ 항목이 0개거나 전부 건너뛰어졌으면 red 다
#   ④ 디렉토리 번들(macOS `.app`)만 건너뛰고, 건너뛴 사실을 로그에 남긴다
#   ⑤ mutation — 위를 무력화하는 편집을 실제로 만들어 red 가 나는지, 그리고 어느
#      단언이 그 red 를 내는지. 양성 대조(미변조 사본)도 같이 돈다
#
# 스텝 이름 존재 확인으로 끝내지 않는다. 워크플로에서 `run:` 블록을 그대로 뽑아
# **실행**한다 — grep 만으로는 "건너뛰고 exit 0 으로 나간다" 는 편집을 못 잡는다.
# 그래서 그 블록에는 `${{ }}` 를 두지 않는다 (아래 단언이 그것을 지킨다).
#
# ## Windows 러너를 여기서 돌리지 않는다
#
# 이 스위트는 macOS / Linux 에서 돈다. Git Bash 는 없다. ②의 재현은 **갈음**이다:
# 백슬래시 문자열은 어느 POSIX 셸에서도 stat 되지 않으므로 실패 조건 자체는
# 진짜이고(아래 `raw 백슬래시 경로는 stat 되지 않는다` 단언이 그것을 확인한다),
# 변환하는 쪽만 스텁 `cygpath` 로 세운다. 그 스텁은 진짜 `cygpath -u` 처럼
# `D:\a\x` 를 `/d/a/x` 로 바꾼 뒤, POSIX 파일시스템에 그 경로가 있을 수 없으므로
# `$CYGPATH_ROOT` 아래로 옮겨 붙인다. 진짜 Windows 러너에서 도는 것은 머지 뒤
# 릴리스 워크플로에서만 확인된다.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 자기 경로. mutation 단계가 변조본을 물려 자신을 다시 부른다 — 리터럴로 박으면
# 파일을 옮겼을 때 "미변조 사본이 red" 라는 엉뚱한 실패로 나타난다.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${BASH_SOURCE[0]##*/}"
# env 로 갈아끼울 수 있는 것은 mutation 단계가 변조본을 물리기 위해서다. 기본값은
# 저장소의 진짜 파일이다.
RELEASE_WORKFLOW="${CHECKSUM_SIDECARS_RELEASE_WORKFLOW:-$ROOT/.github/workflows/release.yml}"

STEP_NAME="Upload SHA256 checksums"

# 스텝의 기대본. mutation 단계가 이 파일과 바이트로 대조하고, 변조는 이 파일의
# 텍스트를 고쳐 만든다. 갱신 명령은 실패 메시지가 그대로 찍는다.
STEP_FIXTURE="$ROOT/scripts/release/fixtures/release-checksum-step.txt"
STEP_UPDATE_CMD="bash scripts/release/checksum-sidecars.test.sh --print-step > scripts/release/fixtures/release-checksum-step.txt"
STEP_PIN_FAIL="mutation: 체크섬 스텝이 커밋된 픽스처와 바이트로 다르다"

if [ ! -f "$RELEASE_WORKFLOW" ]; then
	echo "FAIL: 대상 파일이 없다: $RELEASE_WORKFLOW" >&2
	exit 1
fi

for tool in jq shasum; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "FAIL: 이 스위트는 '$tool' 을 쓴다 (스텝이 쓰는 도구다). 없으면 검사 불성립." >&2
		exit 1
	fi
done

# 스텝 블록은 `- name: …` 부터, 8칸보다 얕게 들여쓴 다음 비어 있지 않은 줄
# 직전까지다. ①의 단언 · 픽스처 생성기 · mutation 단계가 이 추출기를 공유한다 —
# 갈라지면 픽스처를 갱신한 그다음 실행이 red 가 된다.
step_block() {
	awk -v key="      - name: ${STEP_NAME}" '
		$0 == key {f = 1; print; next}
		f && NF && substr($0, 1, 8) != "        " {exit}
		f' "$RELEASE_WORKFLOW"
}

# `run: |` 줄을 빼고 본문만 낸다. 본문은 10칸 이상이고, 스텝을 끝내는 것은
# 그보다 얕은 첫 비어 있지 않은 줄(또는 EOF)이다.
run_block() {
	awk -v key="      - name: ${STEP_NAME}" '
		$0 == key {f = 1; next}
		f && /^[[:space:]]*run:/ {g = 1; next}
		g && NF && substr($0, 1, 10) != "          " {exit}
		g' "$RELEASE_WORKFLOW"
}

# 픽스처 생성기. 단언 출력이 섞이지 않도록 스위트 본문보다 먼저 끝낸다. 추출이
# 비면 멈춘다 — 빈 픽스처를 커밋하면 빈 추출과 바이트 동일해져 대조가 영영 green
# 이고, 변조의 치환 대상도 빈 문자열이 된다.
if [ "${1:-}" = "--print-step" ]; then
	if [ -z "$(step_block)" ]; then
		echo "FAIL: '${STEP_NAME}' 스텝을 못 찾았다: $RELEASE_WORKFLOW" >&2
		exit 1
	fi
	step_block
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

OUT=""
RC=0

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

# ── ① 스텝 구조 ─────────────────────────────────────────────────────────
# 라벨 변수들은 mutation 단계가 "그 단언이 낸 red 인지" 를 확인할 때 다시 쓴다.
# 손으로 두 번 적으면 문구를 고친 날 한쪽만 낡는다.
LBL_STEP_MISSING="release.yml 에 '${STEP_NAME}' 스텝이 없다"
LBL_ENV_ARTIFACT_PATHS="artifactPaths 가 env: 로 들어온다 (본문에 안 박힌다)"
LBL_NO_TEMPLATE_EXPR='run: 본문에 ${{ }} 가 없다 (추출해서 실행할 수 있다)'

echo "release.yml checksum step (#2207):"

STEP="$(step_block)"
if [ -z "$STEP" ]; then
	fail "$LBL_STEP_MISSING" \
		"번들에 체크섬을 붙이는 자리가 사라졌다. 이 스위트의 STEP_NAME 을 같이 고쳐라."
else
	pass "release.yml 에 '${STEP_NAME}' 스텝이 있다"
fi

OUT="$STEP"
assert_has "ARTIFACT_PATHS: " "$LBL_ENV_ARTIFACT_PATHS"

BODY="$(run_block)"
if [ -z "$BODY" ]; then
	fail "'${STEP_NAME}' 스텝의 run: 블록을 못 찾았다" \
		"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 run_block() 을 같이 고쳐라."
	echo ""
	echo "SUMMARY: $((total - fails))/$total PASS"
	exit 1
fi
pass "체크섬 스텝의 run: 블록을 뽑았다"

if printf '%s\n' "$BODY" | grep -qF '${{'; then
	fail "$LBL_NO_TEMPLATE_EXPR" \
		"러너가 먼저 치환해야 하는 식이 본문에 있으면 이 스위트에는 리터럴로 도착한다 — 아래 실행 단언이 전부 무의미해진다."
else
	pass "$LBL_NO_TEMPLATE_EXPR"
fi

# ── ② 스텁 ──────────────────────────────────────────────────────────────
TMP="$(mktemp -d "${TMPDIR:-/tmp}/checksum-sidecars.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

STUB_BIN="$TMP/bin"
mkdir -p "$STUB_BIN"

# 업로드된 파일 경로를 한 줄씩 $STUB_DIR/uploads 에 적는다. $STUB_DIR/rc 가 있으면
# 그 값으로 죽는다 — 업로드 실패가 스텝을 red 로 만드는지 보는 케이스가 쓴다.
cat >"$STUB_BIN/gh" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do
	case "$a" in *.sha256) printf '%s\n' "$a" >>"$STUB_DIR/uploads" ;; esac
done
exit "$(cat "$STUB_DIR/rc" 2>/dev/null || echo 0)"
STUB
chmod +x "$STUB_BIN/gh"

# 진짜 `cygpath -u` 의 갈음. `D:\a\x` → `/d/a/x` 까지는 진짜와 같고, POSIX
# 파일시스템에 그 경로를 만들 수 없으므로 $CYGPATH_ROOT 아래로 옮겨 붙인다.
# PATH 에 놓는 케이스에서만 존재한다 — 안 놓으면 스텝의 `command -v cygpath` 가
# 실패해 변환 없는 경로(= macOS/Linux 러너)가 된다.
cat >"$TMP/cygpath" <<'STUB'
#!/usr/bin/env bash
p="${2//\\//}"
case "$p" in
	[A-Za-z]:/*)
		drive="$(printf '%s' "${p%%:*}" | tr 'A-Z' 'a-z')"
		p="/$drive/${p#*:/}"
		;;
esac
printf '%s\n' "${CYGPATH_ROOT}${p}"
STUB
chmod +x "$TMP/cygpath"

# `bash -e -o pipefail -c` 인 것은 취향이 아니다 — GitHub 러너가 `shell: bash` 를
# `bash --noprofile --norc -e -o pipefail {0}` 으로 돌린다.
#
# $1 = artifactPaths JSON, $2 = 스텁 디렉토리, $3 = "cygpath" 면 그 스텁을 PATH 에
# 올린다.
run_step() {
	local json="$1" d="$2" with_cygpath="${3:-}"
	local bin="$STUB_BIN"
	if [ "$with_cygpath" = "cygpath" ]; then
		bin="$d/bin"
		mkdir -p "$bin"
		cp "$STUB_BIN/gh" "$bin/gh"
		cp "$TMP/cygpath" "$bin/cygpath"
	fi
	OUT="$(PATH="$bin:$PATH" STUB_DIR="$d" CYGPATH_ROOT="$d/win" \
		ARTIFACT_PATHS="$json" TAG="v9.9.9" GH_TOKEN="stub" \
		bash -e -o pipefail -c "$BODY" 2>&1)"
	RC=$?
}

new_case() {
	local d
	d="$(mktemp -d "$TMP/case.XXXXXX")"
	: >"$d/uploads"
	printf '%s' "$d"
}

# artifactPaths 는 JSON 배열이다. 손으로 이어 붙이면 공백 든 파일 이름에서 깨진다.
json_array() {
	printf '%s\n' "$@" | jq -R . | jq -s -c .
}

uploaded_count() {
	awk 'NF {n++} END {print n + 0}' "$1/uploads"
}

echo "step behaviour (stubbed gh):"

LBL_POSIX_HAPPY="POSIX 경로: 파일마다 사이드카를 만들어 올린다"
LBL_SIDECAR_VERIFIES="사이드카가 shasum -a 256 -c 로 검증된다"
LBL_RAW_BACKSLASH_UNSTATTABLE="raw 백슬래시 경로는 stat 되지 않는다 (Git Bash 와 같은 조건)"
LBL_WINDOWS_CONVERTED="백슬래시 경로를 변환해 사이드카를 만든다"
LBL_UNRESOLVED_IS_RED="해석 안 되는 항목은 red 다 (조용한 건너뛰기가 아니다)"
LBL_EMPTY_ARRAY_RED="fail-closed: 항목이 0개면 red"
LBL_ALL_SKIPPED_RED="fail-closed: 전부 건너뛰었으면 red"
LBL_DIR_SKIPPED="디렉토리 번들만 건너뛰고 나머지는 해시한다"
LBL_UPLOAD_FAILURE_RED="gh 업로드 실패가 스텝을 red 로 만든다"

# 전부 있는 POSIX 경로. macOS / Linux 러너의 모양이다.
d="$(new_case)"
mkdir -p "$d/bundle/dmg"
printf 'dmg-bytes' >"$d/bundle/dmg/Table View_9.9.9_aarch64.dmg"
printf 'sig-bytes' >"$d/bundle/dmg/Table View_9.9.9_aarch64.dmg.sig"
run_step "$(json_array "$d/bundle/dmg/Table View_9.9.9_aarch64.dmg" "$d/bundle/dmg/Table View_9.9.9_aarch64.dmg.sig")" "$d"
assert_rc 0 "$LBL_POSIX_HAPPY"
if [ -f "$d/bundle/dmg/Table View_9.9.9_aarch64.dmg.sha256" ] &&
	[ -f "$d/bundle/dmg/Table View_9.9.9_aarch64.dmg.sig.sha256" ] &&
	[ "$(uploaded_count "$d")" = "2" ]; then
	pass "사이드카 둘이 생기고 둘 다 업로드됐다"
else
	fail "사이드카/업로드가 항목 수와 안 맞는다" "업로드: $(cat "$d/uploads")
$OUT"
fi

# 사이드카 형식. `<hash>  <파일이름>` 한 줄이라야 표준 검증기가 먹는다 — 절대경로가
# 들어가면 사용자가 받은 디렉토리에서 `shasum -c` 가 못 찾는다.
if (cd "$d/bundle/dmg" && shasum -a 256 -c "Table View_9.9.9_aarch64.dmg.sha256" >/dev/null 2>&1); then
	pass "$LBL_SIDECAR_VERIFIES"
else
	fail "$LBL_SIDECAR_VERIFIES" "$(cat "$d/bundle/dmg/Table View_9.9.9_aarch64.dmg.sha256")"
fi

# Windows 러너의 모양. 경로는 run 31138766861 의 Windows 잡 로그에서 온 형태다.
d="$(new_case)"
WIN_MSI='D:\a\table-view\table-view\src-tauri\target\release\bundle\msi\Table View_9.9.9_x64_en-US.msi'
WIN_EXE='D:\a\table-view\table-view\src-tauri\target\release\bundle\nsis\Table View_9.9.9_x64-setup.exe'
REAL_DIR="$d/win/d/a/table-view/table-view/src-tauri/target/release/bundle"
mkdir -p "$REAL_DIR/msi" "$REAL_DIR/nsis"
printf 'msi-bytes' >"$REAL_DIR/msi/Table View_9.9.9_x64_en-US.msi"
printf 'exe-bytes' >"$REAL_DIR/nsis/Table View_9.9.9_x64-setup.exe"

# 갈음의 전제. 이 단언이 깨지면 아래 케이스는 아무것도 재현하지 못한다.
if [ -f "$WIN_MSI" ] || [ -d "$WIN_MSI" ]; then
	fail "$LBL_RAW_BACKSLASH_UNSTATTABLE" "이 셸이 백슬래시 경로를 stat 했다: $WIN_MSI"
else
	pass "$LBL_RAW_BACKSLASH_UNSTATTABLE"
fi

run_step "$(json_array "$WIN_MSI" "$WIN_EXE")" "$d" cygpath
assert_rc 0 "$LBL_WINDOWS_CONVERTED"
if [ -f "$REAL_DIR/msi/Table View_9.9.9_x64_en-US.msi.sha256" ] &&
	[ -f "$REAL_DIR/nsis/Table View_9.9.9_x64-setup.exe.sha256" ] &&
	[ "$(uploaded_count "$d")" = "2" ]; then
	pass "변환된 경로 옆에 사이드카가 생기고 업로드됐다"
else
	fail "백슬래시 항목의 사이드카가 안 생겼다" "업로드: $(cat "$d/uploads")
$OUT"
fi

# #2207 그 자체. 변환이 안 되는 러너에서 백슬래시 항목이 오면 조용히 넘어가지 않는다.
d="$(new_case)"
mkdir -p "$d/bundle"
printf 'ok-bytes' >"$d/bundle/good.deb"
run_step "$(json_array "$d/bundle/good.deb" "$WIN_MSI")" "$d"
assert_rc 1 "$LBL_UNRESOLVED_IS_RED"
assert_has "resolves to nothing" "해석 못 한 항목을 이름으로 찍는다"

# 항목이 0개. `if: steps.tauri.outputs.artifactPaths != ''` 는 빈 문자열만 걸러서
# `[]` 는 스텝을 돌린다 — 그때 루프가 0회 돌고 끝나는 것이 옛 형태였다.
d="$(new_case)"
run_step '[]' "$d"
assert_rc 1 "fail-closed: 빈 배열에서 rc=1"
assert_has "artifactPaths carried no entries" "$LBL_EMPTY_ARRAY_RED"

# 디렉토리 번들. macOS 의 `Table View.app` 이 그것이고, 사이드카가 없는 것이 정상이다.
d="$(new_case)"
mkdir -p "$d/bundle/macos/Table View.app"
printf 'tar-bytes' >"$d/bundle/macos/Table View.app.tar.gz"
run_step "$(json_array "$d/bundle/macos/Table View.app" "$d/bundle/macos/Table View.app.tar.gz")" "$d"
assert_rc 0 "$LBL_DIR_SKIPPED"
assert_has "no sidecar for a directory bundle" "건너뛴 디렉토리를 로그에 남긴다"
if [ -f "$d/bundle/macos/Table View.app.tar.gz.sha256" ] && [ "$(uploaded_count "$d")" = "1" ]; then
	pass "디렉토리는 건너뛰고 파일 하나만 올렸다"
else
	fail "디렉토리 건너뛰기가 나머지까지 삼켰다" "업로드: $(cat "$d/uploads")
$OUT"
fi

# 전부 디렉토리. 건너뛰기만 하고 green 으로 끝나면 #2207 과 같은 상태다.
d="$(new_case)"
mkdir -p "$d/bundle/macos/Table View.app"
run_step "$(json_array "$d/bundle/macos/Table View.app")" "$d"
assert_rc 1 "fail-closed: 전부 건너뛰면 rc=1"
assert_has "every artifactPaths entry was skipped" "$LBL_ALL_SKIPPED_RED"

# 해시는 됐는데 업로드가 죽는 경우. 릴리스에는 사이드카가 없으니 green 이면 안 된다.
d="$(new_case)"
mkdir -p "$d/bundle"
printf 'deb-bytes' >"$d/bundle/app.deb"
printf '1' >"$d/rc"
run_step "$(json_array "$d/bundle/app.deb")" "$d"
assert_rc 1 "$LBL_UPLOAD_FAILURE_RED"

# ── ③ mutation — 위 단언들이 실제로 잡는지 ───────────────────────────────
# 판정 대상이 저장소의 워크플로라서, 변조본을 만들어 env 로 물리고 이 스위트를
# 다시 돌린다. 서브런은 이 단계를 끈다 (무한 재귀가 된다).
if [ "${CHECKSUM_SIDECARS_SKIP_MUTATION:-0}" != "1" ]; then
	echo "mutation:"

	MUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/checksum-sidecars-mut.XXXXXX")"
	trap 'rm -rf "$TMP" "$MUT_DIR"' EXIT

	# 리터럴 치환. 정규식이 아니라 index/substr 이라 앵커에서 리터럴까지를 `.*?` 로
	# 잡는 span 을 애초에 쓸 수 없다 (#2180). 대상이 없으면 여기서 죽고, 바꾼 게
	# 없으면 아래 호출부의 `cmp` 가 잡는다. 등장하는 자리는 남기지 않고 바꾼다.
	write_mutant() {
		local src="$1" dst="$2" old="$3" new="$4"
		perl -e '
			my ($src, $o, $n) = @ARGV;
			open my $fh, "<", $src or die "open: $!\n";
			local $/;
			my $t = <$fh>;
			close $fh;
			my ($hits, $i) = (0, 0);
			while (($i = index($t, $o, $i)) >= 0) {
				substr($t, $i, length($o), $n);
				$i += length($n);
				$hits++;
			}
			die "MUTATION TARGET NOT FOUND\n" unless $hits;
			print $t;
		' "$src" "$old" "$new" >"$dst"
	}

	# 서브런 출력. 버리면 양성 대조가 red 일 때 어느 단언이 깨졌는지가 사라진다.
	# 대입문의 exit status 는 명령 치환의 것이라 전역이어야 한다 — `local` 로
	# 받으면 status 가 `local` 의 것이 되어 항상 0 이다.
	SUB_OUT=""
	run_suite_against() {
		SUB_OUT="$(CHECKSUM_SIDECARS_RELEASE_WORKFLOW="$1" \
			CHECKSUM_SIDECARS_SKIP_MUTATION=1 bash "$SELF" 2>&1)"
	}

	# 양성 대조. 이게 red 면 아래 변조본의 red 는 아무것도 증명하지 못한다.
	cp "$RELEASE_WORKFLOW" "$MUT_DIR/control.yml"
	if run_suite_against "$MUT_DIR/control.yml"; then
		pass "positive control: 미변조 사본은 green"
	else
		fail "positive control: 미변조 사본이 red — harness 가 깨졌다" "$SUB_OUT"
	fi

	# "스위트가 red" 로 끝내지 않고 **그 단언이** 낸 red 인지까지 본다 — 안 그러면
	# 다른 단언이 깨져도 통과로 읽힌다.
	assert_mutant() {
		local name="$1" wf="$2" want="$3"
		if run_suite_against "$wf"; then
			fail "mutation[$name]: 변조본이 green — 이 스위트가 그 편집을 못 잡는다" "$SUB_OUT"
		elif printf '%s\n' "$SUB_OUT" | grep -qF -- "$want"; then
			pass "mutation[$name]: '$want' 가 red 를 낸다"
		else
			fail "mutation[$name]: 스위트는 red 인데 기대한 단언이 아니다 (기대: $want)" "$SUB_OUT"
		fi
	}

	# 스텝의 변조는 커밋된 픽스처를 고쳐 만들고, 고친 결과를 스텝 자리에 통째로
	# 끼워 넣는다 — 끼워 넣을 때의 치환 대상은 픽스처 텍스트 전체다.
	step_mutation_case() {
		local name="$1" old="$2" new="$3" want="$4"
		local fx="$MUT_DIR/fx-$name.txt" dst="$MUT_DIR/wf-$name.yml"
		if ! write_mutant "$STEP_FIXTURE" "$fx" "$old" "$new"; then
			fail "mutation[$name]: 픽스처에서 치환 대상을 못 찾았다"
			return
		fi
		if cmp -s "$STEP_FIXTURE" "$fx"; then
			fail "mutation[$name]: 고친 픽스처가 원본과 같다 — 치환이 no-op 이다"
			return
		fi
		# `$(cat …)` 가 양쪽의 끝 개행을 똑같이 떼므로 남는 바이트는 원본 그대로다.
		if ! write_mutant "$RELEASE_WORKFLOW" "$dst" "$(cat "$STEP_FIXTURE")" "$(cat "$fx")"; then
			fail "mutation[$name]: 워크플로에서 스텝 블록을 못 찾았다"
			return
		fi
		assert_mutant "$name" "$dst" "$want"
	}

	# 픽스처가 저장소의 스텝과 바이트 동일한가. 어긋난 채로 끼워 넣으면 스텝이
	# 픽스처로 되돌아가 변조 아닌 것이 섞인다 — 그래서 이것이 아래 전부의 선행 조건이다.
	fixture_ok=0
	if [ ! -f "$STEP_FIXTURE" ]; then
		fail "$STEP_PIN_FAIL" "기대본 픽스처가 없다: ${STEP_FIXTURE#"$ROOT/"}
만드는 법:
  $STEP_UPDATE_CMD"
	else
		step_block >"$MUT_DIR/step.actual"
		if cmp -s "$STEP_FIXTURE" "$MUT_DIR/step.actual"; then
			pass "체크섬 스텝이 커밋된 픽스처와 바이트 동일하다"
			fixture_ok=1
		else
			fail "$STEP_PIN_FAIL" \
				"$(diff -u -L expected -L actual "$STEP_FIXTURE" "$MUT_DIR/step.actual")

바이트 비교라서 공백·주석만 바뀌어도 여기서 걸린다. 릴리스 산출물의 무결성 수단이
바뀌었다는 뜻이므로, 의도한 변경이면 픽스처를 갱신해 같은 커밋에 담아라:
  $STEP_UPDATE_CMD"
		fi
	fi

	if [ "$fixture_ok" = "1" ]; then
		# #2207 의 그 형태를 그대로 되돌린다: 해석 안 되는 항목을 건너뛴다.
		MISSING_IS_RED="$(
			cat <<'YML'
            if [ ! -f "$f" ]; then
              echo "::error::artifactPaths entry resolves to nothing: $raw (read as '$f'). Refusing to end green with a bundle that has no checksum." >&2
              exit 1
            fi
YML
		)"
		MISSING_IS_SKIPPED="$(
			cat <<'YML'
            [ -f "$f" ] || continue
YML
		)"
		step_mutation_case "missing-entry-skipped" "$MISSING_IS_RED" "$MISSING_IS_SKIPPED" \
			"$LBL_UNRESOLVED_IS_RED"

		# 경로 변환을 없앤다 — Windows 러너에서 옛 상태 그대로다.
		step_mutation_case "no-path-conversion" \
			'              cygpath -u "$1"' '              printf '"'"'%s'"'"' "$1"' \
			"$LBL_WINDOWS_CONVERTED"

		# 0건 가드 둘을 각각 없앤다.
		step_mutation_case "zero-entries-passes" \
			'          if [ "$entries" -eq 0 ]; then' '          if false; then' \
			"$LBL_EMPTY_ARRAY_RED"
		step_mutation_case "all-skipped-passes" \
			'          if [ "$hashed" -eq 0 ]; then' '          if false; then' \
			"$LBL_ALL_SKIPPED_RED"

		# artifactPaths 를 env 에서 빼면 본문이 러너 치환에 의존하게 되고, 이
		# 스위트는 그 스텝을 더 이상 실행해 볼 수 없다.
		step_mutation_case "artifact-paths-out-of-env" \
			'          ARTIFACT_PATHS: ${{ steps.tauri.outputs.artifactPaths }}
' '' "$LBL_ENV_ARTIFACT_PATHS"

		# 치환 대상이 픽스처 전체다 — 스텝을 통째로 지운다.
		step_mutation_case "step-deleted" "$(cat "$STEP_FIXTURE")" "" \
			"$LBL_STEP_MISSING"
	fi
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
