# Table View — Master Plan

## 프로젝트 목적

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

**판단 기준**: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

초기 DBMS는 PostgreSQL. 아키텍처는 다중 DBMS 확장을 전제로 설계.

## 현재 상태

Phase 1–4 완료 (Sprint 24–54 PASS). Phase 5–11 부분 진행. **Phase 12 완료(2026-04-27, Sprint 150–155)** — launcher/workspace 별도 `WebviewWindow` + 5 store cross-window IPC sync + 실제 lifecycle wiring + ADR 0011 → 0012 supersede + RISK-025 resolved.

진행 중/대기: **Phase 13** (PG preview tab parity + multi-window activation 회귀 진단), Phase 14 (workspace theme toggle), Phase 15 (connection group DnD + nested indent), Phase 16 (Recent connections 동작 보장), Phase 17–20 (MySQL / MariaDB / SQLite / Oracle 어댑터).

주요 미구현 항목 (이전): 연결 색상 라벨 UI, View Structure 탭(F2.6), Functions CRUD, 즐겨찾기 키워드 바인딩, 결과 분할(F4.8), 패널 관리 시스템(F5.6), Import/Export, SSH 터널링.

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
| 17 | MySQL 어댑터 | 계획 | [phase-17.md](phases/phase-17.md) |
| 18 | MariaDB 어댑터 | 계획 | [phase-18.md](phases/phase-18.md) |
| 19 | SQLite 어댑터 | 계획 | [phase-19.md](phases/phase-19.md) |
| 20 | Oracle 어댑터 | 계획 | [phase-20.md](phases/phase-20.md) |

> Phase 9–11은 본 phase 분할 이전의 임시 스케치(`phase-9.md` 등). Phase 17–20이 phase-9의 RDBMS 확장 계획을 승계해 분할.

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
