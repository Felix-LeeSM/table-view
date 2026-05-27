---
title: Docs Index
type: index
updated: 2026-05-27
---

# Docs Index

`docs/` 는 사람이 읽는 제품/프로젝트 문서다. Agent 실행 규칙과 협업 룰은
`memory/`, slash command / skill 본문은 `.agents/skills/` 에 둔다.

## 빠른 진입

| 찾는 것 | 현재 위치 | 정리 방향 |
|---|---|---|
| 제품 범위 / 지원 현황 | `query-language-support.md`, `table_plus/` | `product/` 로 모으기 |
| 계획 / 순서 | `PLAN.md`, `ROADMAP.md` | `roadmap/` 로 모으되 `PLAN.md` 호환 경로 유지 |
| 구조 / 설계 | `data-source-architecture.md`, `state-management-strategy-2026-05-15.md` | `architecture/` 로 모으기 |
| 기여자 가이드 | `adding-a-data-source.md`, `dialog-conventions.md`, `homebrew-cask.md` | `contributor-guide/` 로 모으기 |
| 리스크 / 감사 follow-up | `RISKS.md` | 별도 유지 권장 |
| 스프린트 산출물 | `sprints/` | 그대로 유지 |
| 과거 기록 | `archives/`, `phases/`, `explorations/` | `archives/` 아래로 수렴 |

## 유지할 최상위 묶음

- `product/` - 사용자 관점 기능, 지원 범위, 제품 동작.
- `roadmap/` - 계획, 단계, sequencing. 현재 `docs/PLAN.md` 는 호환 entry 로 유지.
- `architecture/` - 시스템 구조, 상태 관리, 데이터 소스 설계.
- `contributor-guide/` - 개발자가 변경을 넣을 때 읽는 절차.
- `sprints/` - sprint contract, evidence, handoff.
- `archives/` - 더 이상 active SOT 가 아닌 기록.
- `RISKS.md` - 계획과 별도로 추적할 리스크. 별도 유지가 검색과 리뷰에 더 낫다.

## Memory 와 Docs 경계

- `memory/` - agent 가 작업 중 자동으로 읽는 압축 규칙, ADR, lesson, runbook.
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
