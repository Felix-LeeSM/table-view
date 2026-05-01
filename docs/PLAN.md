# Table View — Master Plan

## 프로젝트 목적

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

**판단 기준**: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

초기 DBMS는 PostgreSQL. 아키텍처는 다중 DBMS 확장을 전제로 설계.

## 현재 상태

Phase 1–4 완료 (Sprint 24–54 PASS). Phase 5–11 부분 진행. **Phase 12 완료(2026-04-27, Sprint 150–155)** — launcher/workspace 별도 `WebviewWindow` + 5 store cross-window IPC sync + 실제 lifecycle wiring + ADR 0011 → 0012 supersede + RISK-025 resolved.

진행 중/대기: **Phase 13** (PG preview tab parity + multi-window activation 회귀 진단), Phase 14 (workspace theme toggle), Phase 15 (connection group DnD + nested indent), Phase 16 (Recent connections 동작 보장).

## 방향 결정 (2026-05-01)

**TablePlus 패리티 우선, 신규 DBMS 추가는 보류.** PostgreSQL + MongoDB 두 패러다임 위에서 TablePlus의 데일리 워크플로(grid export · row inline edit · DDL UI · Safe Mode)를 닫는 것이 최우선. **Phase 17–20 (MySQL / MariaDB / SQLite / Oracle 어댑터)은 패리티 달성 이후 재개**한다 (`보류` 상태).

### 작업 순서 (Impact 큰 순) — Phase 21–27

