---
title: Roadmap
type: memory
updated: 2026-05-16
---

# 로드맵

상세: [docs/PLAN.md](../../docs/PLAN.md). 비교 근거:
[docs/archives/product-snapshots/tableplus-comparison-2026-05-01.md](../../docs/archives/product-snapshots/tableplus-comparison-2026-05-01.md).

## 방향 (2026-05-01)

**TablePlus 패리티 우선, 신규 DBMS 추가는 보류.** Phase 17–20
(MySQL/MariaDB/SQLite/Oracle) 은 패리티 7단계 (Phase 21–27) 종료까지 보류.

## 현재 상태

- **Phase 1–4** 완료 (Sprint 24–54 PASS)
- **Phase 5–11** 부분 진행 (Phase 5 Extended Features, Phase 6 MongoDB)
- **Phase 12 완료 (2026-04-27, Sprint 150–155)** — launcher/workspace
  split, ADR 0012, RISK-025 resolved.
- **Phase 21–27 (TablePlus 패리티 7단계) 종료 (2026-05-13, Sprint 237
  closure)** — Sprint 226 CREATE TABLE → Sprint 237 Column MODIFY USING
  - NULL-rows 사전 표시까지 7단계 모두 마감. TablePlus
    `working-with-table/{table,column,row,constraint,index,trigger}` 6
    surface 의 동등 워크플로우 도달. 회고:
    [`memory/lessons/parity-milestone/2026-05-13-tableplus-parity-phase-27-closure/memory.md`](../lessons/parity-milestone/2026-05-13-tableplus-parity-phase-27-closure/memory.md).
- **Phase 17–20 재개 평가 트리거 발동 (2026-05-13)** — Phase 27 종료
  exit criterion 에 따라 신규 DBMS 추가 비용/가치 재산정 시점.
- **Phase 13–16 retroactive closure (2026-05-14)** — audit 결과 모두
  코드 wired. 13/16 은 sprint-160/168 에서 closure 완료, 14/15 는
  contract 만 디렉토리에 잔존해 묻혀 있던 phase 로 retroactive handoff
  추가.
- **State-management 이주 sprint 분할 (2026-05-16, Sprint 353–376)** —
  `docs/state-management-strategy-2026-05-15.md` (11회 codex 외부 검토 0
  findings 수렴) 의 Phase 0~6 AC + Part F.1~F.6 wire contract 를 24
  sprint 단위로 split. contract.md 24개 작성 + 4회 codex 5.5 medium
  consistency review. 상세는 본 문서 아래 [State-management 이주
  sequencing] 섹션.

## 작업 순서 (Impact 큰 순) — Phase 21–27

| #   | Phase                                                                                                   | 실제 sprint                    | 핵심                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| 1   | [Phase 21](../../docs/archives/phases/completed/phase-21.md) CSV/SQL/JSON Export                        | 181                            | 단판승, 의존 0                                                                          |
| 2   | [Phase 22](../../docs/archives/phases/completed/phase-22.md) Row 인라인 + Preview/Commit/Discard 게이트 | 182–184                        | **#3~#7 공통 인프라**                                                                   |
| 3   | [Phase 23](../../docs/archives/phases/completed/phase-23.md) Safe Mode                                  | **종료 (185–188)**             | production 가드 + Mongo aggregate 가드 + `useSafeModeGate`                              |
| 4   | [Phase 24](../../docs/archives/phases/completed/phase-24.md) Index Write UI                             | **종료 (226–229)**             | CREATE/Drop INDEX + create_table_plan                                                   |
| 5   | [Phase 25](../../docs/archives/phases/completed/phase-25.md) Constraint Write UI                        | **종료 (229–230)**             | PK/FK/UNIQUE/CHECK + ON DELETE/UPDATE whitelist                                         |
| 6   | [Phase 26](../../docs/archives/phases/completed/phase-26.md) Trigger 관리                               | **종료 (272–275)**             | list/create/drop trigger + WHEN/EXECUTE FUNCTION                                        |
| 7   | [Phase 27](../../docs/archives/phases/completed/phase-27.md) Table/Column DDL UI                        | **종료 (226–237, 2026-05-13)** | **패리티 마일스톤 달성** — Sprint 237 closure 가 USING + NULL-rows 사전 표시까지 마무리 |

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

## State-management 이주 sequencing (Sprint 353–376, 24 sprint, 2026-05-16)

