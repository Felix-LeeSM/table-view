# Phase 13: Connection 활성화 + Preview Tab Parity

> **상태: 계획 (착수 전)** — Phase 12 직후 회귀 진단 sprint로 시작.

## 배경

Phase 12 multi-window split 직후 두 가지 사용자 보고 발생:

1. **Connection 더블클릭이 workspace 창을 띄우지 않는다** — Phase 12에서 `HomePage.handleActivate`를 `showWindow("workspace") → focusWindow("workspace") → hideWindow("launcher")`로 wiring했고 jsdom 단위 테스트는 모두 green이지만, 실제 Tauri 런타임에서는 동작하지 않는다. seam mock 의존성의 직접적 결과 — 실제 `WebviewWindow.getByLabel`/`show`/`setFocus` 호출 chain이 어떤 단계에서 실패하는지 e2e 또는 수동 QA로 확인되지 않았다.
2. **PostgreSQL sidebar에서 테이블을 클릭하면 즉시 정규탭이 열린다** — 사용자 표현: "이것 저것 클릭하면 모두 유지되는 문제." Sprint 136에서 통합 preview semantics를 wired했음에도(SchemaTree.tsx:636-664, tabStore.ts:267-323) 사용자 관측은 "preview 동작 안 함"이다. 코드 vs 관측 모순 → 회귀 가능성.

판단 기준: "TablePlus 사용자가 launcher에서 connection을 더블클릭해 workspace로 진입하고, 좌측 사이드바에서 여러 테이블을 클릭해도 단일 preview 슬롯만 swap되며, 더블클릭 시점에만 정규탭으로 승격되는 사용자 경험이 Postgres와 MongoDB에서 모두 끊김 없이 동작하는가?"

## 구현 항목

| Feature | ID | 우선순위 | 비고 |
|---|---|---|---|
| Connection 더블클릭 → workspace 창 활성화 (실제 Tauri 런타임 보장) | F13.1 | P0 | Phase 12 회귀; e2e 또는 Playwright + tauri-driver |
| PG preview tab 동작 회귀 진단 (모든 entry point 단언) | F13.2 | P0 | Sprint 136 wiring 재검증 |
| MongoDB preview tab 테스트 갭 메우기 | F13.3 | P1 | DocumentDatabaseTree.test.tsx 보강 |
| Cross-paradigm preview 통합 테스트 | F13.4 | P2 | RDB / document 동치성 잠금 |
| Preview cue UI 검증 (italic title / close-on-hover) | F13.5 | P2 | TabBar.tsx 시각적 단서 |
| E2E 시나리오 — 더블클릭 → 3개 테이블 클릭 → 1개 탭 유지 | F13.6 | P1 | Playwright |

## Sprint 분해

| Sprint | 목적 | 핵심 산출물 |
|---|---|---|
| **156 (P0 진단)** | Activation + preview 모든 entry point에 대한 TDD 회귀 테스트 작성. 통과/실패 분리해서 버그 위치 식별. | `src/__tests__/connection-activation.diagnostic.test.tsx` (신규) — 더블클릭 / Enter / 더블클릭 후 disconnect 후 재활성화 / 빠른 연속 더블클릭 / WebviewWindow seam mock 통한 실제 호출 chain 단언. `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` (신규) — 단일클릭 / 더블클릭 / context menu Open / context menu View Structure / 검색 결과 entry / 빈 사이드바 상태에서 첫 클릭 등 모든 entry point preview/swap 단언. |
| **157 (P0 수정 — activation)** | Sprint 156에서 발견된 activation 실패 지점 수정. 가장 가능성 높은 후보: workspace window가 `tauri.conf.json`에서 hidden으로 시작하지만 첫 호출에서 lazy-init 못 되거나, `WebviewWindow.getByLabel("workspace")`이 null 반환. seam 내부 fallback / retry / 명시적 create 추가. e2e 시나리오로 회귀 잠금. | `src/lib/window-controls.ts` 보강 (실패 처리 + sentry breadcrumb), `e2e/window-activation.spec.ts` (신규 Playwright). |
| **158 (P0 수정 — preview)** | Sprint 156에서 발견된 preview 실패 entry point 수정. PG preview swap이 어떤 entry point에서 누락됐는지(예: context menu Open 가 직접 `addTab({...isPreview:false})` 호출하는 경로) 식별 후 wiring 통일. | 진단 결과에 따라 `SchemaTree.tsx` 또는 `addTab` caller 정리. |
| **159 (P1 갭 메우기)** | MongoDB preview-swap 테스트 추가 + cross-paradigm 통합 테스트. preview cue UI 단서 검증 + 누락 시 추가. | `DocumentDatabaseTree.preview.test.tsx` (신규), `src/__tests__/preview-tab-cross-paradigm.test.tsx` (신규), `TabBar.tsx`/`TabBar.test.tsx` 보강. |
| **160 (Phase 13 closure)** | Skip-zero 게이트, RISK-026 (있다면) closure, Phase 13 exit gate. e2e Playwright 수트 정착. | `e2e/preview-tab.spec.ts`, ADR 0013 (필요 시 — preview 모델 paradigm-agnostic 결정 동결). |

