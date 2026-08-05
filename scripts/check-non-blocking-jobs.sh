#!/usr/bin/env bash
# check-non-blocking-jobs.sh — `(non-blocking)` 이름과 continue-on-error 를 묶는다 (issue #2174).
#
# `(non-blocking)` 은 이 저장소가 자문 잡에 붙이는 표식이고, 그 이름을 믿는 소비자가
# 있다: release.yml 의 `Verify tag SHA CI is green` 은 접미사로 체크를 거른다. 이름만
# 달고 `continue-on-error` 가 없으면 그 잡의 실패가 자기 run 을 red 로 만들면서
# 릴리스 게이트에서는 조용히 버려진다 — `WASM Size Budget (non-blocking)` 이 그
# 상태였다. 룰의 SOT 는 이슈 #2174 이고 이 스크립트는 집행 장치일 뿐이다.
#
# ## 무엇을 세는가 — 이 규칙이 판정의 전부다
#
#   전수 = `.github/workflows/` 아래 `*.yml` · `*.yaml` 의, `jobs:` 매핑 바로 아래
#          2칸 들여쓴 키 (= job)
#   위반 = 그 job 의 4칸 들여쓴 `name:` 값이 `(non-blocking)` 으로 끝나는데, 같은
#          job 의 4칸 들여쓴 `continue-on-error:` 가 리터럴 `true` 가 아닌 것
#
# 이 규칙에 안 적힌 성질은 판정에 안 들어간다.
#
# 두 값은 **같은 함수**(`scalar()`)로 읽는다. 분기마다 따로 벗기면 그 차이가 곧
# 구멍이다 — 실제로 그랬다: `continue-on-error:` 는 후행 주석을 허용하는데 `name:`
# 은 후행 공백만 벗겨서, `name: X (non-blocking)  # 주석` 을 단 job 이 판정에서
# 통째로 빠졌다. YAML 값으로는 주석 있는 쪽과 없는 쪽이 글자 그대로 같은데 한쪽만
# 걸렸다 (#2174 리뷰가 재현). 주석 · 따옴표 · 공백을 벗기는 자리는 하나뿐이다.
#
# 들여쓰기를 4칸으로 못 박는 이유: step 의 `continue-on-error` 는 더 깊이 있고 그
# step 하나만 삼킨다. 그것을 job-level 로 세면 스텝 하나에 플래그를 붙인 편집이 잡
# 전체를 non-blocking 으로 인증하는데, 실제로는 잡이 여전히 red 로 끝난다.
#
# 리터럴 `true` 만 받는 이유: `${{ ... }}` 식은 값이 런타임에 정해져서 파일만 보고
# 이름의 약속을 보장할 수 없다.
#
# 반대 방향(플래그가 있는데 이름이 없다)은 안 본다. 자문이 아닌 잡이 일시적으로
# 실패를 삼키는 것은 이름의 거짓말이 아니고, 이 게이트가 막으려는 것도 아니다.
#
# 사용:
#   bash scripts/check-non-blocking-jobs.sh          # 이 repo
#   bash scripts/check-non-blocking-jobs.sh <ROOT>   # 다른 트리 (테스트가 쓴다)
#
# 집계 줄(워크플로 · job · 이름 달린 job · `(non-blocking)` job 수)은 **통과와 위반
# 양쪽 경로에 다 찍는다.** 이 게이트의 수치를 인용할 일이 있으면 이 명령의 출력을
# 쓴다 — 위반이 있을 때만 숫자가 사라지면 인용할 수 있는 상태가 반쪽이 된다.
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

ROOT="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
WORKFLOWS_DIR="$ROOT/.github/workflows"
SUFFIX="(non-blocking)"

if [ ! -d "$WORKFLOWS_DIR" ]; then
	echo "ERROR: 워크플로 디렉토리가 없다: $WORKFLOWS_DIR" >&2
	exit 2
fi

# find 의 종료 상태를 여기서 받는다. `< <(find ...)` 로 넘기면 process substitution
# 이라 bash 가 상태를 안 보고 pipefail 도 안 걸려서, 못 읽는 디렉토리가 있어도
# 게이트는 green 이 된다 (같은 함정이 scripts/check-ci-test-calls.sh 헤더에도 있다).
if ! found="$(find "$WORKFLOWS_DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \))"; then
	echo "ERROR: find 가 $WORKFLOWS_DIR 를 다 훑지 못했다 (위 stderr) — 검사 불성립" >&2
	exit 2
fi

