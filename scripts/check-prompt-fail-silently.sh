#!/usr/bin/env bash
# check-prompt-fail-silently.sh — 노드 고정부의 명령 블록이 실패를 흘리지 못하게 한다 (issue #2403).
#
# `.agents/prompts/` 는 모든 노드가 첫 행동으로 읽는 계약이고, 거기 적힌 명령을
# 노드가 그대로 실행한다. 그 블록이 실패를 안 멈추고 흘리면 노드는 빈 문자열이나
# 오류 본문을 대조 대상으로 삼고 「clean」으로 보고한다. PR #2401 이 이 유형을
# 3라운드 연속으로 맞았는데 매 라운드 인용된 줄만 고쳐져 유형이 살아남았다 —
# 처방을 자리 목록으로 쓰면 목록 밖 한 자리가 남는다.
#
# 룰의 SOT 는 memory/workflow/implementation/memory.md §5 의 「신뢰 경계·파괴 동작
# 미검증」 행이다 — 그 행이 요구하는 fail-open 3종 중 첫째(「실패가 조용히 통과로
# 강등되는가」)가 여기서 집행된다. 이 스크립트는 그 룰을 `.agents/prompts/` 한
# 표면에 대해 기계로 재는 집행 장치일 뿐이고, 새 룰을 만들지 않는다.
#
# ## 무엇을 세는가 — 이 규칙이 판정의 전부다
#
#   대상 = `git ls-files -- .agents/prompts/` 가 내는 `.md` 파일의, 여는 울타리가
#          ```bash (앞 공백 허용) 인 코드 펜스 안의 줄. 펜스 밖 산문과 bash 가
#          아닌 펜스는 안 본다 — 산문의 `ABORT` 언급은 가드가 아니다
#   논리 줄 = 역슬래시로 이어진 물리 줄을 이어 붙인 것. 보고하는 줄 번호는 그
#          논리 줄의 첫 물리 줄이다
#   따옴표 = 홑따옴표 · 겹따옴표 안의 문자는 셸 메타문자로 안 센다. `--jq` 와
#          `-q` 에 넘기는 jq 프로그램의 `|` 가 여기서 빠진다. **겹따옴표 안의
#          `$( )` 는 다시 명령 문맥이라 따옴표를 벗는다** — `VAR="$(gh … | head)"`
#          가 이 유형이 실제로 쓰이는 형태이고, 겹따옴표를 통째로 불투명하게 보면
#          그 자리가 통과한다
#
#   위반 1 (파이프가 왼쪽 rc 를 가린다)
#     논리 줄에 따옴표 밖 `|` 가 있고 (`||` 는 제외), 그 첫 `|` 왼쪽 조각을 마지막
#     따옴표 밖 명령 구분자(`;` · `&&` · `||`)에서 자른 뒤 정규화한 첫 낱말이
#     아래 allowlist 밖이다. 구분자에서 자르는 이유는 그 뒤부터가 파이프의 머리라서다 —
#     줄 첫 낱말로 재면 `printf a; gh b | head` 가 통과한다.
#     allowlist = printf · echo. 둘 다 리터럴을 내보내는 셸 빌트인이라 네트워크 ·
#     인증 · 저장소 상태로 실패하지 않는다. 그 밖의 명령은 실패할 수 있고,
#     파이프는 그 rc 를 오른쪽 명령의 rc 로 덮는다. `gh` 는 여기에 하나를 더
#     얹는다 — 오류 본문을 stdout 에 쓰므로 빈 문자열 검사로도 안 걸리고 오류
#     JSON 이 값 행세를 한다:
#
#       $ T="$(gh api repos/Felix-LeeSM/table-view/commits/0000000000000000000000000000000000000000 \
#              --jq '.commit.message' 2>/dev/null | head -1)"; printf 'rc=%s %.40s\n' "$?" "$T"
#       rc=0 {"message":"No commit found for SHA: 00000
#
#     파이프를 떼면 같은 조회가 rc=1 을 낸다. 처방은 셋 중 하나다 — 파이프를
#     없애거나(`--jq` 안에서 자르는 식), 앞 명령을 변수로 받고 rc 를 가드하거나,
#     그 뒤에야 `printf '%s\n' "$VAR" | …` 로 넘긴다.
#     정규화 = 앞 공백 제거 → `if `/`then `/`else `/`elif `/`while `/`until `/`do `/
#     `! `/`{ `/`( ` 를 반복 제거 → `VAR=` 대입 접두사 제거 → `"$(` / `$(` / `"`
#     제거 → 첫 공백까지가 낱말
#
#   위반 2 (ABORT 를 적어 놓고 안 멈춘다)
#     논리 줄이 `ABORT` 를 품는데 `exit <0 아닌 정수>` 가 없다. PR #2401 라운드 1
#     이 맞은 자리가 이것이다 — 적어 둔 중단이 rc 0 으로 지나가면 노드는 그 블록
#     뒤를 계속 실행한다
#
#   위반 0 이어야 통과한다. 이 규칙에 안 적힌 성질은 판정에 안 들어간다.
#
# 주석도 판정에 들어간다 — `#` 뒤라고 빼지 않는다. 금지하는 형태를 예시로 인용만
# 해도 걸린다는 뜻이고, 그것이 의도다: 주석에 남은 형태는 다음 노드가 그대로 복사해
# 가는 자리이고, 이슈 #2403 의 수용 기준 명령(`git grep` 리터럴)도 주석을 못 가린다.
# 둘이 같은 집합을 보게 두는 편이 낫다. 예시를 들 자리에서는 리터럴을 붙이지 말고
# 이름으로 부른다 — `PR Body Contract` 게이트가 쓰는 회피법과 같다
# (memory/workflow/delivery/memory.md 「PR body」).
#
# 알려진 천장: 판정은 `|` 왼쪽 조각의 첫 낱말까지다. 그래서 파이프가 함수 정의
# 안에 들어가 있으면 그 함수 이름이 아니라 정의 줄에서 걸린다. allowlist 를
# 넓히는 것은 의도적 행위로 남긴다 — 넓히면 그 명령의 실패가 다시 조용해진다.
#
# 사용:
#   bash scripts/check-prompt-fail-silently.sh          # 이 repo
#   bash scripts/check-prompt-fail-silently.sh <ROOT>   # 다른 트리 (테스트가 쓴다)
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