## Acceptance Criteria

- **AC-13-01** Launcher에서 connection 더블클릭 → workspace `WebviewWindow.show()` + `setFocus()` → launcher `hide()` 순서 실제 Tauri 런타임에서 관찰. e2e 시나리오로 잠금.
- **AC-13-02** Workspace에서 Back → launcher 재표시, workspace hidden, pool 보존 — 실제 런타임에서 검증.
- **AC-13-03** PG sidebar 단일클릭 → preview 슬롯에 탭 1개 생성, `isPreview: true`. 다른 행 단일클릭 → 동일 슬롯 swap, 탭 수 1 유지.
- **AC-13-04** PG sidebar 더블클릭 → preview 슬롯이 정규탭으로 승격, 이후 다른 행 단일클릭 → 새 preview 슬롯 1개 추가 (탭 총 2개).
- **AC-13-05** Context menu "Open" / "View Structure" / 검색 결과 entry 등 모든 entry point에서 AC-13-03/04 동일 보존. 차이 발생 시 Sprint 156에서 명시적 ADR로 결정 잠금.
- **AC-13-06** MongoDB collection 동일 단일/더블클릭 동작 (paradigm-agnostic).
- **AC-13-07** TabBar에 preview cue 시각 단서 존재 (italic title 또는 동치). 키보드 접근성 보존 (`aria-pressed`/`aria-current`).
- **AC-13-08** E2E 시나리오 5개 — (a) 더블클릭 활성화 (b) Back 보존 (c) 단일클릭 swap 3회 (d) 더블클릭 승격 후 swap 분리 (e) launcher close → app exit. Playwright + tauri-driver.

## TDD 정책

- 모든 sprint TDD-first. 각 sprint:
  - **Step 1**: 실패 케이스 작성 (`docs/sprints/sprint-N/tdd-evidence/red-state.log` 캡처).
  - **Step 2**: 최소 wiring으로 green 전환.
  - **Step 3**: 회귀 시나리오 1개 이상 추가.
- Sprint 156(진단)은 의도적으로 일부 케이스가 RED인 채 commit. 이 RED 자체가 다음 sprint의 fix scope를 정의.
- E2E 추가 시 — Playwright spec에서 `it.skip` 사용 금지. CI에서 e2e 환경 미준비 시 skip 대신 별도 job으로 분리하고 README에 운영 문서.

## E2E 테스트 시나리오

| ID | 시나리오 | 환경 |
|---|---|---|
| E13-01 | App 부팅 → launcher 720×560 + workspace hidden 상태 검증 | Playwright + tauri-driver |
| E13-02 | Connection 더블클릭 → workspace visible/focused, launcher hidden | Playwright |
| E13-03 | Workspace에서 Back → launcher visible, pool 보존(connection 상태 connected 유지) | Playwright |
| E13-04 | 사이드바 테이블 3개 단일클릭 → 탭 1개만 존재, 마지막 클릭 행이 active | Playwright |
| E13-05 | 사이드바 테이블 더블클릭 → preview cue 사라짐, 다른 행 단일클릭 시 새 탭 추가됨(총 2개) | Playwright |
| E13-06 | Launcher window close → 앱 종료 (workspace process도 같이 종료) | Playwright |

E2E suite은 `e2e/` 디렉토리. CI 통합은 별도 Phase 13 closure sprint에서 결정 (현재는 로컬 실행 + 수동 QA로 시작).

## Phase Exit Gate

1. Skip-zero — `it.skip` / `it.todo` / `xit` / `describe.skip` / `this.skip()` 0.
2. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
3. AC-13-01..08 모두 회귀로 잠금 (단위 + e2e).
4. CI Playwright job (있다면) green.
5. 사용자 보고 두 건(activation, preview) 재현 시나리오 e2e suite로 영구 잠금.
6. 필요 시 ADR 0013 작성 (preview 모델 paradigm-agnostic 결정 동결).

## 위험 / 미정 사항

- **R13.1**: jsdom 환경에서 실제 `WebviewWindow` lifecycle을 직접 검증 불가 → e2e + tauri-driver 의존. CI Playwright 환경 셋업 비용.
- **R13.2**: Sprint 156 진단이 "버그 없음" 결과 → 사용자 perception lag 또는 빌드 cache 문제일 가능성. 그 경우 docs/INSTALL.md에 빌드 캐시 클리어 절차 추가.
- **R13.3**: Sprint 158 fix scope가 sidebar 외 다른 entry point(다중 행 선택, 클립보드 paste, 검색 등)로 확장될 수 있음.
