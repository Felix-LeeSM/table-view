---
title: Docs Index
type: index
updated: 2026-05-28
---

# Docs Index

`docs/` 는 사람이 읽는 제품/프로젝트 문서다. Agent 실행 규칙과 협업 룰은
`memory/` 에 둔다. skill 본문(`.agents/skills/`)은 #2033 에서 삭제됐다.

## 빠른 진입

| 찾는 것 | 현재 위치 | 정리 방향 |
|---|---|---|
| 사용법 / 사용자 워크플로우 | future `user-guide/` | 사람용 user guide 로 유지 |
| 제품 범위 / 지원 현황 | `product/README.md`, `product/known-limitations.md`, `product/query-language-support.md` | 현재 상태는 `product/` |
| 미래 목표 / 순서 후보 | `ROADMAP.md`, `roadmap/`, `PLAN.md` | `ROADMAP.md` 가 index SOT, 지평 본문과 follow-up queue 는 `roadmap/`, `PLAN.md` 는 호환 인덱스 |
| GitHub milestone / issue 실행 상태 | GitHub milestones/issues, `ROADMAP.md` 요약 | 실행 bucket 은 GitHub, 순서/경계 요약은 `ROADMAP.md` |
| 구조 / 설계 규칙 | `memory/engineering/architecture/**` | agent 가 적용해야 하는 active engineering SOT |
| 개발 / 검증 / 기여 | `contributor-guide/`, `memory/engineering/**` | 사람용 절차는 docs, 코딩 규칙은 memory |
| 스프린트 산출물 | `sprints/` | 그대로 유지 |
| 과거 기록 | `archives/`, retired risk registers, historical `explorations/` | `archives/` 아래로 수렴 |

## 분량 cap

지속 참조 문서(`product/`, `contributor-guide/`, `roadmap/`, `ROADMAP.md`,
`quality/`, `phases/`, docs root)는 120,000 chars 분량 cap 을 둔다 — agent 가
읽을 때 context 부하를 가두기 위함. 일회성 산출물(`sprints/`, `archives/`,
`table_plus/`, `explorations/`)은 cap 에서 제외한다 (다시 읽을 일이 거의 없음).
검사하던 `check-doc-size.sh` 는 #2033 에서 삭제됐다 — cap 은 규율로만 남았고 자동 검사가 없다.

## 유지할 최상위 묶음

- `user-guide/` - 사용자가 제품을 쓰는 법. 필요할 때 신설.
- `product/` - 현재 제품 상태, 사용자 관점 기능, 지원 범위, known limitations.
- `ROADMAP.md` - 미래 목표, 승격 후보, sequencing 기준. 지평 본문은 `roadmap/`.
- `roadmap/` - 지평별 진행 기준(`h1.md`-`h7.md`)과 open follow-up queue.
- `PLAN.md` - 기존 링크 호환용 roadmap/product 인덱스. backlog 나 product
  claim ledger 를 두지 않는다.
- `contributor-guide/` - 개발자가 변경을 넣을 때 읽는 사람용 절차.
- `sprints/` - sprint contract, evidence, handoff.
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

- `memory/` - agent 가 작업 중 자동으로 읽는 active product/engineering/workflow/runbook 규칙.
- `memory/engineering/` - 코드 구조, architecture, convention, fixture, UI 규칙 SOT.
- `docs/archives/decisions/`, `docs/archives/incidents/` - 과거 결정과 사건 기록. 기본 agent memory 탐색 대상이 아니다.
- `docs/` - 사람이 탐색하는 제품/프로젝트 문서와 sprint evidence.

같은 내용을 둘 이상에 복제하지 않는다. 한쪽에 본문을 두고 다른 쪽은 링크만 둔다.

## 검색 팁

루트의 `.ignore` 가 `docs/{sprints,archives,table_plus,explorations}` 를 빼 두므로
기본 검색이 곧 active 문서 검색이다:

```sh
rg '<term>' docs memory README.md AGENTS.md
```

과거 기록까지 볼 때는 `--no-ignore-dot` 을 붙이거나 그 디렉터리를 직접 지정한다.
직접 지정이 더 안전하다 — 아래 주의 참조.

```sh
rg '<term>' docs/sprints docs/archives          # 기록만
rg --no-ignore-dot '<term>' docs memory README.md AGENTS.md   # active + 기록
```

**주의 — 루트를 둘 이상 주면 ignore 적용이 비결정적이다.** 병렬 walker 경합이라
같은 명령이 실행마다 다른 결과를 낸다 (실측: 10회 중 5회 0건, 5회 53건). 전수
주장의 근거로 쓸 명령이면 `-j1` 을 붙이거나 루트를 하나만 줘라.

```sh
rg -j1 '<term>' docs memory README.md AGENTS.md
```