SCOPE='.agents/prompts/'

ROOT="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"

if [ ! -d "$ROOT" ]; then
	echo "ERROR: 검사할 디렉토리가 없다: $ROOT" >&2
	exit 2
fi

# `rg` 가 아니라 `git ls-files` 인 이유: 루트 `.ignore` 가 제외 목록을 걸어 두고
# 기본 `rg` 는 dotfile 을 빼서 `.agents/` 를 통째로 못 본다 (docs/README.md).
# git 트리가 아니면 전수가 성립하지 않으니 통과시키지 않는다.
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	echo "ERROR: git 작업 트리가 아니다: $ROOT — 전수가 성립하지 않는다" >&2
	exit 2
fi

if ! files="$(git -C "$ROOT" ls-files -- "$SCOPE")"; then
	echo "ERROR: $ROOT 의 추적 파일 목록을 못 읽었다 — 검사 불성립" >&2
	exit 2
fi

# 0 개를 "위반 0" 으로 통과시키면 고정부가 옮겨진 날 게이트가 아무것도 안 훑으면서
# green 이 된다. 검사 불성립은 통과가 아니다.
files_n="$(printf '%s\n' "$files" | grep -c '.')"
if [ "$files_n" -eq 0 ]; then
	echo "ERROR: $SCOPE 아래에 추적 파일이 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다" >&2
	exit 2
fi

# index 에는 있는데 디스크에 없는 파일을 조용히 건너뛰면 그만큼 안 훑고 green 이 된다.
missing=''
while IFS= read -r f; do
	[ -n "$f" ] || continue
	[ -f "$ROOT/$f" ] || missing="$missing$f"$'\n'
done <<EOF
$files
EOF
if [ -n "$missing" ]; then
	printf '%s' "$missing" >&2
	echo "ERROR: 추적 파일이 디스크에 없다 (위 목록) — 검사 불성립" >&2
	exit 2
fi

