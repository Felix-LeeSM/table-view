---
title: Docs Index
type: index
updated: 2026-05-27
---

# Docs Index

`docs/` 는 사람이 읽는 제품/프로젝트 문서다. Agent 실행 규칙과 협업 룰은
`memory/`, skill 본문은 `.agents/skills/` 에 둔다.

## 빠른 진입

| 찾는 것 | 현재 위치 | 정리 방향 |
|---|---|---|
| 사용법 / 사용자 워크플로우 | future `user-guide/` | 사람용 user guide 로 유지 |
| 제품 범위 / 지원 현황 | `product/README.md`, `product/known-limitations.md`, `query-language-support.md` | 현재 상태는 `product/` / reference |
| 미래 목표 / 순서 후보 | `ROADMAP.md`, `PLAN.md` | `ROADMAP.md` 가 SOT, `PLAN.md` 는 호환 인덱스 |
| 구조 / 설계 | `data-source-architecture.md`, `state-management-strategy-2026-05-15.md` | `architecture/` 로 모으기 |
| 개발 / 검증 / 기여 | `adding-a-data-source.md`, `dialog-conventions.md`, `homebrew-cask.md`, `contributor-guide/` | `developer-guide/` / `contributor-guide/` 로 모으기 |
| 스프린트 산출물 | `sprints/` | 그대로 유지 |
| 과거 기록 | `archives/`, `phases/`, `explorations/`, retired risk registers | `archives/` 아래로 수렴 |

## 유지할 최상위 묶음

- `user-guide/` - 사용자가 제품을 쓰는 법. 필요할 때 신설.
- `product/` - 현재 제품 상태, 사용자 관점 기능, 지원 범위, known limitations.
- `reference/` - 지원 매트릭스, query language, 옵션/프로토콜 reference. 필요할 때 신설.
- `ROADMAP.md` - 미래 목표, 승격 후보, sequencing 기준.
- `PLAN.md` - 기존 링크 호환용 roadmap/product 인덱스.
- `architecture/` - 시스템 구조, 상태 관리, 데이터 소스 설계.
- `developer-guide/` - 로컬 개발 환경, 테스트, 디버깅. 필요할 때 신설.
- `contributor-guide/` - 개발자가 변경을 넣을 때 읽는 절차.
- `sprints/` - sprint contract, evidence, handoff.
- `archives/` - 더 이상 active SOT 가 아닌 기록.

`RISKS.md` 는 독립 active 문서로 유지하지 않는다. 위험/제약은 소유 문서로
라우팅한다:

- 현재 사용자-visible 사실이면 `product/README.md` 또는
  `product/known-limitations.md`.
- 미래 work item 이면 `ROADMAP.md`.
- 구조적 제약이면 `architecture/` 또는 현재 architecture SOT.
- 개발/운영 절차 제약이면 `developer-guide/` 또는 `contributor-guide/`.
- 과거 사건/결정/retired register 는 `archives/`.

## Memory 와 Docs 경계

- `memory/` - agent 가 작업 중 자동으로 읽는 active product/engineering/workflow/runbook 규칙.
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
