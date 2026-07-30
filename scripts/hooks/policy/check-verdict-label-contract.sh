#!/usr/bin/env bash
# check-verdict-label-contract.sh
# Verdict label 절차의 계약 가드 (#1879, #1884).
#
# 두 가지를 본다.
#
#   1. 추적 `.md` 어디에도 **한 명령으로 label 을 add 하고 remove 하라는 지시가
#      없어야 한다.** 같은 초에 label 이벤트가 둘 나면 `review-gate` 의
#      `cancel-in-progress` 가 run 하나를 죽이고, 죽은 run 이 rollup 에
#      non-success 로 남아 BLOCKED 가 고착된다 (#1879 실측).
#
#   2. verdict 절차를 적는 문서는 red 분기에서 `review:approved` 를 **먼저**
#      떼야 하고, 두 label 명령 사이에 최소 대기를 적어야 한다. red 가 approved
#      를 안 떼면 push 없이 green 이 red 로 뒤집힐 때 label 이 남아 게이트가
#      통과한다 — `Dismiss stale approval` 은 `synchronize` 전용이다 (#1884).
#
# ## 판정 단위 — 개행을 건넌다
#
# 위험/안전을 가르는 것은 두 플래그가 **한 명령 안에 있는지**다. 명령은 이
# 저장소의 기본 표기에서 줄바꿈으로 접힌다 (산문 폭 ~82자, 결합 명령이 정확히
# 82자다). 그래서 줄이 아니라 **블록**을 판정 단위로 쓴다:
#
#   - fenced code block 안: 한 줄이 한 명령. 단 `\` 줄연결은 이어 붙인다.
#   - 그 밖: 블록(빈 줄 / 목록 항목 / heading 이 경계)을 한 줄로 접은 뒤
#     인라인 코드 span 단위, 그리고 span 을 걷어낸 나머지 산문 단위.
#
# 안전:   `--add-label X` 뒤 `--remove-label Y`   ← 서로 다른 span 두 개
# 위험:   `--add-label X --remove-label Y`        ← 한 span 안에 둘
#
# `gh pr edit` 접두사에 기대지 않는다. 이 검사의 1차 표적인 두 pr-reviewer
# wrapper 는 접두사 없이 플래그만 적는 표기를 쓴다.
#
# ## 판정 2 의 대상은 배열이 아니라 유도된다
#
# 손으로 적은 SOT 배열은 항목을 지우면 그 파일이 검사 밖으로 나간다 (#1875 와
# 같은 부류). 그래서 대상은 "`review:changes-requested` 를 적는 추적 `.md`" 로
# 스윕에서 유도한다. 그 위에 #1884 의 완료 조건인 세 경로를 floor 로 둔다 —
# 셋 중 하나에서 red 분기가 사라지면 유도 집합에서 빠지고, floor 가 잡는다.
#
# ## 덮지 못하는 것
#
#   - `gh api repos/.../labels` 로 같은 지시를 쓰면 못 잡는다 (#1906). 플래그
#     표기가 아니라 REST 경로라 같은 판정 단위에 안 들어온다.
#   - 대기는 `<숫자>초` 표기만 읽는다. "1분 대기" 는 못 읽는다.
#   - 판정 2 의 순서 검사는 `gh pr edit` 을 앞에 단 명령형 표기만 op 로 센다.
#     산문 인용을 완전한 명령형으로 적고 red 절차 안에 두면 순서 검사를 만족시킬
#     수 있다. 구간(`green`/`red` 단어) 분할이 그 범위를 좁힐 뿐 없애지 않는다.
#   - 비-md 추적 파일은 안 본다. 근거는 실측이다 — `--add-label`/`--remove-label`
#     을 담은 추적 파일 4개가 전부 `.md` 이고, 라벨 이름을 적는 비-md 2개
#     (`.github/workflows/review-gate.yml`, `scripts/hooks/policy/test-review-gate-round.sh`)
#     는 지시가 아니라 집행 주체다. 반대로 비-md 를 스윕에 넣으면 이 스크립트
#     자신의 패턴 리터럴이 결합 형태로 잡힌다.

set -euo pipefail

# #1884 의 완료 조건이 명시한 세 경로. 유도 집합의 floor 다 (위 헤더 참조).
REQUIRED_SOTS=(
	"memory/workflow/review/memory.md"
	".claude/agents/pr-reviewer.md"
	".codex/agents/pr-reviewer.md"
)

MIN_WAIT_SECONDS=30

violations=0

