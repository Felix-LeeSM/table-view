---
title: ADR 인덱스
type: index
updated: 2026-05-28
---

# ADR 인덱스

Archived ADRs are historical context. Current service state and direction should
be read from `docs/product/README.md` and `docs/ROADMAP.md` first.

## Accepted Decisions

| ID                                                                                   | 제목                                                                                          | 상태     | 날짜       | Supersedes |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------- | ---------- | ---------- |
| [0001](./0001-desktop-stack-tauri-sqlx/memory.md)                                    | 데스크톱 스택: Tauri v2 + sqlx                                                                | Accepted | 2026-01-01 | —          |
| [0002](./0002-global-state-zustand/memory.md)                                        | 전역 상태: Zustand 채택                                                                       | Accepted | 2026-01-01 | —          |
| [0003](./0003-multi-connection-focused-id/memory.md)                                 | 다중 connection: focusedConnId store 승격                                                     | Accepted | 2026-04-20 | —          |
| [0004](./0004-sidebar-connection-schema-mode-toggle/memory.md)                       | Sidebar Connections/Schemas 모드 토글                                                         | Accepted | 2026-04-20 | —          |
| [0005](./0005-plaintext-password-never-leaves-backend/memory.md)                     | plaintext 비밀번호는 IPC 경계를 넘지 않는다                                                   | Accepted | 2026-04-20 | —          |
| [0006](./0006-raw-query-edit-gated-by-query-analyzer/memory.md)                      | Raw query 편집은 queryAnalyzer gate 통과 시만 허용                                            | Accepted | 2026-04-20 | —          |
| [0007](./0007-theme-picker-dom-only-hover-preview/memory.md)                         | ThemePicker hover preview는 DOM-only                                                          | Accepted | 2026-04-24 | —          |
| [0008](./0008-styling-tokens-over-arbitrary-px/memory.md)                            | Tailwind 크기·간격: @theme 토큰 + 기본 스케일, arbitrary px는 로컬 ESLint 룰로 차단           | Accepted | 2026-04-24 | —          |
| [0009](./0009-null-vs-empty-string-tri-state/memory.md)                              | DataGrid 편집: SQL NULL vs 빈 문자열을 `string \| null` tri-state로 구분                      | Accepted | 2026-04-24 | —          |
| [0010](./0010-paradigm-ui-staged-evolution/memory.md)                                | paradigm-aware UI는 폴더 재조직 먼저, capability adapter는 ES/redis 도입 시 진화              | Accepted | 2026-04-25 | —          |
| [0012](./0012-multi-window-launcher-workspace/memory.md)                             | Phase 12 — launcher/workspace 별도 WebviewWindow + cross-window IPC sync 완성                 | Accepted | 2026-04-27 | 0011       |
| [0013](./0013-cross-window-focus-hydration-hook/memory.md)                           | 크로스 윈도우 상태 동기화: IPC bridge + session localStorage + useWindowFocusHydration 훅     | Accepted | 2026-04-29 | —          |
| [0014](./0014-e2e-switchwindow-multi-window/memory.md)                                | E2E multi-window 대응을 위한 browser.switchWindow 도입                                        | Accepted | 2026-04-29 | —          |
| [0016](./0016-e2e-window-visibility-override/memory.md)                              | e2e 빌드는 workspace.visible flag만 overlay로 override                                        | Accepted | 2026-04-30 | —          |
| [0017](./0017-launcher-lazy-workspace-window/memory.md)                              | Sprint 175 — workspace WebviewWindow를 lazy 생성으로 전환                                     | Accepted | 2026-04-30 | —          |
| [0018](./0018-async-cancel-policy/memory.md)                                         | Sprint 180 — 비동기 작업 1초 임계 + Cancel UX 단일화                                          | Accepted | 2026-04-30 | —          |
| [0021](./0021-export-envelope-auto-mnemonic-no-ttl/memory.md)                        | Export envelope: 자동 생성 BIP39 mnemonic + Argon2id OWASP first profile, TTL/max_uses 미도입 | Accepted | 2026-05-05 | —          |
| [0023](./0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md) | Production Warning — environment-aware chrome + WARN dialog 게이트                            | Accepted | 2026-05-09 | —          |
| [0024](./0024-testcontainers-pid-label-sweep/memory.md)                              | 통합 테스트 컨테이너 cleanup — owner-pid 라벨 + 시작 시 dead-owner sweep                      | Accepted | 2026-05-11 | —          |
| [0025](./0025-datagrid-self-managed-no-tanstack/memory.md)                           | DataGrid layout/sorting/filtering/virtualization 자체 관리 — TanStack Table 도입 안 함        | Accepted | 2026-05-11 | —          |
| [0026](./0026-numeric-wire-string-type-aware-wrap/memory.md)                         | 수치 wire-format — string token + frontend type-aware wrap (BigInt / Decimal / Number)        | Accepted | 2026-05-11 | —          |
| [0027](./0027-per-workspace-state-store/memory.md)                                   | Per-workspace state — workspaceStore (tabStore 흡수) keyed by (connId, db) with explicit-API  | Accepted | 2026-05-12 | —          |
| [0028](./0028-mysql-driver-sqlx/memory.md)                                           | MySQL adapter 라이브러리 — sqlx::mysql (mysql_async 미채택)                                   | Accepted | 2026-05-14 | —          |
| [0030](./0030-mongo-db-scope-tab-local/memory.md)                                    | Mongo DB-scope — toolbar chip 제거, tab-local chip + sidebar 우클릭 entry-point               | Accepted | 2026-05-15 | —          |
| [0031](./0031-syntax-palette-manual-and-token-integrity/memory.md)                   | Syntax palette — manual themes.css + theme-agnostic fallback + token integrity 강제           | Accepted | 2026-05-15 | —          |
| [0032](./0032-sqlite-infrastructure-and-atomic-snapshot/memory.md)                   | SQLite 인프라 + atomic snapshot bootstrap (Q1/Q9 + SQLite 도입)                               | Accepted | 2026-05-17 | —          |
| [0033](./0033-single-instance-and-cross-window-sync/memory.md)                       | Single-instance + in-process cross-window sync (Q3/Q4)                                        | Accepted | 2026-05-17 | —          |
| [0034](./0034-per-tab-connection-affinity-and-native-cancel/memory.md)               | Per-tab connection affinity + native cancel (Q5.x 통합)                                       | Accepted | 2026-05-17 | —          |
| [0035](./0035-corrupt-recovery-silent-quarantine/memory.md)                          | Corrupt 영속 recovery — silent quarantine + fresh start                                       | Accepted | 2026-05-17 | —          |
| [0036](./0036-telemetry-zero-collection/memory.md)                                   | Telemetry — 수집 0 명문화 (privacy contract)                                                  | Accepted | 2026-05-17 | —          |
| [0038](./0038-theme-safemode-sqlite-sot-ls-fouc-cache/memory.md)                     | Theme/SafeMode SOT — SQLite truth + theme-only LS FOUC cache                                  | Accepted | 2026-05-17 | —          |
| [0039](./0039-workspace-window-per-connection/memory.md)                             | Workspace window per-connection — TablePlus 패턴 + idempotent open                            | Accepted | 2026-05-17 | —          |
| [0040](./0040-file-key-os-keyring/memory.md)                                         | File-key OS keyring + 2-phase migration with Linux fallback                                   | Accepted | 2026-05-17 | —          |
| [0041](./0041-schema-cache-eager-wide-invalidate/memory.md)                          | SchemaCache cross-window invalidation — in-process event + wide + eager                       | Accepted | 2026-05-17 | —          |
| [0042](./0042-query-history-privacy/memory.md)                                       | Query history retention / privacy / export — local at-rest 정책                               | Accepted | 2026-05-17 | —          |
| [0043](./0043-mongosh-parser-rust-wasm-sot/memory.md)                                | mongosh parser — Rust/WASM single parser with TS policy adapter                               | Accepted | 2026-05-20 | 0029       |
| [0044](./0044-e2e-smoke-remote-required/memory.md)                                   | E2E smoke — remote PR/main blocking check                                                     | Accepted | 2026-05-20 | 0019, 0020 |
| [0045](./0045-language-completion-profile-wasm-boundary/memory.md)                   | language completion — dialect profile + WASM hot-path boundary                                | Accepted | 2026-05-21 | —          |
| [0046](./0046-data-source-profile-capability-architecture/memory.md)                 | data source extension — profile, capability, language, result envelope                        | Accepted | 2026-05-22 | —          |
| [0047](./0047-keep-duckdb-defer-removal/memory.md)                                   | DuckDB 지원 유지 (제거 보류)                                                                  | Accepted | 2026-07-03 | —          |
| [0048](./0048-undo-stack-survives-commit-restage-pending/memory.md)                  | undo 스택 commit 생존 — Cmd+Z 는 복원값을 pending 편집으로 재스테이징 (보상 commit 폐기)      | Accepted | 2026-07-05 | 0022       |
| [0049](./0049-auto-update-full-tauri-updater/memory.md)                              | Auto-update — full in-app tauri-plugin-updater (minisign only, ad-hoc OS signing 유지)        | Accepted | 2026-07-06 | 0037       |