files_n="$(printf '%s\n' "$found" | grep -c '.')"
# 0 개를 "위반 0" 으로 통과시키면 트리가 옮겨진 날 게이트가 아무것도 안 재면서
# green 이 된다. 검사 불성립은 통과가 아니다.
if [ "$files_n" -eq 0 ]; then
	echo "ERROR: $WORKFLOWS_DIR 에 워크플로 파일이 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다" >&2
	exit 2
fi

# 파일 목록을 개행으로 배열에 담는다. 워크플로 경로에 개행을 넣는 일은 없다.
files=()
while IFS= read -r f; do
	[ -n "$f" ] && files+=("$f")
done <<<"$found"

# SQ 는 작은따옴표. awk 프로그램이 작은따옴표로 감싸여 있어 안에 직접 못 적는다.
# `TALLY` 줄은 데이터가 아니라 이 스크립트가 읽는 파일별 집계다.
report="$(awk -v SQ="'" -v suffix="$SUFFIX" -v root="$ROOT/" '
	# 경로는 ROOT 기준 상대로 찍는다. 절대 경로를 찍으면 Actions annotation 이 러너
	# 경로로, 로컬 실행이 그 머신의 홈 경로로 나와 인용이 이식되지 않는다.
	function rel(p) {
		return index(p, root) == 1 ? substr(p, length(root) + 1) : p
	}

	# ── YAML 스칼라 값을 읽는 자리는 여기 하나다 ────────────────────────────
	# 두 분기가 각자 벗기면 갈라진다. 헤더의 사유 참조.
	function scalar(line, key,   v, q, i, c) {
		v = line
		sub("^    " key ":[[:space:]]*", "", v)

		# 따옴표 안에서는 `#` 이 주석을 안 연다 — 닫는 따옴표까지가 값이다.
		q = substr(v, 1, 1)
		if (q == "\"" || q == SQ) {
			i = index(substr(v, 2), q)
			if (i > 0) return substr(v, 2, i - 1)
			# 닫는 따옴표가 없으면 성립하지 않는 YAML 이다. 아래로 흘려 원문을 준다.
		}

		# YAML 에서 `#` 은 앞이 공백일 때만 주석을 연다 — `Foo#bar` 는 값이다.
		# i == 1 은 콜론 뒤 공백을 위에서 이미 벗긴 자리라 주석이 맞다.
		for (i = 1; i <= length(v); i++) {
			c = substr(v, i, 1)
			if (c == "#" && (i == 1 || substr(v, i - 1, 1) ~ /[[:space:]]/)) {
				v = substr(v, 1, i - 1)
				break
			}
		}
		sub(/[[:space:]]+$/, "", v)
		return v
	}

	# 파일 이름은 jobfile 에 잡아 둔 것을 쓴다. flush() 는 다음 파일의 FNR==1 에서도
	# 불리는데 그 시점의 FILENAME 은 이미 다음 파일이라, FILENAME 을 그대로 찍으면
	# 한 파일의 마지막 job 위반이 다음 파일 이름으로 보고된다.
	function flush() {
		if (job == "") return
		fjobs++
		if (hasname) fnamed++
		if (nb) {
			fnb++
			if (!coe)
				printf "FAIL %s:%d  job `%s` — name 이 %s 로 끝나는데 job-level `continue-on-error: true` 가 없다\n", \
					rel(jobfile), nameline, job, suffix
		}
		job = ""
	}

	# 집계는 파일별로 낸다. 전역 합계만 보면 한 파일이 다른 관례로 적혀 0 개로
	# 읽혀도 나머지 파일의 수가 그것을 가려 준다 — 그 파일은 통째로 안 훑힌 채
	# green 이 된다.
	function endfile() {
		flush()
		if (curfile != "")
			printf "TALLY %s %d %d %d %d\n", rel(curfile), fjobs, fnamed, fnb, fkeys
		curfile = FILENAME
		fjobs = 0; fnamed = 0; fnb = 0; fkeys = 0
		in_jobs = 0
	}

	FNR == 1 { endfile() }

	/^jobs:[[:space:]]*$/ { in_jobs = 1; next }

	# 최상위 키가 다시 나오면 jobs 매핑을 벗어난 것이다.
	/^[^[:space:]#]/ { flush(); in_jobs = 0; next }

	!in_jobs { next }

	# 2칸 들여쓴 키 = job 하나의 시작. `  # 주석` 은 여기 안 걸린다.
	/^  [A-Za-z0-9_.-]+:[[:space:]]*(#.*)?$/ {
		flush()
		job = $1
		sub(/:$/, "", job)
		jobfile = FILENAME
		nb = 0; coe = 0; hasname = 0; nameline = FNR
		next
	}

	# 4칸 job-level 키를 하나라도 봤는가. `next` 가 없어 아래 두 분기로 흘러간다 —
	# 이 파일의 들여쓰기 관례가 파서의 가정과 맞는지를 이 수로 판정한다.
	job != "" && /^    [A-Za-z0-9_.-]+:/ { fkeys++ }

	/^    name:[[:space:]]/ {
		v = scalar($0, "name")
		hasname = 1
		nameline = FNR
		if (length(v) >= length(suffix) && substr(v, length(v) - length(suffix) + 1) == suffix)
			nb = 1
		next
	}

	/^    continue-on-error:[[:space:]]/ {
		if (scalar($0, "continue-on-error") == "true") coe = 1
		next
	}

	END { endfile() }
' "${files[@]}")"
awk_rc=$?

# 이 파일의 `exit 2` 가드는 9 개이고, **각각을 무력화하면 스위트에서 정확히 한
# 케이스가 죽는다** — 2026-08-06 에 9 개를 하나씩 `if false` 로 끄고 실측했다.
# 가드를 더할 때 그 성질을 같이 유지해라: 다른 가드가 대신 잡아 주는 가드는 있으나
# 마나다. 권한·빈 파일 상태는 픽스처로 만들 수 있다
# (`chmod 000`, 0바이트 `.yml`) — 못 만든다고 적어 뒀다가 리뷰가 셋 다 만들었다.
if [ "$awk_rc" -ne 0 ]; then
	echo "ERROR: awk 가 exit $awk_rc 로 죽었다 (위 stderr) — 검사 불성립" >&2
	exit 2
fi

tally_lines="$(printf '%s\n' "$report" | sed -n 's/^TALLY //p')"
if [ -z "$tally_lines" ]; then
	echo "ERROR: 집계 줄이 안 나왔다 — 검사 불성립" >&2
	exit 2
fi

# 아래 가드는 전부 "훑지 못한 것을 위반 0 으로 통과시키지 않는다" 를 지킨다.
# `(non-blocking)` 이 0 개인 것은 정상 상태라 여기서 안 막는다 — 접미사를 아무도
# 안 쓰면 불변식은 공허하게 참이다.
tally_n=0
jobs_n=0
named_n=0
nb_n=0
while read -r tfile tjobs tnamed tnb tkeys; do
	[ -n "$tfile" ] || continue
	tally_n=$((tally_n + 1))
	if [ "$tjobs" -eq 0 ]; then
		echo "ERROR: $tfile 에서 job 을 0 개 읽었다 — 이 파일의 \`jobs:\` 표기나 들여쓰기 관례가 파서의 가정과 다르다" >&2
		exit 2
	fi
	if [ "$tkeys" -eq 0 ]; then
		echo "ERROR: $tfile 의 job $tjobs 개에서 4칸 들여쓴 job-level 키를 0 개 읽었다 — 이 파일의 들여쓰기 관례가 파서의 가정과 다르다" >&2
		exit 2
	fi
	jobs_n=$((jobs_n + tjobs))
	named_n=$((named_n + tnamed))
	nb_n=$((nb_n + tnb))
done <<<"$tally_lines"

if [ "$tally_n" -ne "$files_n" ]; then
	echo "ERROR: 워크플로 $files_n 개 중 $tally_n 개만 집계됐다 — 검사 불성립" >&2
	exit 2
fi

# job 은 읽혔는데 이름을 하나도 못 뽑았다면 이름 추출이 깨진 것이다. 그 상태로는
# 접미사 판정이 영원히 0 건이라 게이트가 조용히 아무것도 안 지킨다. GitHub Actions
# 에서 job 의 `name:` 은 선택이므로 파일별이 아니라 전체로 본다.
if [ "$named_n" -eq 0 ]; then
	echo "ERROR: job $jobs_n 개 중 job-level \`name:\` 을 가진 것이 0 개다 — 이름 추출이 깨졌다" >&2
	exit 2
fi

summary="워크플로 $files_n 개 · job $jobs_n 개 (이름 있는 것 $named_n 개) · $SUFFIX job $nb_n 개"

violations="$(printf '%s\n' "$report" | grep -c '^FAIL ')"
if [ "$violations" -gt 0 ]; then
	printf '%s\n' "$report" | grep '^FAIL ' >&2
	echo "집계: $summary" >&2
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 체크 화면
	# 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::이름과 동작이 어긋난 job $violations 개 (위 FAIL 줄). $SUFFIX 이름을 달았으면 job-level \`continue-on-error: true\` 를 같이 달아라 — 아니면 이름에서 접미사를 빼라 (issue #2174)." >&2
	exit 1
fi

echo "ok: $summary — 전부 continue-on-error: true"
