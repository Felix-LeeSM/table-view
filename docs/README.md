---
title: Docs Index
type: index
updated: 2026-05-28
---

# Docs Index

`docs/` 는 사람이 읽는 제품/프로젝트 문서다. Agent 실행 규칙과 협업 룰은
`memory/` 에 둔다.

## 빠른 진입

| 찾는 것 | 현재 위치 | 정리 방향 |
|---|---|---|
| 사용법 / 사용자 워크플로우 | future `user-guide/` | 사람용 user guide 로 유지 |
| 제품 범위 / 지원 현황 | `product/README.md`, `product/known-limitations.md`, `product/query-language-support.md` | 현재 상태는 `product/` |
| 미래 목표 / 순서 후보 | `ROADMAP.md`, `roadmap/`, `PLAN.md` | `ROADMAP.md` 가 index SOT, 지평 본문과 follow-up queue 는 `roadmap/`, `PLAN.md` 는 호환 인덱스 |
| GitHub milestone / issue 실행 상태 | GitHub milestones/issues, `ROADMAP.md` 요약 | 실행 bucket 은 GitHub, 순서/경계 요약은 `ROADMAP.md` |
| 구조 / 설계 규칙 | `memory/engineering/architecture/**` | agent 가 적용해야 하는 active engineering SOT |
| 개발 / 검증 / 기여 | `contributor-guide/`, `memory/engineering/**` | 사람용 절차는 docs, 코딩 규칙은 memory |
| 과거 기록 | `archives/`, retired risk registers, historical `explorations/` | `archives/` 아래로 수렴 |

## 분량 cap

**cap 은 파일 하나마다 걸린다 — 묶음 합계가 아니다.** 상한은 파일당 **33,000
chars**, 단위는 `wc -m` 의 문자(code point)이고 바이트가 아니다. 목적은 도입 때
적힌 그대로 agent 가 읽을 때의 context 부하를 가두는 것이다. 규율로만 남고 자동
검사는 없다 (아래 「자동 검사를 두지 않는 이유」).

### 모집단은 이 명령이 정의한다