기준 문서: [`docs/state-management-strategy-2026-05-15.md`](../../docs/state-management-strategy-2026-05-15.md)
(11회 codex 외부 검토 0 findings 수렴) + [`docs/archives/audits/code-smell-audit-2026-05-15.md`](../../docs/archives/audits/code-smell-audit-2026-05-15.md).
contract.md 24개 작성 + 4회 codex 5.5 medium consistency review.

| Phase | Sprints  | 핵심                                                                                                                          |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0     | 353, 354 | dehydration (Q16~Q19, Q19 cap 25) + counter seed + L2 schemaStore retire                                                      |
| 1     | 355–358  | SQLite 9 table + Q22 keyring file-key 3 path + F.2 snapshot + dual-write                                                      |
| 2     | 359, 360 | 탭 affinity (Q5.1–Q5.6) + introspection_pool + Q23 self-window invalidate                                                     |
| 3     | 361–365  | window label per-conn + single-instance + Q13 same-conn focus + ConnectionStatus 확장 + cross-window `state-changed` 9 domain |
| 4     | 366–370  | hook + snapshot hydration + Q12 theme/safeMode + Q20 datagrid prefs (non-store LS 5 site retire) + W2→W3 gate                 |
| 5     | 371–373  | query history backend (Q5 privacy + VACUUM 분리 + discriminated union) + frontend + queryHistoryStore retire                  |
| 6     | 374–376  | ADR 0032–0042 commit + cleanup (session-storage rename / `.legacy.json` cron) + Q21 reset-to-default UI 9 affordance          |

의존성 그래프 (병렬 가능 묶음) 와 sprint 단위 목적은
[`docs/PLAN.md`](../../docs/PLAN.md) "State management 이주" 섹션이
authoritative. 각 contract.md 는 In Scope ≤ 5 파일군, AC ≤ 12, TDD
red→green 명시.

## 진행 중 / 대기 / 보류

- **Phase 13–17 종료 (2026-05-14 audit)** — 작업이 phase 미식별 sprint 들에
  묻혀 진행됐다. closure 매핑:
  - [Phase 13](../../docs/archives/phases/completed/phase-13.md) — Sprint 160 closure (2026-
    04-28). Connection 활성화 회귀 + PG/Mongo preview-tab parity.
  - [Phase 14](../../docs/archives/phases/completed/phase-14.md) — Sprint 162 closure
    (retrospective 2026-05-14). Workspace ThemePicker + `Cmd+Shift+L`
    단축키.
  - [Phase 15](../../docs/archives/phases/completed/phase-15.md) — Sprint 164 closure
    (retrospective 2026-05-14). Native HTML5 DnD 로 connection group
    이동 + nested indent + collapse persist (`@dnd-kit` 미도입).
  - [Phase 16](../../docs/archives/phases/completed/phase-16.md) — Sprint 168 closure
    (2026-04-29). MRU 리스트 + RecentConnections + cross-window sync.
  - [Phase 17](../../docs/archives/phases/completed/phase-17.md) — Sprint 296 closure
    (retrospective 2026-05-14). MysqlAdapter Slice A–G + ADR 0028 +
    testcontainers gate 합류 (coverage 84.23/79.74/85.66).
- 보류 (2026-05-01, 재평가 대기):
  [18](../../docs/phases/phase-18.md), [19](../../docs/phases/phase-19.md),
  [20](../../docs/phases/phase-20.md). Phase 27 종료 (2026-05-13) 로
  재개 평가 트리거 발동.
- **Phase 28 (MongoDB Full Support) 계획 (2026-05-14)** — grill-me
  세션으로 카테고리 20+ 결정 lock. 13 slice (A–M). 정의서
  [`docs/phases/phase-28.md`](../../docs/phases/phase-28.md), 결정 dict
  [phase-28-mongo-full-support](./phase-28-mongo-full-support/memory.md).
- **Phase 29 후보 — RDB+Mongo Unified Followups** — U1 server activity
  / U2 explain viewer / U3 stats 탭 / U4 server info / U5 slow query/
  profiler. Phase 28 종료 후 진입.
  [unified-followups](./unified-followups/memory.md).
- **Phase 30 후보 — 보안 surface** — Q30 (user/role), Q31 (auth
  mechanism) 은 threat-model 핸드오프 후 grill 재개.

## Active 작업

현재 스프린트는 [docs/sprints/](../../docs/sprints/)의 최신 번호 디렉토리.
각 스프린트는 `contract.md` + `execution-brief.md` + `handoff.md` 보유.
비-스프린트 개별 커밋도 있음 (Sprint 62가 예시) — 문서화와 구현이 비동기일 수 있음.

## 판단 기준

"TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

## 관련 방

- [architecture](../architecture/memory.md)
- [decisions](../decisions/memory.md)
