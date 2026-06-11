---
title: Docs Index
type: index
updated: 2026-05-28
---

# Docs Index

`docs/` 는 사람이 읽는 제품/프로젝트 문서다. Agent 실행 규칙과 협업 룰은
`memory/`, skill 본문은 `.agents/skills/` 에 둔다.

## 빠른 진입

| 찾는 것 | 현재 위치 | 정리 방향 |
|---|---|---|
| 사용법 / 사용자 워크플로우 | future `user-guide/` | 사람용 user guide 로 유지 |
| 제품 범위 / 지원 현황 | `product/README.md`, `product/known-limitations.md`, `product/query-language-support.md` | 현재 상태는 `product/` |
| 미래 목표 / 순서 후보 | `ROADMAP.md`, `PLAN.md` | `ROADMAP.md` 가 SOT, `PLAN.md` 는 호환 인덱스 |
| GitHub milestone / issue 실행 상태 | GitHub milestones/issues, `ROADMAP.md` 요약 | 실행 bucket 은 GitHub, 순서/경계 요약은 `ROADMAP.md` |
| 구조 / 설계 규칙 | `memory/engineering/architecture/**` | agent 가 적용해야 하는 active engineering SOT |
| 개발 / 검증 / 기여 | `contributor-guide/`, `memory/engineering/**` | 사람용 절차는 docs, 코딩 규칙은 memory |
| 스프린트 산출물 | `sprints/` | 그대로 유지 |
| 과거 기록 | `archives/`, retired risk registers, historical `explorations/` | `archives/` 아래로 수렴 |

## 유지할 최상위 묶음

- `user-guide/` - 사용자가 제품을 쓰는 법. 필요할 때 신설.
- `product/` - 현재 제품 상태, 사용자 관점 기능, 지원 범위, known limitations.
- `ROADMAP.md` - 미래 목표, 승격 후보, sequencing 기준.
- `PLAN.md` - 기존 링크 호환용 roadmap/product 인덱스. backlog 나 product
  claim ledger 를 두지 않는다.
- `contributor-guide/` - 개발자가 변경을 넣을 때 읽는 사람용 절차.
- `sprints/` - sprint contract, evidence, handoff.
- `archives/` - 더 이상 active SOT 가 아닌 기록.
- `phases/` - active phase planning 만 둔다. 보류/완료/비활성 phase 는
  `archives/phases/` 로 이동한다.

`RISKS.md` 는 독립 active 문서로 유지하지 않는다. 위험/제약은 소유 문서로
라우팅한다:

- 현재 사용자-visible 사실이면 `product/README.md` 또는
  `product/known-limitations.md`.
- 미래 work item 이면 `ROADMAP.md`.
- 구조적 제약이면 `memory/engineering/architecture/**`.
- 개발/운영 절차 제약이면 `memory/engineering/**` 또는 `contributor-guide/`.
- 과거 사건/결정/retired register 는 `archives/`.

## Memory 와 Docs 경계

- `memory/` - agent 가 작업 중 자동으로 읽는 active product/engineering/workflow/runbook 규칙.
- `memory/engineering/` - 코드 구조, architecture, convention, fixture, UI 규칙 SOT.
- `docs/archives/decisions/`, `docs/archives/incidents/` - 과거 결정과 사건 기록. 기본 agent memory 탐색 대상이 아니다.
- `.agents/skills/` - agent skill 본문과 slash command source.
- `docs/` - 사람이 탐색하는 제품/프로젝트 문서와 sprint evidence.

같은 내용을 둘 이상에 복제하지 않는다. 한쪽에 본문을 두고 다른 쪽은 링크만 둔다.

## 검색 팁

Active 문서만 먼저 볼 때:

```sh
rg --glob '!docs/sprints/**' --glob '!docs/archives/**' --glob '!docs/phases/**' '<term>' docs README.md AGENTS.md
```

스프린트 evidence 까지 포함할 때:

```sh
rg '<term>' docs memory README.md AGENTS.md
```