산문으로 「지속 참조 문서」라고만 쓰던 자리다. 읽는 사람마다 다른 집합을 잡아 값이
갈렸으므로(#2266) 명령을 SOT 로 둔다.

```sh
REV=HEAD   # 워킹트리가 아니라 커밋을 잰다 — dirty 트리에서 값이 갈리지 않게
git ls-tree -r --name-only "$REV" -- docs \
  | grep -E '^docs/((product|contributor-guide|roadmap|phases)/.*|[^/]+)\.md$' \
  | while IFS= read -r f; do
      echo "$(git show "$REV:$f" | LC_ALL=en_US.UTF-8 wc -m | tr -d ' ') $f"
    done | sort -rn
```

- 드는 것: `docs/` 바로 아래 `.md`, 그리고 `product/` · `contributor-guide/` ·
  `roadmap/` · `phases/` 아래 `.md`. 정규식의 `/.*` 가 재귀라
  `contributor-guide/smoke-matrix/` 와 `contributor-guide/release/` 도 든다.
- 빠지는 것: `archives/` · `explorations/` (일회성 산출물이라 다시 읽을 일이 거의
  없다), `decisions/` (ADR 본문은 동결이라 줄일 수 없다 — `archives/` 밑에 있던
  시절에도 cap 밖이었지만 그때 사유는 동결이 아니라 `archives/` 포괄 제외였다).
- 전수 도구가 `git ls-tree` 인 이유는 위 주석대로 워킹트리가 아니라 커밋을 재기
  때문이다 — 같은 rev 를 주면 누가 어느 트리에서 돌려도 같은 값이 나온다.
- 로케일이 UTF-8 이 아니면 `wc -m` 이 문자가 아니라 바이트를 센다. 한 줄로
  확인한다 — `printf '가나다' | LC_ALL=en_US.UTF-8 wc -m` 이 `3` 이 아니면 그
  로케일로는 못 잰다.

### 현재 값 — `47eb7e00`

| 무엇 | 값 |
|---|---|
| 파일당 최대 | 29,472 `docs/roadmap/h5.md` (다음이 29,350 `docs/roadmap/h2.md`) |
| cap 초과 파일 | 0 |
| 묶음 합계 | 564,569 chars / 46 파일 — **cap 이 재는 값이 아니다** |

합계는 위 명령 뒤에 `| awk '{s+=$1} END {print s, NR}'` 를 붙이면 나온다. 합계를
같이 적어 두는 이유는 이 값을 cap 과 견주던 오독이 실제로 있었기 때문이다 (#2266).

### 왜 33,000 인가

앞선 값은 120,000 이었고 본문에 근거가 없었다. 근거는 히스토리에 있다. 도입 커밋
`3b3d38d2` (#970) 이 파일당 검사 스크립트 `scripts/hooks/check-doc-size.sh` 를 같이
넣었고, 그 스크립트는 파일마다 `wc -m` 을 재 threshold 와 견줬다. 왜 하필 120,000
이었는지는 커밋 메시지에 없다 — `git log -1 --format=%B 3b3d38d2` 에 남은 것은
위반 0 확인과 「threshold ratchet 은 후속 Phase」 뿐이다. 확인되는 것은 비율이다.
위 명령을 `3b3d38d2` 에 대고 재면 그때의 최대가 106,766
(`docs/contributor-guide/testing-and-quality.md`) 이고 cap 은 그것의 1.124 배였다.

그 스크립트는 2026-07-30 `6cced3ab` (#2033) 의 workflow 철거에 딸려 지워졌고, 다음
날 `46ca4799` (#2034) 가 그것을 가리키던 문장을 「cap 은 규율로만 남았고 자동
검사가 없다」로 갈았다. **파일당이라는 축은 스크립트에만 있었다** — 이 절 산문에
그 축이 적힌 판은 히스토리에 없다. 그래서 스크립트가 사라진 뒤 남은 산문은 묶음
합계로 읽혔다.

```sh
# rev 를 못 박아야 이 값이 뒤 커밋에 흔들리지 않는다
for p in 파일당 '각 파일' per-file '파일 하나' '파일마다'; do
  echo "$p $(git log --format=%h -S"$p" 47eb7e00 -- docs/README.md | wc -l)"
done   # 전부 0
```

그때의 비율을 오늘의 최대에 다시 적용한다 — 29,472 × (120,000 ÷ 106,766) = 33,125
→ **33,000** (`awk 'BEGIN{printf "%.0f\n", 29472*120000/106766}'`).
도입 커밋이 「threshold ratchet 은 후속 Phase」로 미뤄 둔 그 ratchet 이다. 120,000
을 그대로 두면 오늘 최대의 4.07 배라 어느 문서도 닿지 못해 장치가 아니고, 33,000
에서 초과 파일은 0 이라 이 값은 어느 문서도 줄이라고 요구하지 않는다. 다음에 또
조일 때도 같은 구성을 쓴다 — 그 시점의 최대에, 직전 cap 이 자기 시점의 최대에
대해 가졌던 배수(지금이면 33,000 ÷ 29,472)를 곱한다.

### 자동 검사를 두지 않는 이유

이 자리가 실제로 낸 실패는 「파일이 몰래 cap 을 넘었다」가 아니라 「cap 이 무엇을
재는지가 읽는 사람마다 갈렸다」다 — 위 명령이 그것을 닫고 CI 잡은 안 닫는다. 지금
초과가 0 이고 최대가 cap 보다 3,528 chars 낮아, 게이트를 넣어도 당분간 늘 green 인
잡이 하나 는다.

다시 볼 조건: 위 명령에서 33,000 을 넘은 파일이 나왔는데 리뷰가 그것을 못 잡은
사례가 생기면 그때 만든다. 베낄 형태는 `scripts/check-memory-doc-size.sh` 다 —
로케일 자기검사, 0개 가드, `::error::` 주석이 거기 있다.

## 유지할 최상위 묶음

- `user-guide/` - 사용자가 제품을 쓰는 법. 필요할 때 신설.
- `product/` - 현재 제품 상태, 사용자 관점 기능, 지원 범위, known limitations.
- `ROADMAP.md` - 미래 목표, 승격 후보, sequencing 기준. 지평 본문은 `roadmap/`.
- `roadmap/` - 지평별 진행 기준(`h1.md`-`h7.md`)과 open follow-up queue.
- `PLAN.md` - 기존 링크 호환용 roadmap/product 인덱스. backlog 나 product
  claim ledger 를 두지 않는다.
- `contributor-guide/` - 개발자가 변경을 넣을 때 읽는 사람용 절차.
- `decisions/` - ADR. 살아 있는 정책이라 `archives/` 로 내리지 않는다.
- `archives/` - 더 이상 active SOT 가 아닌 기록.
- `phases/` - active phase planning 만 둔다. 보류/완료/비활성 phase 는
  `archives/phases/` 로 이동한다.

`RISKS.md` 는 독립 active 문서로 유지하지 않는다. 위험/제약은 소유 문서로
라우팅한다:

- 현재 사용자-visible 사실이면 `product/**` — per-source boundary 행은
  `product/known-limitations-{rdbms,non-rdbms,cross-cutting}.md`.
- 미래 work item 이면 `roadmap/follow-up-queue.md` (승격 후보 순서 자체를 바꾸면
  `ROADMAP.md`).
- 구조적 제약이면 `memory/engineering/architecture/**`.
- 개발/운영 절차 제약이면 `memory/engineering/**` 또는 `contributor-guide/`.
- 결정으로 굳으면 ADR 로 `decisions/`.
- 과거 사건/retired register 는 `archives/`.

## Memory 와 Docs 경계

- `memory/` - agent 가 작업 중 직접 열어 읽는 active product/engineering/workflow/runbook 규칙. 자동 로드는 없다.
- `memory/engineering/` - 코드 구조, architecture, convention, fixture, UI 규칙 SOT.
- `docs/decisions/` - ADR. Accepted 가 살아 있는 정책이라 기본 검색에 잡히고,
  Superseded 판은 같은 자리에 남아 frontmatter `status` 로 갈린다.
- `docs/archives/incidents/` - 과거 사건 기록. 기본 agent memory 탐색 대상이 아니다.
- `docs/` - 사람이 탐색하는 제품/프로젝트 문서.

같은 내용을 둘 이상에 복제하지 않는다. 한쪽에 본문을 두고 다른 쪽은 링크만 둔다.

## 검색 팁

루트의 `.ignore` 가 `docs/{archives,explorations}` 를 빼 두므로 **`rg` 의** 기본
검색이 곧 active 문서 검색이다. 단 루트를 둘 이상 주는 형태라 `-j1` 이 함께
붙어야 한다 — 이유는 아래 주의를 보라. **`.ignore` 를 근거로 삼는 이 절의 서술은
`rg` 에만 선다** — 이 harness 의 `grep` 은 그 파일을 안 읽어 같은 검색어에 다른
집합을 낸다 (아래 「이 harness 의 `grep` 은 `rg` 와 다른 집합을 낸다」).

```sh
rg -j1 '<term>' docs memory README.md AGENTS.md
```

과거 기록만 볼 때는 그 디렉터리를 직접 지정한다. 명령줄에 직접 준 경로에는
`.ignore` 가 걸리지 않으므로 플래그가 필요 없다 — 루트의 `.ignore` 도 같은
형태를 권한다. active 와 기록을 한 번에 훑을 때만 `--no-ignore-dot` 을 쓴다.
`--no-ignore` 는 쓰지 않는다 — 기록만 보려는데 `.gitignore` 까지 꺼서
범위가 넘친다. `--no-ignore-dot` 은 `.ignore`·`.rgignore` 만 끄고 `.gitignore` 는
남긴다.

```sh
rg '<term>' docs/archives                                         # 기록만
rg -j1 --no-ignore-dot '<term>' docs memory README.md AGENTS.md   # active + 기록
```

**주의 — 루트를 둘 이상 주면서 `-j1` 을 빼면 ignore 적용이 비결정적이다.**
병렬 walker 가 경합해 같은 명령이 실행마다 다른 결과를 낸다. 아래 재현 명령을
2026-08-01 에 다섯 번 돌린 결과(총 100 실행), 나오는 값은 기록 0건 아니면 전량
(측정 시점 7건) 둘뿐이고 중간값이 없었다. 대신 20회 중 0건이 몇 번인지는 라운드마다
달랐다 — 비율이 고정이 아니라 재현해도 같은 분포가 안 나온다. 같은 명령에
`-j1` 만 넣으면 다섯 번 다 20회 전부 0건이었다.

```sh
# -j1 을 뺀 형태다. 비결정성 재현용이고 레시피가 아니다.
for i in $(seq 20); do rg -l 'lefthook' docs memory README.md AGENTS.md | grep -cE '^docs/(archives|explorations)/'; done | sort | uniq -c
```

### 저장소 전수

경로를 안 주고 저장소를 훑으면 `rg` 는 dot 경로(`.agents/`, `.claude/`, `.github/`
등)를 기본으로 뺀다. 에이전트 프롬프트나 워크플로까지 보려면 `--hidden` 이 필요하고,
`.ignore` 를 끄는 `--no-ignore-dot` 과는 별개 스위치라 전수에는 둘 다 붙는다.
(위의 경로 한정 레시피처럼 dot 디렉터리를 명령줄에 직접 주면 그때는 `--hidden`
없이도 걸어 들어간다 — `rg --files .github` 8건.)

**전수는 `git grep` 이 기본이다** — 추적 파일 전부를 훑고 ignore 파일에 안 걸린다.
rg 로 같은 모집단에 근사할 때는 두 플래그를 다 붙이고, `--hidden` 이 `.git/` 안까지
내려가므로 `-g '!.git'` 으로 막는다.

```sh
git grep -n '<term>'                                # 전수 — 추적 파일 기준
rg -n --no-ignore-dot --hidden -g '!.git' '<term>'  # rg 로 같은 모집단에 근사
```

**둘은 근사지 등식이 아니다.** 아래가 차이 파일을 그대로 뽑는다 — 위 레시피와
같이 `-g '!.git'` 을 붙인 형태다. 건수를 적지 않는 이유는 이 문서가 두 검색어를
품고 있어 자기 자신을 세기 때문이다.

```sh
diff <(git grep -l lefthook | sort) <(rg -l --no-ignore-dot --hidden -g '!.git' lefthook | sort)
diff <(git grep -l sql_parser_core | sort) <(rg -l --no-ignore-dot --hidden -g '!.git' sql_parser_core | sort)
```

첫 줄은 차이가 없다 — `lefthook` 은 추적된 텍스트 파일에만 있어서 `-g '!.git'` 만
붙이면 두 집합이 맞는다. 둘째 줄은 git grep 쪽 여분 한 줄,
`src/lib/sql/wasm/sql_parser_core_bg.wasm` 이다 — git grep 은 추적 바이너리 안을
맞히고 rg 는 재귀 탐색에서 바이너리를 건너뛴다. 두 줄 다 작업 중인 사본과 갓
clone 한 사본에서 같은 결과였다 (2026-08-01 실측).

반대 방향인 **rg 쪽 여분은 사본 상태에 달렸다.** rg 는 추적 여부를 안 보므로
`.gitignore` 에 안 걸린 미추적 파일을 같이 세고, `-g '!.git'` 을 빼면 `.git/` 안까지
얹힌다 — `packed-refs` 의 ref 이름, `COMMIT_EDITMSG` 의 직전 커밋 메시지, 설치된
훅이 검색어에 걸린다. 검색어와 사본에 따라 달라지므로 파일 이름을 못 박지 않는다.

### 이 harness 의 `grep` 은 `rg` 와 다른 집합을 낸다

**`grep` 은 바이너리가 아니라 셸 함수다** — `type grep` 이 그렇게 답한다. 본체가
ugrep 을 이렇게 부른다 (스냅샷 경로는 세션마다 다르므로 못 박지 않는다).

```sh
ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git …
```

`--ignore-files` 의 기본 FILE 은 `.gitignore` 다 (ugrep 도움말
`The default FILE is '.gitignore'.`). 함수가 인자를 안 주므로 **루트 `.ignore` 는
아예 안 읽힌다.** 거기에 `--hidden` 이 붙어 dot 디렉터리까지 본다. 그래서 위
「검색 팁」 첫머리의 「기본 검색이 곧 active 문서 검색」은 `rg` 에만 참이고,
`grep` 은 아래 두 필터 다 `git grep` 과 같은 값을 낸다.

```sh
grep -rl lefthook | /usr/bin/grep -cE '^docs/(archives|explorations)/'    # 7
rg   -l  lefthook | /usr/bin/grep -cE '^docs/(archives|explorations)/'    # 0
git grep -l lefthook 46b3d26c -- docs/archives docs/explorations | wc -l  # 7

grep -rl issue-implement | /usr/bin/grep -c '^\.agents/'    # 2
rg   -l  issue-implement | /usr/bin/grep -c '^\.agents/'    # 0
git grep -l issue-implement 46b3d26c -- .agents | wc -l     # 2
```

값은 2026-08-10 에 `46b3d26c` 를 체크아웃해 잰 것이다 (ugrep 7.5.0 / zsh 5.9).
`git grep` 은 커밋을 인자로 받아 못 박았고, `grep -rl`·`rg -l` 은 워킹트리를 읽어
못 박는다. 두 필터가 이 문서 자신을 빼므로 위 「둘은 근사지 등식이 아니다」의
자기-계수 문제는 여기 없다.

**판별에 쓰는 것은 절대값이 아니라 갈림이고, 갈리는 방향이 어느 함정인지를 말해
준다** — `rg` 보다 **많으면** `.ignore`·dot 디렉터리를 본 것이고, `git grep` 보다
**적으면** `-I` 가 추적 바이너리를 건너뛴 것이다. 위 두 검색어는 `grep` 과
`git grep` 의 파일 집합이 같지만 그것이 일반 성질은 아니다.

```sh
diff <(grep -rl lefthook | sort) <(git grep -l lefthook | sort)   # 차이 0
diff <(grep -rl sql_parser_core | sort) <(git grep -l sql_parser_core | sort)
# > src/lib/sql/wasm/sql_parser_core_bg.wasm — git grep 만 맞힌다 (21 대 22)
```

**가르는 시험은 「제외 대상 자신을 이름으로 주느냐」다** — 「경로를 주느냐」가
아니다. 루트 `.ignore` 는 **상위 경로를 줘도 그대로 걸린다** —
`rg -l lefthook docs/` 가 0 을 내는 것이 그 증거다. 안 걸리는 것은 제외 대상
디렉터리 자신을 이름으로 준 때이고, 루트 `.ignore` 자신의 예시
(`rg <패턴> docs/archives/`)도 그 경우를 말한다.

| 형태 | 함수 `grep` | `rg` | 두 도구가 갈리나 |
|---|---|---|---|
| 경로 없음 | 7 | 0 | 갈린다 |
| 상위 경로 `docs/` | 7 | 0 | 갈린다 |
| 제외 대상 `docs/archives/` | 6 | 6 | 안 갈린다 |

```sh
grep -rl lefthook docs/          | /usr/bin/grep -cE 'docs/(archives|explorations)/'  # 7
rg   -l  lefthook docs/          | /usr/bin/grep -cE 'docs/(archives|explorations)/'  # 0
grep -rl lefthook docs/archives/ | /usr/bin/grep -c .                                 # 6
rg   -l  lefthook docs/archives/ | /usr/bin/grep -c .                                 # 6
```

**두 `grep` 끼리 대조하면 신호가 없다.** 함수 `grep` 과 `command grep`
(=`/usr/bin/grep`)은 이 갈림에서 같은 쪽이다 — 경로를 안 준 형태도 `docs/` 를 준
형태도 둘 다 7 이다. 갈라야 할 상대는 `rg` 다. 이 자리에서 반대 결론이 한 번
나왔다 (#2262).

```sh
grep         -rl lefthook docs/ | /usr/bin/grep -cE 'docs/(archives|explorations)/'  # 7
command grep -rl lefthook docs/ | /usr/bin/grep -cE 'docs/(archives|explorations)/'  # 7
```

**둘째 함정 — `-I` 가 binary 판정 입력을 통째로 건너뛴다.** 거짓 0 보다 나쁘다:
`0` 조차 안 찍고 rc=1 이라 **진짜 0건과 구분이 안 된다.** 커밋 메시지를 `tr` 로
정규화해 `grep -c` 로 세는 자리가 실제로 닿는 경로다 —
`memory/workflow/review/memory.md:57` 과 `.agents/prompts/pr-finalize.md:137`.

```sh
printf 'hello\0world needle here\n' | grep -c needle            # 출력 없음, rc=1
printf 'hello\0world needle here\n' | grep -a -c needle         # 1, rc=0
printf 'hello\0world needle here\n' | command grep -c needle    # 1, rc=0
printf 'hello\0world needle here\n' | /usr/bin/grep -c needle   # 1, rc=0
bash -c 'printf "hello\0world needle here\n" | grep -c needle'  # 1, rc=0
```

**커밋되는 스크립트와 CI 는 두 함정 다 안 물린다.** 근거는 대화형 여부도, 프로필을
읽느냐도 아니다 — **Claude Code 의 Bash 도구가 source 하는 셸 스냅샷**에서 함수가
오고, 직접 띄운 bash·zsh 에는 대화형이든 로그인 셸이든 그 함수가 없다.

```sh
echo "$-"                     # 569JNRXghkl — i 가 없다(비대화형)는데 함수가 있다
/bin/bash -i -c 'type grep'   # /usr/bin/grep — 대화형인데 함수가 없다
/bin/zsh  -lc 'type grep'     # /usr/bin/grep — 로그인 셸로 프로필을 읽는데도 없다
```

**한 줄 판별은 `type grep` 이다** — 셸 함수라고 답하면 물리는 셸이고, 경로를
답하면 안 물린다. 물리는 것은 agent 가 손으로 도는 측정이고, 그 값이 이슈 body ·
PR body · scorecard 로 옮겨진다.

### 변수에 담은 pathspec — zsh 에서 조용히 0건

**이 harness 의 Bash 도구가 띄우는 셸은 zsh 다.** 한 줄로 확인한다.

```sh
echo "ZSH_VERSION=${ZSH_VERSION:-unset}  BASH_VERSION=${BASH_VERSION:-unset}"
# ZSH_VERSION=5.9  BASH_VERSION=unset
```

zsh 는 bash 와 달리 **변수 전개에서 단어 분리를 하지 않는다.** 변수에 담은
pathspec 은 공백까지 통째로 **인자 하나**가 되고, 그런 이름의 경로가 없으니 0건이
나온다. `git grep` 은 매치 안 되는 pathspec 을 조용히 넘겨 **stderr 도 안 낸다.**

아래 재현은 커밋 `f41e0a10` 을 못 박고 돌린 것이다. 이 문서 자신이 검색어를 품고
있어 현재 트리로 돌리면 자기를 세고, 못 박으면 값이 앞으로도 그대로다.

```sh
P="docs/ memory/"
git grep -l "리뷰어" f41e0a10 -- $P            | wc -l   # 0  ← 인자 하나 "docs/ memory/"
git grep -l "리뷰어" f41e0a10 -- docs/ memory/ | wc -l   # 8
git grep -l "리뷰어" f41e0a10 -- ${=P}         | wc -l   # 8
```

**rc 로는 못 가른다.** 변수가 죽어도 rc=1, 진짜 0건도 rc=1 이다.

```sh
git grep -q "리뷰어" f41e0a10 -- $P ; echo $?                            # 1  ← pathspec 이 죽었다
git grep -q "존재하지않는문자열zzzz" f41e0a10 -- docs/ memory/ ; echo $?  # 1  ← 진짜 0건
```

그래서 `... || echo "0건 — 닫혔다"` 형태는 pathspec 이 통째로 죽어도 **통과처럼
보인다.** 그 0건이 「닫혔다」의 증거로 PR body 에 실리면 아무도 못 잡는다. `rg` 는
같은 실수에서 `No such file or directory (os error 2)` 를 stderr 로 내고 rc=2 로
죽어 바로 드러난다 — 조용한 쪽은 `git grep` 이고, 위 「저장소 전수」가 전수 도구로
권하는 것이 그 `git grep` 이다.

**처방: pathspec 은 리터럴로 쓴다.** 위 「저장소 전수」와 그 앞의 레시피들이 그
형태다. 길어서 변수에 담아야 하면 **배열에 담고 `"${PATHS[@]}"` 로 편다** — 원소
하나가 인자 하나로 넘어가 인용이 살고, zsh 와 bash 가 같은 값을 낸다.

**`${=VAR}` 로 때우지 마라 — 단어 분리만 되살리고 인용은 안 살린다.** 문자열에
담은 `':!docs/archives'` 가 따옴표째 경로 이름이 되어 exclude 절이 조용히 죽는다.
아래 네 줄이 배열 20건 · `${=VAR}` 23건 · exclude 를 아예 안 준 값 23건을 나란히
내고, 마지막 `diff` 가 여분 3건이 전부 `docs/{archives,explorations}` 밑임을 짚는다.

```sh
PATHS=(docs/ memory/ .agents/ .claude/ .github/ AGENTS.md CLAUDE.md ':!docs/archives' ':!docs/explorations')
S="docs/ memory/ .agents/ .claude/ .github/ AGENTS.md CLAUDE.md ':!docs/archives' ':!docs/explorations'"
git grep -lniE "리뷰어|reviewer" f41e0a10 -- "${PATHS[@]}" | wc -l    # 20  배열 — exclude 가 산다
git grep -lniE "리뷰어|reviewer" f41e0a10 -- ${=S} | wc -l           # 23  ${=VAR} — exclude 가 죽었다
git grep -lniE "리뷰어|reviewer" f41e0a10 -- docs/ memory/ .agents/ .claude/ .github/ AGENTS.md CLAUDE.md | wc -l   # 23  exclude 를 안 준 값
diff <(git grep -lniE "리뷰어|reviewer" f41e0a10 -- "${PATHS[@]}" | sort) \
     <(git grep -lniE "리뷰어|reviewer" f41e0a10 -- ${=S} | sort)   # `>` 3줄, 전부 archives/explorations
```

`${=VAR}` 는 인용부호가 없는 단순 목록에서만 쓴다 (bash 에는 이 문법이 아예 없다).

**단어 분리를 안 하는 쪽이 zsh 고유이고, 따옴표가 전개를 못 넘기는 쪽은 bash 도
같다.** 위 `S` 를 bash 3.2.57 에서 `-- $S` 로 그냥 펴도 23건이라 exclude 가 똑같이
죽는다. 그러니 "나는 bash 니 변수를 써도 된다" 가 아니다. 배열이 두 셸의 공통
정답이고, 그때도 전개 형태가 갈린다 — `-- "${PATHS[@]}"` 는 zsh · bash 둘 다
20건인데 `-- $PATHS` 는 bash 에서 첫 원소 `docs/` 하나만 넘겨 **rc=0 · stderr
0바이트로 7건**을 낸다. 이 절이 막으려는 바로 그 형태다.

값은 2026-08-07 에 `f41e0a10` 을 못 박고 잰 것이다 (zsh 5.9 / bash 3.2.57 /
git 2.50.1). 판별에 쓰는 것은 절대값이 아니라 **같은 검색어에서 변수형이 리터럴형과
다른 값을 내는가** 다 — 적게 나오면 pathspec 이 죽은 것이고(0 vs 8), 많이 나오면
exclude 가 죽은 것이다(23 vs 20).
