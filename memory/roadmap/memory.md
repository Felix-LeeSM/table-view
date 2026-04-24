---
title: Roadmap
type: memory
updated: 2026-04-24
---

# 로드맵

상세: [docs/PLAN.md](../../docs/PLAN.md)

## 현재 상태

- **Phase 1-4** 완료 (Sprint 24-54 PASS)
- **Phase 5** Extended Features
  - Sprint 55-61 완료
  - Sprint 62 부분 진행: F2.6 View Structure 탭 완료 (`c737692`), 나머지 F-항목 미개시. 공식 `docs/sprints/sprint-62/` 디렉토리 아직 없음.
  - Sprint 61 이후 비-스프린트 개선 다수 (Sidebar mode-toggle, Connection import/export, 비밀번호 masking, Raw query inline edit/delete, View Structure 패널). 상세는 `git log --since=2026-04-19`.

## 다음 Phase (계획 문서만)

- **Phase 6** MongoDB — [docs/phases/phase-6.md](../../docs/phases/phase-6.md) (Sprint 63~66 완료 — 연결/네임스페이스/문서 그리드 P0 읽기 경로까지. 67부터 Quick Look → Find·Aggregate → 편집)
- **Phase 7** Elasticsearch — [docs/phases/phase-7.md](../../docs/phases/phase-7.md)
- **Phase 8** Redis — [docs/phases/phase-8.md](../../docs/phases/phase-8.md)
- **Phase 9** MySQL + SQLite — [docs/phases/phase-9.md](../../docs/phases/phase-9.md) (RDB trait 일반화 선행)

## Active 작업

현재 스프린트는 [docs/sprints/](../../docs/sprints/)의 최신 번호 디렉토리 참조.
각 스프린트는 `contract.md`(계약) + `execution-brief.md`(실행 지시) + `handoff.md`(결과) 보유.
비-스프린트 개별 커밋으로 선행되는 작업도 있음 (Sprint 62가 예시) — 문서화와 구현이 비동기일 수 있음.

## 판단 기준

"TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

## 관련 방

- [architecture](../architecture/memory.md)
- [decisions](../decisions/memory.md)