## 역사 (Superseded / Deprecated)

| ID                                                                 | 제목                                                                                                            | 상태       | 날짜       | Superseded by                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------- | ---------- | -------------------------------------------------------- |
| [0011](./0011-single-window-stub-for-launcher-workspace/memory.md) | Sprint 149 — launcher/workspace lifecycle은 single-window stub으로 우선 잠그고 실제 윈도우 분리는 phase 12 이월 | Superseded | 2026-04-27 | [0012](./0012-multi-window-launcher-workspace/memory.md) |
| [0015](./0015-e2e-docker-pipeline-canonical/memory.md)             | E2E 실행을 docker compose 파이프라인으로 표준화                                                                 | Superseded | 2026-04-29 | [0019](./0019-e2e-pre-push-not-ci/memory.md)             |
| [0019](./0019-e2e-pre-push-not-ci/memory.md)                       | E2E를 CI에서 제거하고 lefthook pre-push(host-native)로 이동                                                     | Superseded | 2026-05-01 | [0044](./0044-e2e-smoke-remote-required/memory.md)       |
| [0020](./0020-e2e-pre-push-host-docker/memory.md)                  | ADR 0019 후속 — pre-push e2e는 host docker로 한정 (tauri-driver macOS 미지원)                                   | Superseded | 2026-05-01 | [0044](./0044-e2e-smoke-remote-required/memory.md)       |
| [0029](./0029-mongosh-parser-strategy/memory.md)                   | mongosh expression parser — handwritten whitelist (WASM sidecar 미채택)                                         | Superseded | 2026-05-14 | [0043](./0043-mongosh-parser-rust-wasm-sot/memory.md)    |
| [0022](./0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md) | Safe Mode — destructive 만 confirm + dry-run preview, safe write 는 Cmd+Z 보호 | Superseded | 2026-05-09 | [0048](./0048-undo-stack-survives-commit-restage-pending/memory.md) |
| [0037](./0037-auto-update-notification-only/memory.md)             | Auto-update — notification only, no in-app download/install                                                     | Superseded | 2026-05-17 | [0049](./0049-auto-update-full-tauri-updater/memory.md)  |