1. **Phase 21** — CSV / SQL / JSON Export (단판승)
2. **Phase 22** — Row 인라인 편집 RDB 완성 + Preview/Commit/Discard 게이트 (#3~#7 의 공통 인프라)
3. **Phase 23** — Safe Mode (프로덕션 가드)
4. **Phase 24** — Index Write UI
5. **Phase 25** — Constraint Write UI
6. **Phase 26** — Trigger 관리
7. **Phase 27** — Table / Column DDL UI (패리티 달성 마일스톤)

근거: [`docs/tableplus-comparison.md`](tableplus-comparison.md) Section H/I.

### 사용자 피드백 후속 작업 (2026-05-01 채집)

Sprint 187 직후 사용자 피드백 5건 분석. UI 폴리시 (info popover / 색깔 정리
/ history 진입점) 는 비-스프린트 hotfix 한 commit 으로 즉시 반영 — 별도
sprint 등록 불필요. 나머지 4건은 신규 sprint 로 분할:

| ID | 항목 | 소속 | 우선 sprint 후보 |
|----|------|------|------------------|
| FB-1b | production 환경 자동 SafeMode 활성화 (Hard auto 정책) | Phase 23 closure 후 | Sprint 190 |
| FB-3  | DB 단위 export (`pg_dump` / `mongodump` equivalent + Sidebar 진입점) | Phase 21 후속 | Sprint 192 |
| FB-4  | Quick Look 편집 모드 (`useDataGridEdit` 와 합류) | Phase 22 후속 | Sprint 194 |
| FB-5b | Query history source 필드 + 범위 확장 (raw / grid-edit / ddl-structure / mongo-* 통합 audit) | Phase 23 후속 | Sprint 196 |

각 항목은 진입 sprint 작성 시 별 contract 로 옮겨 ADR / AC 세분화. 본 표는
Phase 23 (Sprint 188 = Mongo dangerous-op) 종료 후 우선순위 재평가의 1차
입력값이다.

### 리팩토링 sequencing (Sprint 189–198)

Phase 23 종료 직후 Sprint 189–198 의 10단계는
[`docs/refactoring-plan.md`](refactoring-plan.md) 와 1:1 동기. refactor-only
sprint (홀수) 와 feature/FB sprint (짝수) 를 인터리브하여 각 refactor 가
바로 다음 feature sprint 의 dependency 를 정리한다.

| # | Sprint | 종류 | 내용 |
|---|--------|------|------|
| 1 | 189 | refactor | Phase 23 closure — RDB 5 사이트 inline gate → `useSafeModeGate` |
| 2 | 190 | feature  | FB-1b production 환경 자동 SafeMode |
| 3 | 191 | refactor | SchemaTree 분해 (Sprint 192 export entry-point 의존) |
| 4 | 192 | feature  | FB-3 DB 단위 export |
| 5 | 193 | refactor | `useDataGridEdit` 분해 (Sprint 194 Quick Look 편집 의존) |
| 6 | 194 | feature  | FB-4 Quick Look 편집 |
| 7 | 195 | refactor | `tabStore` intent actions (Sprint 196 history source 필드 의존) |
| 8 | 196 | feature  | FB-5b query history source 필드 |
| 9 | 197 | refactor | `mongodb.rs` 4분할 (Sprint 198 bulk-write 신규 명령 의존) |
| 10 | 198 | feature | Mongo bulk-write 신규 (`delete_many` / `update_many` / `drop_collection`). **Phase 신설 안 함** — Phase 24 = Index Write UI 와 명명 충돌 회피 위해 sprint 단위로 처리. |

코드 작성 표준: [`memory/conventions/refactoring/memory.md`](../memory/conventions/refactoring/memory.md) (영속).
원본 smell 카탈로그: [`docs/refactoring-smells.md`](refactoring-smells.md) (시한부).

## 문서 목차

| 문서 | 설명 |
|------|------|
| [Architecture](architecture.md) | 시스템 구조, DB driver 추상화, 기술 결정 |
| [RISKS](RISKS.md) | 잔여 위험 등록부 (20개 항목, 상태 추적) |
| [Sprints](sprints/README.md) | harness sprint 실행 산출물 |

## 구현 계획

| Phase | 내용 | 상태 | 상세 |
|-------|------|------|------|
| 1 | Foundation (연결 관리) | 완료 | [phase-1.md](phases/phase-1.md) |
| 2 | Schema & Data Exploration | 완료 | [phase-2.md](phases/phase-2.md) |
| 3 | Query Editor | 완료 | [phase-3.md](phases/phase-3.md) |
| 4 | Editing & Polish | 완료 | [phase-4.md](phases/phase-4.md) |
| 5 | Extended Features | 진행 중 | [phase-5.md](phases/phase-5.md) |
| 6 | MongoDB 지원 | 계획 | [phase-6.md](phases/phase-6.md) |
| 7 | Elasticsearch 지원 | 계획 | [phase-7.md](phases/phase-7.md) |
| 8 | Redis 지원 | 계획 | [phase-8.md](phases/phase-8.md) |
| 12 | Multi-window split (launcher/workspace) | 완료 | [phase-12.md](phases/phase-12.md) |
| 13 | PG preview tab parity + multi-window activation 회귀 진단 | 계획 | [phase-13.md](phases/phase-13.md) |
| 14 | Workspace theme toggle | 계획 | [phase-14.md](phases/phase-14.md) |
| 15 | Connection group DnD + nested indent | 계획 | [phase-15.md](phases/phase-15.md) |
| 16 | Recent connections (MRU) 동작 보장 | 계획 | [phase-16.md](phases/phase-16.md) |
| 17 | MySQL 어댑터 | **보류** (2026-05-01) | [phase-17.md](phases/phase-17.md) |
| 18 | MariaDB 어댑터 | **보류** (2026-05-01) | [phase-18.md](phases/phase-18.md) |
| 19 | SQLite 어댑터 | **보류** (2026-05-01) | [phase-19.md](phases/phase-19.md) |
| 20 | Oracle 어댑터 | **보류** (2026-05-01) | [phase-20.md](phases/phase-20.md) |
| 21 | CSV / SQL / JSON Export | 계획 (Sprint 181) | [phase-21.md](phases/phase-21.md) |
| 22 | Row 인라인 편집 RDB + Preview/Commit/Discard 게이트 | 계획 | [phase-22.md](phases/phase-22.md) |
| 23 | Safe Mode (프로덕션 가드) | 종료 (Sprint 185–188, 2026-05-01) | [phase-23.md](phases/phase-23.md) |
| 24 | Index Write UI | 계획 | [phase-24.md](phases/phase-24.md) |
| 25 | Constraint Write UI | 계획 | [phase-25.md](phases/phase-25.md) |
| 26 | Trigger 관리 | 계획 | [phase-26.md](phases/phase-26.md) |
| 27 | Table / Column DDL UI | 계획 | [phase-27.md](phases/phase-27.md) |

> Phase 9–11은 본 phase 분할 이전의 임시 스케치(`phase-9.md` 등). Phase 17–20이 phase-9의 RDBMS 확장 계획을 승계해 분할 — 2026-05-01 결정으로 패리티 달성 시까지 보류. Phase 21–27 이 그 자리를 차지하고, 본 7단계 종료 시점에 Phase 17–20 재개를 재평가.

## TDD / E2E 정책 (Phase 13 이후)

- **TDD strict**: 각 sprint 진입 시 `docs/sprints/sprint-N/tdd-evidence/red-state.log` 캡처 또는 commit 순서로 red→green TDD 흔적 보존.
- **Skip-zero gate**: phase 종료 시 모든 touched 파일에서 `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip` 0건. 부득이 deferred 시 (a) RISK-NNN 또는 ADR 식별자 메모리 등록, (b) skip 직전 `[DEFERRED-<ID>]` 주석 + 동치 커버리지 경로 + 재진입 트리거 명시 — `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md` 참조.
- **Verification 4-set**: 매 sprint 종료 직전 `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, 필요 시 `cargo build --manifest-path src-tauri/Cargo.toml` 모두 exit 0.
- **E2E 정책**: Phase 13에서 Playwright + tauri-driver 기반 e2e suite 정착. CI에서 별도 job으로 운영 (vitest와 분리). 주요 시나리오는 phase-별 `E<phase>-NN` 형식으로 ID 부여, `e2e/` 디렉토리에 `<scenario>.spec.ts` 형식. Phase 13 closure 시 e2e 운영 결정 ADR 후보.
- **ADR 동결**: trade-off 있는 결정은 작성 순간 본문 동결. 후속 결정은 새 ADR + supersede chain.

## 참고 자료

- [TablePlus 문서](table_plus/) — 63개 참고 문서
- Tauri 2.0 가이드: https://v2.tauri.app/
- sqlx 문서: https://docs.rs/sqlx
