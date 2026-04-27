---
title: Roadmap
type: memory
updated: 2026-04-27
---

# 로드맵

상세: [docs/PLAN.md](../../docs/PLAN.md)

## 현재 상태

- **Phase 1–4** 완료 (Sprint 24–54 PASS)
- **Phase 5–11** 부분 진행 (Phase 5 Extended Features, Phase 6 MongoDB Sprint 63~66+ 등)
- **Phase 12 완료 (2026-04-27, Sprint 150–155)** — launcher/workspace 별도 `WebviewWindow` + 5 store cross-window IPC sync + 실제 lifecycle wiring. ADR 0011 → 0012 supersede, RISK-025 resolved.

## 다음 Phase (계획 문서)

- **Phase 13** PG preview tab parity + multi-window activation 회귀 진단 — [docs/phases/phase-13.md](../../docs/phases/phase-13.md)
- **Phase 14** Workspace theme toggle — [docs/phases/phase-14.md](../../docs/phases/phase-14.md)
- **Phase 15** Connection group DnD + nested indent — [docs/phases/phase-15.md](../../docs/phases/phase-15.md)
- **Phase 16** Recent connections (MRU) 동작 보장 — [docs/phases/phase-16.md](../../docs/phases/phase-16.md)
- **Phase 17** MySQL 어댑터 — [docs/phases/phase-17.md](../../docs/phases/phase-17.md)
- **Phase 18** MariaDB 어댑터 — [docs/phases/phase-18.md](../../docs/phases/phase-18.md)
- **Phase 19** SQLite 어댑터 — [docs/phases/phase-19.md](../../docs/phases/phase-19.md)
- **Phase 20** Oracle 어댑터 — [docs/phases/phase-20.md](../../docs/phases/phase-20.md)

> Phase 9 (`phase-9.md`)는 임시 스케치 — Phase 17–20이 RDBMS 확장 계획을 승계해 분할.

## Active 작업

현재 스프린트는 [docs/sprints/](../../docs/sprints/)의 최신 번호 디렉토리 참조.
각 스프린트는 `contract.md`(계약) + `execution-brief.md`(실행 지시) + `handoff.md`(결과) 보유.
비-스프린트 개별 커밋으로 선행되는 작업도 있음 (Sprint 62가 예시) — 문서화와 구현이 비동기일 수 있음.

## 판단 기준

"TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

## 관련 방

- [architecture](../architecture/memory.md)
- [decisions](../decisions/memory.md)