형식:

| ID     | 제목            | 상태       | 날짜       | Superseded by         |
| ------ | --------------- | ---------- | ---------- | --------------------- |
| `0042` | 예시: 이전 결정 | Superseded | YYYY-MM-DD | `NNNN-slug/memory.md` |

## 작성 규칙

- 한 ADR = 한 디렉토리 = 한 memory.md
- 번호는 4자리, 순차 증가.
- 슬러그는 **주제-접두사 + 결정-꼬리** (예: `global-state-zustand`). 주제가 같은 나중 ADR이 접두사를 공유해 훑기 쉬움.
- 본문(결정/이유/트레이드오프)은 작성 순간 **동결 — 절대 수정 금지**. 그 시점의 판단을 보존해야 함.
- 프론트매터 **메타 필드만 갱신 가능**: `status`, `superseded_by`. 본문은 건드리지 않음.
- 상태 값: `Accepted` | `Deprecated` | `Superseded`.
- 결정이 뒤집히면:
  1. 새 ADR 작성 + 프론트매터 `supersedes: NNNN`.
  2. 원본 ADR 프론트매터의 `status`를 `Superseded`로, `superseded_by: NNNN` 추가.
  3. 인덱스에서 원본을 "Accepted Decisions"에서 "역사" 섹션으로 이동.

## 정리 가이드

삭제하지 않고 **구조화**로 정리한다:

- 인덱스가 200줄 초과하면 `/split-memory`로 주제별 하위 디렉토리 분할 (예: `decisions/state/`, `decisions/stack/`).
- 주제 접두사로 관련 ADR 훑기: `ls docs/archives/decisions | grep global-state`.

## 관련 방

- [memory/engineering/architecture](../../../memory/engineering/architecture/memory.md)
- [docs/ROADMAP.md](../../ROADMAP.md)
