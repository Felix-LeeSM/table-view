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
cap 에서 제외한다 (다시 읽을 일이 거의 없음).
cap 은 규율로만 남았고 자동 검사가 없다.

## 유지할 최상위 묶음

- `user-guide/` - 사용자가 제품을 쓰는 법. 필요할 때 신설.
- `product/` - 현재 제품 상태, 사용자 관점 기능, 지원 범위, known limitations.
- `ROADMAP.md` - 미래 목표, 승격 후보, sequencing 기준. 지평 본문은 `roadmap/`.
- `roadmap/` - 지평별 진행 기준(`h1.md`-`h7.md`)과 open follow-up queue.
- `PLAN.md` - 기존 링크 호환용 roadmap/product 인덱스. backlog 나 product
  claim ledger 를 두지 않는다.
- `contributor-guide/` - 개발자가 변경을 넣을 때 읽는 사람용 절차.
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
- 과거 사건/결정/retired register 는 `archives/`.

## Memory 와 Docs 경계

- `memory/` - agent 가 작업 중 직접 열어 읽는 active product/engineering/workflow/runbook 규칙. 자동 로드는 없다.
- `memory/engineering/` - 코드 구조, architecture, convention, fixture, UI 규칙 SOT.
- `docs/archives/decisions/`, `docs/archives/incidents/` - 과거 결정과 사건 기록. 기본 agent memory 탐색 대상이 아니다.
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
2026-08-01 에 다섯 번 돌린 결과(총 100 실행), 나오는 값은 기록 0건 아니면 10건
둘뿐인데 20회 중 0건이 4~10회로 갈렸다 — 비율도 고정이 아니다. 같은 명령에
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
