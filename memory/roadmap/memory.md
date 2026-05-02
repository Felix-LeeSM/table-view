---
title: Roadmap
type: memory
updated: 2026-05-01
---

# 로드맵

상세: [docs/PLAN.md](../../docs/PLAN.md). 비교 근거:
[docs/tableplus-comparison.md](../../docs/tableplus-comparison.md).

## 방향 (2026-05-01)

**TablePlus 패리티 우선, 신규 DBMS 추가는 보류.** Phase 17–20
(MySQL/MariaDB/SQLite/Oracle) 은 패리티 7단계 (Phase 21–27) 종료까지 보류.

## 현재 상태

- **Phase 1–4** 완료 (Sprint 24–54 PASS)
- **Phase 5–11** 부분 진행 (Phase 5 Extended Features, Phase 6 MongoDB)
- **Phase 12 완료 (2026-04-27, Sprint 150–155)** — launcher/workspace
  split, ADR 0012, RISK-025 resolved.

## 작업 순서 (Impact 큰 순) — Phase 21–27

| # | Phase | 실제 sprint | 핵심 |
|---|-------|-------------|------|
| 1 | [Phase 21](../../docs/phases/phase-21.md) CSV/SQL/JSON Export | 181 | 단판승, 의존 0 |
| 2 | [Phase 22](../../docs/phases/phase-22.md) Row 인라인 + Preview/Commit/Discard 게이트 | 182–184 | **#3~#7 공통 인프라** |
| 3 | [Phase 23](../../docs/phases/phase-23.md) Safe Mode | **종료 (185–188)** | production 가드 + Mongo aggregate 가드 + `useSafeModeGate` |
| 4 | [Phase 24](../../docs/phases/phase-24.md) Index Write UI | 미정 | DDL 패턴 첫 검증 |
| 5 | [Phase 25](../../docs/phases/phase-25.md) Constraint Write UI | 미정 | 동일 패턴 확장 |
| 6 | [Phase 26](../../docs/phases/phase-26.md) Trigger 관리 | 미정 | Function 옵션 |
| 7 | [Phase 27](../../docs/phases/phase-27.md) Table/Column DDL UI | 미정 | 패리티 마일스톤 |

## Sprint 189–198 sequencing (refactoring + feature 인터리브, 종료 2026-05-02)

홀수 sprint = refactor-only, 짝수 = feature/FB. 각 refactor 가 바로 다음
feature sprint 의 dependency 를 정리하는 패턴으로 진행, 2026-05-02
Sprint 198 종료로 sequencing 완료.

189 (closure refactor) → 190 (FB-1b prod-auto) → 191 (SchemaTree 분해) →
192 (FB-3 export) → 193 (useDataGridEdit 분해) → 194 (FB-4 Quick Look) →
195 (tabStore intent) → 196 (FB-5b history source) → 197 (mongodb.rs 분할)
→ 198 (Mongo bulk-write — Phase 신설 안 함, Phase 24 명명 충돌 회피).

각 sprint 의 결정 / AC / handoff 는 `docs/sprints/sprint-189` ~
`sprint-198` 의 `contract.md` / `findings.md` / `handoff.md`. 코드 표준은
[conventions/refactoring](../conventions/refactoring/memory.md).

## 진행 중 / 대기 / 보류

- 진행/대기: [13](../../docs/phases/phase-13.md), [14](../../docs/phases/phase-14.md),
  [15](../../docs/phases/phase-15.md), [16](../../docs/phases/phase-16.md).
- 보류 (2026-05-01): [17](../../docs/phases/phase-17.md),
  [18](../../docs/phases/phase-18.md), [19](../../docs/phases/phase-19.md),
  [20](../../docs/phases/phase-20.md). Phase 27 종료 시 재개 평가.

## Active 작업

현재 스프린트는 [docs/sprints/](../../docs/sprints/)의 최신 번호 디렉토리.
각 스프린트는 `contract.md` + `execution-brief.md` + `handoff.md` 보유.
비-스프린트 개별 커밋도 있음 (Sprint 62가 예시) — 문서화와 구현이 비동기일 수 있음.

## 판단 기준

"TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

## 관련 방

- [architecture](../architecture/memory.md)
- [decisions](../decisions/memory.md)
