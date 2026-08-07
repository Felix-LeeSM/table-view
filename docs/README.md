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

지속 참조 문서(`product/`, `contributor-guide/`, `roadmap/`, `ROADMAP.md`,
`phases/`, docs root)는 120,000 chars 분량 cap 을 둔다 — agent 가
읽을 때 context 부하를 가두기 위함. 일회성 산출물(`archives/`, `explorations/`)은
cap 에서 제외한다 (다시 읽을 일이 거의 없음). `decisions/` 도 제외한다 — cap 은 살아
있는 산문이 비대해지는 것을 막는 장치인데 ADR 본문은 동결이라 줄일 수 없다.
`archives/` 밑에 있던 시절에도 cap 밖이었지만 그때 사유는 동결이 아니라 `archives/`
포괄 제외, 곧 재독 빈도였다.
cap 은 규율로만 남았고 자동 검사가 없다.

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

루트의 `.ignore` 가 `docs/{archives,explorations}` 를 빼 두므로
기본 검색이 곧 active 문서 검색이다. 단 루트를 둘 이상 주는 형태라
`-j1` 이 함께 붙어야 한다 — 이유는 아래 주의를 보라.

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