hits="$(
	printf '%s\n' "$files" | while IFS= read -r f; do
		[ -n "$f" ] || continue
		awk -v rel="$f" '
		# ---- 따옴표 밖 메타문자만 남긴 사본을 만든다 ----------------------------
		# 반환은 원문과 길이가 같고, 따옴표 안의 문자는 전부 "x" 로 덮인다. 그래서
		# 위치가 원문과 1:1 로 맞고, jq 프로그램 안의 `|` 는 사라진다.
		# 겹따옴표 안의 `$( )` 는 명령 문맥으로 되돌아간다 — 거기 든 `|` 는 진짜
		# 파이프이므로 덮으면 안 된다.
		function mask(s,   i, c, q, out, depth, stack) {
			q = ""
			out = ""
			depth = 0
			for (i = 1; i <= length(s); i++) {
				c = substr(s, i, 1)
				if (q != "\047" && c == "$" && substr(s, i + 1, 1) == "(") {
					depth++
					stack[depth] = q
					q = ""
					out = out "xx"
					i++
					continue
				}
				if (q == "" && c == ")" && depth > 0) {
					q = stack[depth]
					depth--
					out = out "x"
					continue
				}
				if (q == "") {
					if (c == "\047" || c == "\"") { q = c; out = out "x"; continue }
					out = out c
				} else {
					if (c == q) { q = "" }
					out = out "x"
				}
			}
			return out
		}
		function firstword(s,   w) {
			sub(/^[ \t]+/, "", s)
			while (s ~ /^(if|then|else|elif|while|until|do|!|\{|\()[ \t]+/) {
				sub(/^(if|then|else|elif|while|until|do|!|\{|\()[ \t]+/, "", s)
			}
			sub(/^[A-Za-z_][A-Za-z0-9_]*=/, "", s)
			sub(/^("\$\(|\$\(|")+/, "", s)
			w = s
			sub(/[ \t].*$/, "", w)
			return w
		}
		function report(n, why, text) {
			printf "%s:%d: %s\n    %s\n", rel, n, why, text
		}
		function judge(n, line,   m, i, c2, p, cut, pre, mpre, w) {
			# 위반 2 — ABORT 를 적었으면 0 아닌 rc 로 끝나야 한다.
			if (line ~ /ABORT/ && line !~ /exit[ \t]+[1-9][0-9]*/) {
				report(n, "ABORT 를 적고 0 아닌 rc 로 안 끝난다", line)
			}
			# 위반 1 — 따옴표 밖 첫 단일 파이프의 왼쪽을 본다.
			m = mask(line)
			p = 0
			for (i = 1; i <= length(m); i++) {
				if (substr(m, i, 1) != "|") continue
				if (substr(m, i + 1, 1) == "|") { i++; continue }   # ||
				p = i
				break
			}
			if (p == 0) return
			pre = substr(line, 1, p - 1)
			mpre = substr(m, 1, p - 1)
			# 마지막 명령 구분자 뒤부터가 이 파이프의 머리다.
			cut = 0
			for (i = 1; i <= length(mpre); i++) {
				c2 = substr(mpre, i, 2)
				if (c2 == "&&" || c2 == "||") { cut = i + 1; i++; continue }
				if (substr(mpre, i, 1) == ";") cut = i
			}
			w = firstword(substr(pre, cut + 1))
			if (w == "printf" || w == "echo") return
			report(n, "파이프가 `" w "` 의 rc 를 가린다", line)
		}
		{
			t = $0
			sub(/^[ \t]+/, "", t)
			if (t ~ /^```/) {
				if (infence) { infence = 0 }
				else { infence = (t ~ /^```(bash|sh|shell)[ \t]*$/) ? 1 : 0 }
				next
			}
			if (!infence) next
			if (buf == "") start = FNR
			line = $0
			if (line ~ /\\[ \t]*$/) {
				sub(/\\[ \t]*$/, "", line)
				buf = buf line
				next
			}
			judge(start, buf line)
			buf = ""
		}
		END { if (buf != "") judge(start, buf) }
		' "$ROOT/$f"
	done
)"

if [ -n "$hits" ]; then
	printf '%s\n' "$hits" >&2
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::고정부 명령 블록이 실패를 흘린다 — $(printf '%s\n' "$hits" | grep -c ':.*: ') 자리 (위 목록). 파이프 왼쪽 명령의 rc 가 필요하면 변수로 받고 가드한 뒤 \`printf '%s\\n' \"\$VAR\" | …\` 로 넘기거나 파이프를 없애라. \`ABORT\` 를 적은 자리는 0 아닌 rc 로 끝내라. 판정 규칙은 scripts/check-prompt-fail-silently.sh 헤더가 갖는다 (issue #2403)." >&2
	exit 1
fi

echo "ok: $SCOPE 추적 파일 $files_n 개의 bash 펜스에 실패를 흘리는 자리 0"