# 판정 1 tokenizer. `\t` 구분 레코드를 낸다:
#   H<TAB>path<TAB>line<TAB>candidate   결합 형태 히트
#   S<TAB>path                          verdict label 을 적는 파일 (판정 2 대상)
read -r -d '' TOKENIZER <<'AWK' || true
function judge(s, ln,   t) {
	if (s ~ /--add-label/ && s ~ /--remove-label/) {
		t = s
		gsub(/^[ \t]+|[ \t]+$/, "", t)
		printf "H\t%s\t%d\t%s\n", fname, ln, t
	}
}
function flush_para(   line, span, rest) {
	if (para == "") { para_line = 0; return }
	line = para
	rest = ""
	while (match(line, /`[^`]*`/)) {
		span = substr(line, RSTART + 1, RLENGTH - 2)
		judge(span, para_line)
		rest = rest substr(line, 1, RSTART - 1) " "
		line = substr(line, RSTART + RLENGTH)
	}
	judge(rest line, para_line)
	para = ""
	para_line = 0
}
function flush_cont() {
	if (cont == "") return
	judge(cont, cont_line)
	cont = ""
}
FNR == 1 {
	flush_para()
	flush_cont()
	fence = 0
	fname = FILENAME
	sub(/^\.\//, "", fname)
}
index($0, "review:changes-requested") > 0 && !seen[fname]++ { printf "S\t%s\n", fname }
/^[ \t]*(```|~~~)/ { flush_para(); flush_cont(); fence = 1 - fence; next }
fence {
	line = $0
	sub(/[ \t]+$/, "", line)
	if (cont == "") cont_line = FNR
	if (line ~ /\\$/) { sub(/\\$/, "", line); cont = cont line " "; next }
	judge(cont line, cont_line)
	cont = ""
	next
}
/^[ \t]*$/ { flush_para(); next }
/^[ \t]*(#|([-*+]|[0-9]+[.)])[ \t])/ { flush_para() }
{
	if (para_line == 0) para_line = FNR
	para = (para == "" ? $0 : para " " $0)
}
END { flush_para(); flush_cont() }
AWK

# 판정 2. 파일 전체를 접어 토큰 열로 만들고 `green`/`red` 단어로 구간을 나눈다.
# 구간 분할이 없으면 앞선 산문 언급 한 줄로 순서 검사가 무력화된다.
# `red` 는 단어 경계로 본다 — 부분문자열로 보면 `required` / `credential` 이
# 구간을 열어 창이 통째로 넓어진다.
read -r -d '' VERDICT_SHAPE <<'AWK' || true
function add_lit(str, lit, k,   base, p) {
	base = 0
	while ((p = index(substr(str, base + 1), lit)) > 0) {
		base = base + p
		n++
		pos[n] = base
		tk[n] = k
	}
}
function add_word(str, w, k,   base, p, before, after, L) {
	L = length(w)
	base = 0
	while ((p = index(substr(str, base + 1), w)) > 0) {
		base = base + p
		before = (base > 1) ? substr(str, base - 1, 1) : " "
		after = substr(str, base + L, 1)
		if (after == "") after = " "
		if (before !~ /[A-Za-z]/ && after !~ /[A-Za-z]/) {
			n++
			pos[n] = base
			tk[n] = k
		}
	}
}
function add_waits(str,   base, p, i, c, num) {
	base = 0
	while ((p = index(substr(str, base + 1), SEC)) > 0) {
		base = base + p
		num = ""
		i = base - 1
		while (i >= 1) {
			c = substr(str, i, 1)
			if (c < "0" || c > "9") break
			num = c num
			i--
		}
		if (num != "") {
			n++
			pos[n] = base
			tk[n] = "wait"
			val[n] = num + 0
		}
	}
}
function sort_tokens(   i, j, pp, kk, vv) {
	for (i = 2; i <= n; i++) {
		pp = pos[i]
		kk = tk[i]
		vv = val[i]
		j = i - 1
		while (j >= 1 && pos[j] > pp) {
			pos[j + 1] = pos[j]
			tk[j + 1] = tk[j]
			val[j + 1] = val[j]
			j--
		}
		pos[j + 1] = pp
		tk[j + 1] = kk
		val[j + 1] = vv
	}
}
{ s = s $0 " " }
END {
	gsub(/["\047]/, "", s)
	gsub(/-label=/, "-label ", s)

	add_lit(s, "gh pr edit", "cmd")
	add_lit(s, "--add-label review:approved", "+A")
	add_lit(s, "--remove-label review:approved", "-A")
	add_lit(s, "--add-label review:changes-requested", "+C")
	add_lit(s, "--remove-label review:changes-requested", "-C")
	add_word(s, "green", "mark")
	add_word(s, "red", "mark")
	add_waits(s)
	sort_tokens()

	seg = 0
	prev = ""
	for (i = 1; i <= n; i++) {
		if (tk[i] == "mark") {
			seg++
			prev = "mark"
			continue
		}
		if (tk[i] == "cmd" || tk[i] == "wait") {
			if (tk[i] == "wait") {
				wn[seg]++
				wpos[seg, wn[seg]] = pos[i]
				wval[seg, wn[seg]] = val[i]
			}
			prev = tk[i]
			continue
		}
		# op token. `gh pr edit` 이 바로 앞에 있을 때만 명령으로 센다 —
		# 그래야 산문 인용이 순서 검사를 만족시키지 못한다.
		if (prev != "cmd") {
			prev = tk[i]
			continue
		}
		prev = tk[i]
		on[seg]++
		ops[seg, on[seg]] = tk[i]
		opos[seg, on[seg]] = pos[i]
		if (tk[i] == "+C") has_red = 1
	}

	for (g = 0; g <= seg; g++) {
		# red 순서: 구간 안에서 +C 앞에 -A 가 있어야 한다.
		for (i = 1; i <= on[g]; i++) {
			if (ops[g, i] != "+C") continue
			ok = 0
			for (j = 1; j < i; j++)
				if (ops[g, j] == "-A") ok = 1
			if (!ok) print "order"
		}
		# 대기: 한 구간이 label 을 두 번 이상 치면 그 사이에 최소 대기가 있어야 한다.
		if (on[g] >= 2) {
			ok = 0
			for (i = 1; i <= wn[g]; i++)
				if (wpos[g, i] > opos[g, 1] && wpos[g, i] < opos[g, on[g]] && wval[g, i] >= MIN)
					ok = 1
			if (!ok) print "wait"
		}
	}
	if (has_red) print "red"
}
AWK

report() {
	echo "$1" >&2
	violations=$((violations + 1))
}

work="$(mktemp -d "${TMPDIR:-/tmp}/verdict-label-contract.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# 목록을 먼저 파일로 받아 **실패를 감지한다.** 파이프로 바로 넘기면 `git` 이
# 죽어도 빈 목록이 흘러 "결합 형태 0" 으로 통과한다 (fail-open).
if ! git ls-files -z -- '*.md' >"$work/all" 2>"$work/git-err"; then
	echo "⚠️  verdict label: git ls-files — 파일 목록을 못 얻었다. 빈 목록을 통과로 읽지 않는다" >&2
	sed 's/^/    /' <"$work/git-err" >&2 || true
	exit 1
fi

# 인덱스에는 있고 디스크에 없는 경로(staged 삭제)는 뺀다. awk 가 그 경로에서 죽는다.
: >"$work/list"
while IFS= read -r -d '' path; do
	if [ -f "$path" ]; then
		printf './%s\0' "$path" >>"$work/list"
	fi
done <"$work/all"

if [ ! -s "$work/list" ]; then
	echo "⚠️  verdict label: git ls-files -- *.md — 스윕 대상이 0개다. 빈 스윕을 통과로 읽지 않는다" >&2
	exit 1
fi

swept="$(tr -cd '\0' <"$work/list" | wc -c | tr -d ' ')"

# awk 를 `LC_ALL=C` 로 돌린다. 두 프로그램 모두 위치를 오프셋으로 비교하고
# 정규식은 ASCII 만 쓴다 — 바이트로 일관되게 보는 편이 맞다. UTF-8 locale 에서는
# macOS awk 20200816 이 한국어 본문에서 `towc: multibyte conversion failure` 로
# 죽는다 (실측: 이 저장소의 memory/workflow/review/memory.md).
#
# awk 가 죽으면 `set -e` 가 여기서 스크립트를 죽인다 — 조용한 fail-open 이 아니다.
LC_ALL=C xargs -0 awk "$TOKENIZER" <"$work/list" >"$work/scan"

combined=0
while IFS="$(printf '\t')" read -r kind path line candidate; do
	[ "$kind" = "H" ] || continue
	report "⚠️  verdict label: $path:$line — 한 명령이 label 을 add 하고 remove 한다"
	echo "    $candidate" >&2
	combined=$((combined + 1))
done <"$work/scan"

subjects=""
while IFS="$(printf '\t')" read -r kind path _rest; do
	[ "$kind" = "S" ] || continue
	subjects="$subjects$path
"
done <"$work/scan"

carries_red=""
while IFS= read -r path; do
	[ -n "$path" ] || continue
	shape="$(LC_ALL=C awk -v MIN="$MIN_WAIT_SECONDS" -v SEC="초" "$VERDICT_SHAPE" "$path")"
	case "$shape" in
		*red*) carries_red="$carries_red$path
" ;;
	esac
	case "$shape" in
		*order*)
			report "⚠️  verdict label: $path — red 절차가 review:approved 를 떼기 전에 review:changes-requested 를 붙인다"
			;;
	esac
	case "$shape" in
		*wait*)
			# 메시지 본문에 변수를 넣지 않는다. 스윕이 이 리터럴을 가드 소스에서
			# 읽어 "모든 위반 경로에 케이스가 있는가" 를 재는데, 변수가 섞이면
			# 소스의 문자열과 실행 시 출력이 달라져 그 floor 가 헛돈다.
			report "⚠️  verdict label: $path — 두 label 명령 사이에 최소 대기 표기가 없다"
			echo "    최소 ${MIN_WAIT_SECONDS}초 이상을 두 명령 사이에 적어라 (#1879)" >&2
			;;
	esac
done <<<"$subjects"

for sot in "${REQUIRED_SOTS[@]}"; do
	case "
$carries_red" in
		*"
$sot
"*) continue ;;
	esac
	report "⚠️  verdict label: $sot — verdict 절차 SOT 인데 red 분기 명령이 없다"
done

if [ "$violations" -gt 0 ]; then
	echo "verdict label contract: 위반 ${violations}건 (스윕 ${swept}파일)" >&2
	exit 1
fi

echo "PASS: verdict label contract (스윕 ${swept}파일, 결합 형태 ${combined}건, red 분기 SOT $(printf '%s' "$carries_red" | grep -c . || true)개)"
