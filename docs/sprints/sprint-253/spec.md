# Feature Spec: Production Warning System (Sprints 253–257)

## Description

ADR 0022 의 Safe Mode (destructive-only confirm + Cmd+Z + dry-run + onBlur+Esc + store-lift + Copy/highlight) Phase 1-5 의 *commit-before* 보호 위에, *환경-인식 (environment-aware)* 의 영구 시각 시그널 + write 표면 일관 dialog 게이트 + connection-색 cleanup + tab DnD 보강 + per-theme syntax palette 를 5 sprint 에 걸쳐 도입한다. 외부에서 제공된 `Table View Design System/PRODUCTION-WARNING.md` spec 을 *논의용 reference* 로 두고, 사용자와의 13-question grill (`docs/sprints/sprint-253/grill-decisions.md`) 을 통해 5-tag 보존 / 3-action collapse, 2-surface chrome, no-verb button 등 13 항목을 결정. 본 spec 은 그 결정의 sprint-by-sprint 매핑.

## Sprint Breakdown

### Sprint 253: Token foundation + light polish (item ② / ④)

**Goal**: 6 env-specific 토큰 + `--tv-warning` 깊이 조정 + TabBar 좌측 connection-색 stripe 제거 + tab drag 빈 영역 release 처리. 이후 4 sprint 의 token / DnD 의존성 foundation. 사용자 즉시 체감 (2 issue resolved).

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `AC-253-01` `src/themes.css` 의 모든 72 theme variant (light/dark) 에 다음 6 토큰이 동일 정의된다 (universal — theme variation 없음): `--tv-env-prod: #dc2626`, `--tv-env-prod-wash: #fef2f2`, `--tv-env-prod-text: #7f1d1d`, `--tv-env-staging: #ea580c`, `--tv-env-staging-wash: #fff7ed`, `--tv-env-staging-text: #7c2d12`. 신규 토큰을 정의하는 단일 `:root`-scope 또는 globally-applied 위치 사용 가능.
2. `AC-253-02` `--tv-warning` 의 값이 모든 theme 에서 `#f59e0b` (amber, 현재) → `#ea580c` (deep orange, spec) 로 deepen. `--tv-status-connecting` 은 amber `#f59e0b` 그대로 (의미 충돌 회피).
3. `AC-253-03` `TabBar.tsx:198-213` 의 connection-색 좌측 1px stripe 가 완전히 삭제된다. `getConnectionColor` import 도 TabBar 에서만 제거 (다른 사용처 보존). 회귀 테스트: TabBar 가 connection 색 affordance 를 노출하지 않음을 단언.
4. `AC-253-04` TabBar 의 scrollRef 컨테이너에 `onMouseUp` 핸들러 추가, 빈 영역 release 시 cursor X 와 strip 안 모든 `[data-tab-id]` element 의 left/right edge 비교 → 가장 가까운 탭 결정 → before/after 로 `moveTab` 호출. 마지막 탭 우측 release → 끝으로 이동. Vitest 로 (a) 마지막 탭 우측 빈 영역 release, (b) 두 탭 사이 gap release, (c) drag 중 strip 밖 release (cancel) 검증.
5. `AC-253-05` 기존 탭-단위 onMouseUp 동작 회귀 0 — 탭 위 release 시 child 가 우선 처리, strip 의 새 핸들러는 bubble 차단 가드로 중복 reorder 방지.
6. `AC-253-06` 모든 vitest 회귀 통과 (Sprint 252 baseline 3017 + 신규).

**Components to Create/Modify**:
- `src/themes.css`: 6 신규 universal 토큰 + `--tv-warning` 값 변경.
- `src/components/layout/TabBar.tsx`: stripe 제거 + scrollRef onMouseUp 추가.
- 회귀 테스트: `TabBar.test.tsx` 의 connection 색 단언 제거 + 신규 DnD 케이스 추가.

---

### Sprint 255: WARN dialog mount in raw SQL editor

**Goal**: raw SQL editor (`QueryTab`) 의 INSERT/UPDATE/DELETE/CREATE/ALTER additive 실행 path 에 SqlPreviewDialog 신규 mount. 현재는 dialog 없이 직접 실행 — Q3-(b) 의 "모든 환경 + 모든 write 표면" 채택의 핵심 보호. 254 의 3-tier classifier 도입 전에 *현재의 2-tier* `severity: "safe" | "danger"` 그대로 활용 — `safe` 중 SELECT/EXPLAIN/SHOW (INFO 후보) 만 `queryAnalyzer` 의 `paradigm` / 키워드 휴리스틱으로 선식별 후 dialog skip, 나머지 `safe` (= WARN 후보) 는 dialog. 254 의 정밀 classifier 가 들어오면 WARN/INFO 분리가 더 정확해짐.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `AC-255-01` `QueryTab.tsx` 의 raw SQL execute path 에서 statement 가 INFO 가 아닌 (= 현재 2-tier `safe` 중 SELECT/EXPLAIN/SHOW/DESCRIBE 가 아닌) 경우 SqlPreviewDialog mount → 사용자가 Execute 클릭한 뒤 실제 IPC 발동. INFO 는 dialog 없이 즉시 실행 (현재 동작 보존).
2. `AC-255-02` STOP-tier (현재 `severity: "danger"`) 는 기존 ConfirmDestructiveDialog 그대로 발동 — WARN dialog 와 분리. 둘 다 동시에 발동 안 됨 (STOP 이 우선).
3. `AC-255-03` Mongo (raw MQL editor) 도 동등 처리: WARN-class MQL 명령 (insertOne/updateOne/deleteOne/replaceOne 등) → MqlPreviewModal 신규 mount, $out/$merge/dropCollection 등 STOP 은 ConfirmDestructiveDialog 보존.
4. `AC-255-04` 사용자가 "Execute" 클릭 → 실제 IPC `executeQuery` 발동. Cancel/X → IPC 미발동. SQL 본문은 SqlSyntax 로 highlight (Sprint 252 패턴 재사용).
5. `AC-255-05` Vitest 회귀: `QueryTab.execution.test.tsx` 의 기존 모든 assertion 보존 + 신규 INSERT/UPDATE WHERE/DELETE WHERE 가 dialog 발동 → confirm → IPC 단계 검증.
6. `AC-255-06` Sprint 250-252 polish (onBlur commit, Esc discard, store-lift, Copy 버튼, SqlSyntax) 회귀 0.

**Components to Create/Modify**:
- `src/components/query/QueryTab.tsx`: execute handler 가 severity 분기 → WARN dialog mount.
- `src/components/query/QueryTab/useQueryEvents.ts` 또는 동등 hook: WARN dialog state 관리.
- 신규 또는 기존 SqlPreviewDialog 호출자 추가 (`QueryTab` mount 지점 1-2개).
- 신규 또는 기존 MqlPreviewModal 호출자 추가 (Mongo paradigm).

---

### Sprint 254: Severity classifier 3-tier split + dry-run STOP escalation

**Goal**: 현재 `sqlSafety.ts` 의 `severity: "safe" | "danger"` 를 `"info" | "warn" | "danger"` 3-tier 로 split. INFO = SELECT/EXPLAIN/SHOW/DESCRIBE/WITH …SELECT (no DML CTE). WARN = INSERT/bounded UPDATE WHERE/bounded DELETE WHERE/CREATE/ALTER additive. STOP (`danger` 보존) = DROP/TRUNCATE/WHERE-less DELETE·UPDATE/...  추가: WARN 의 bounded UPDATE/DELETE 는 dry-run row count → 100+ row 영향이면 STOP 으로 escalate (Sprint 247 의 `executeQueryDryRun` IPC 재사용, 2s timeout, timeout/unsupported 시 STOP fallback).

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `AC-254-01` `sqlSafety.ts` 의 `StatementAnalysis.severity` 가 `"info" | "warn" | "danger"` 3-값. 기존 `"safe"` 사용처는 모두 새 tier 로 매핑됨 (테스트 / 호출자).
2. `AC-254-02` SELECT / EXPLAIN / SHOW / DESCRIBE / WITH …SELECT (no DML CTE) → INFO. 단위 테스트 corpus.
3. `AC-254-03` INSERT / bounded UPDATE WHERE / bounded DELETE WHERE / CREATE / additive ALTER → WARN. 단위 테스트.
4. `AC-254-04` DROP / TRUNCATE / WHERE-less DELETE·UPDATE / ALTER … DROP / GRANT/REVOKE / Mongo $out·$merge·drop·*-all → STOP. 회귀 (이전 `danger` 와 동일 결과).
5. `AC-254-05` WARN bounded UPDATE/DELETE 의 dry-run row count 가 100+ 이면 STOP 으로 escalate. 2s timeout 또는 unsupported (Mongo single-node 등) → STOP fallback. Sprint 247 IPC 재사용.
6. `AC-254-06` `decideSafeModeAction` 의 분기가 새 tier 와 정합 — INFO 는 항상 `allow`, WARN 은 환경/SafeMode 따라 `allow` (현 safe 흐름) 또는 `confirm` (raw editor WARN dialog mount 대상), STOP 은 기존 `confirm` 보존.
7. `AC-254-07` Sprint 245-249 의 모든 SafeMode AC + Sprint 255 의 raw editor WARN dialog 회귀 0.

**Components to Create/Modify**:
- `src/lib/sql/sqlSafety.ts`: severity union 확장 + INFO 분류 로직.
- `src/lib/sql/queryAnalyzer.ts` / `sqlDialectMutations.ts`: INFO 식별 helper 가 이미 부분 존재 — 통합 / 정리.
- `src/lib/safeMode.ts`: `decideSafeModeAction` 새 tier 분기 (회귀 가드).
- 신규: dry-run row-count escalation helper (Sprint 247 IPC wrapping).

---

### Sprint 256: Chrome H + Button F + ConfirmDestructiveDialog header 정렬

**Goal**: 영구 chrome (top stripe + prod-only window border) + 모든 Execute 버튼의 color × target 라벨 + ConfirmDestructiveDialog 헤더의 env token 정렬. Q4-(c) + Q5-(b) + Q6-(a) 의 시각 polish 통합.

**Verification Profile**: `command + manual smoke (window border)`

**Acceptance Criteria**:

1. `AC-256-01` App shell 최상단 (윈도우 타이틀 바 위) 에 staging/production 환경 connection 의 활성 탭이 있을 때 full-width 색띠 stripe 가 렌더된다. staging = `--tv-env-staging` 배경 + `--tv-env-staging-text` 텍스트, prod = `--tv-env-prod` 배경 + `--tv-env-prod-text` 텍스트 + 펄스 dot 2개. 텍스트: `STAGING · <conn> · <host>` / `PRODUCTION · <conn> · <host>`. dev (local/testing/development) / null 환경 활성 탭 → stripe 미렌더.
2. `AC-256-02` Production 환경 connection 의 활성 탭이 있을 때 App shell 외곽에 1px `--tv-env-prod` border. Mac (Tauri WKWebView) 에서 검증, Windows 는 platform 별 차이 documented (residual risk).
3. `AC-256-03` 활성 탭 전환 → chrome 즉시 갱신 (one-frame 안). dev 탭에서 prod 탭 → stripe + border 등장. prod 탭에서 dev 탭 → 둘 다 사라짐.
4. `AC-256-04` `prefers-reduced-motion: reduce` 사용자 설정 → 펄스 dot 애니메이션 skip, static stripe 만 유지.
5. `AC-256-05` 모든 Execute 버튼 (SqlPreviewDialog / MqlPreviewModal / DataGrid 인라인 preview / EditableQueryResultGrid / ConfirmDestructiveDialog) 의 라벨이 `<verb>` (= "Execute") + ` on <conn>` (env ≠ null/dev 일 때) 로 합성. 색은 severity × env: WARN+dev = green (`--tv-success`), WARN+staging = orange (`--tv-warning`), WARN+prod = red (`--tv-destructive`), STOP+any = red. 사용자 4-Q5 결정 따라 verb 추출 X.
6. `AC-256-06` `ConfirmDestructiveDialog` 의 "PRODUCTION DATABASE" 헤더 배경/텍스트가 chrome top stripe 와 동일 token (`--tv-env-prod` / `-prod-text`) 사용 — 시각 일관.
7. `AC-256-07` Sprint 252 의 Copy 버튼 / SqlSyntax / Sprint 251 store-lift / Sprint 250 onBlur+Esc / Sprint 249 Cmd+Z 회귀 0.

**Components to Create/Modify**:
- 신규: `src/components/layout/EnvironmentChromeStripe.tsx` (top stripe).
- `src/AppRouter.tsx` 또는 `App.tsx`: shell 에 stripe + prod border mount. `useActiveTabConnection` hook 신규 (또는 기존).
- 신규: `src/components/ui/ExecuteButton.tsx` (composed color + target label).
- `src/components/structure/SqlPreviewDialog.tsx` / `src/components/document/MqlPreviewModal.tsx` / `src/components/rdb/DataGrid.tsx` (인라인) / `src/components/query/EditableQueryResultGrid.tsx`: Execute 버튼을 ExecuteButton 으로 교체.
- `src/components/workspace/ConfirmDestructiveDialog.tsx`: 헤더 배경/텍스트 토큰 정렬.

---

### Sprint 257: Per-theme syntax palette curation (item ③)

**Goal**: 72 theme × 3 syntax token (`keyword`/`string`/`number`) = 216 hardcoded 값을 theme 별로 큐레이션. 현재 모든 theme 이 light: `#7c3aed`/`#16a34a`/`#dc2626`, dark: `#c4b5fd`/`#86efac`/`#fca5a5` 단일 팔레트. 사용자 발화 "왜 theme 과 무관한 색인 거야" 해소.

**Verification Profile**: `command + visual review`

**Acceptance Criteria**:

1. `AC-257-01` `src/themes.css` 의 모든 72 theme 의 light/dark variant 에 `--tv-syntax-keyword` / `--tv-syntax-string` / `--tv-syntax-number` 가 brand palette 와 *충돌 없이* 큐레이션된 값으로 정의된다. 정의 규칙: keyword 는 brand accent 또는 그 보색, string 은 success/teal-ish, number 는 destructive/red-ish 또는 amber. Brand 와 *동일색* 금지 (가독성).
2. `AC-257-02` Collision themes (clickhouse yellow / supabase·spotify green / tesla·ferrari red) 의 syntax palette 는 brand 와 의미 분리되도록 별도 큐레이션 (예: clickhouse keyword 는 deep amber 가 아닌 violet).
3. `AC-257-03` SqlSyntax 컴포넌트의 마크업 변경 0 (AC-109 회귀 가드). `text-syntax-keyword` 등 className 그대로 — 토큰 값만 갱신.
4. `AC-257-04` 모든 vitest 회귀 통과. SqlPreviewDialog / DataGrid bottom strip / GlobalQueryLogPanel 의 SqlSyntax 사용 회귀 0.

**Components to Create/Modify**:
- `src/themes.css`: 72 × 2 (light/dark) 의 syntax 토큰 라인 갱신 — 144 line 변경.
- 회귀 가드 단위 테스트.

---

## Global Acceptance Criteria

1. `AC-GLOBAL-01` 모든 sprint 의 변경은 `pnpm tsc --noEmit` 0 errors, `pnpm lint` 0/0, `pnpm vitest run` 모두 통과.
2. `AC-GLOBAL-02` Rust 변경 거의 없음 (Sprint 254 의 dry-run helper 는 Sprint 247 IPC 재사용 — Rust 변경 0). `cargo test --lib` + `cargo clippy -D warnings` 회귀 0.
3. `AC-GLOBAL-03` 신규 / 변경 파일 라인 70% 이상 coverage.
4. `AC-GLOBAL-04` `it.skip` / `it.todo` / `xit` 도입 금지.
5. `AC-GLOBAL-05` Sprint 245-252 (ADR 0022 Phase 1-5 + onBlur+Esc + store-lift + Copy/highlight) AC 모두 회귀 0.
6. `AC-GLOBAL-06` `Table View Design System/PRODUCTION-WARNING.md` 의 spec §10 open product decisions 4 개 중 §10.1 (default `dev`, force-pick X) 거부 / §10.2 per-tab override 거부 / §10.3 read-only flag 거부 / §10.4 webhook 거부 — 13-question grill 결과 (`docs/sprints/sprint-253/grill-decisions.md`) 반영.

## Data Flow

- **Sprint 253**: theme css 토큰 / TabBar markup 만 — IPC / store 변경 0.
- **Sprint 255**: QueryTab execute path → 신규 dialog state → SqlPreviewDialog/MqlPreviewModal mount → 사용자 Execute → IPC. 기존 ConfirmDestructiveDialog flow 와 분기 (STOP 우선).
- **Sprint 254**: pure function refactor — sqlSafety.ts severity union 확장. dry-run escalation 은 Sprint 247 IPC 활용. IPC 변경 0.
- **Sprint 256**: useActiveTabConnection → top stripe / prod border / ExecuteButton 의 props 결정. IPC 변경 0.
- **Sprint 257**: theme css 만 — IPC / store 변경 0.

## UI States

- **Sprint 253**: TabBar 의 connection 색 사라짐. 빈 영역 drag drop = 가장 가까운 탭 옆 insert.
- **Sprint 255**: raw editor WARN 실행 = preview dialog 상승 → confirm 후 IPC. INFO 실행 = 기존 즉시 IPC. STOP 실행 = 기존 ConfirmDestructiveDialog.
- **Sprint 254**: classifier 결과 = info/warn/danger. WARN bounded DML 의 row count 100+ → 사용자 시점에선 STOP dialog 로 자동 escalate.
- **Sprint 256**: prod 탭 활성 → 윈도우 최상단 빨강 stripe + 외곽 빨강 border. Execute 버튼 = "Execute on prod-primary" + 빨강. dev 탭 = 변화 없음.
- **Sprint 257**: 각 theme 의 SQL preview 본문이 brand-aware 색조.

## Edge Cases

- **Sprint 253**: TabBar 가 빈 (탭 0개) 일 때 drag 자체 발동 안 됨 (현 가드 `if (tabs.length === 0) return null` 보존).
- **Sprint 255**: 다중 statement (`SELECT 1; UPDATE x SET y;`) — 각 statement classifier → 최대 severity. WARN + INFO 혼합 = WARN 으로 dialog. WARN + STOP = STOP.
- **Sprint 254**: BEGIN/COMMIT/ROLLBACK 자체는 INFO, 안의 wrapped statement 가 severity 결정. CTE 의 `WITH x AS (UPDATE …) SELECT *` 는 WARN/STOP — DML CTE 식별 필수.
- **Sprint 256**: 활성 탭이 *table tab* 도 *query tab* 도 아닌 경우 (e.g. structure editor) → connection 환경 동일 적용. prod 환경의 structure 편집 중 chrome 동일 발동.
- **Sprint 257**: collision theme (clickhouse yellow primary) 의 syntax keyword 가 yellow 일 경우 가독성 검증 — 큐레이션 규칙으로 회피.

## Out of Scope (모든 sprint 공통)

- Spec §10.1 force-pick environment / §10.2 per-tab override / §10.3 read-only flag / §10.4 STOP-prod webhook 모두 거부 (Q8/Q10/Q9).
- Spec §6 button F 의 verb 추출 ("Drop articles" 같은 SQL parsing) — Q5-(b) 에서 거부.
- Spec §5 chrome H 의 sidebar dot (#2) / tab underline (#3) / status bar tint (#4) — Q4-(c) 에서 거부.
- 5-tier env enum 을 3-tier 로 축소하는 migration — Q1 에서 5-tag 보존 결정.
- 외부 audit-log 인프라.
- Mongo grid 의 read-only invariant 변경.
- ConfirmDestructiveDialog 와 SqlPreviewDialog 의 통합 — Q6 에서 별개 유지 결정.
- 신규 ADR 작성 — 본 spec + grill-decisions 가 ADR 0022 의 후속 결정 묶음으로 충분.

## Visual Direction

- **Top stripe** (Sprint 256): 영구, dev/null 환경 활성 탭에선 *완전히 미렌더* (시각 부재 자체가 안전 신호). staging/prod 활성 시 타이틀바 위 ~24px 높이 색띠 + 텍스트 + (prod 만) 펄스 dot.
- **Prod window border** (Sprint 256): App shell 의 outer container 에 1px solid `--tv-env-prod`. macOS 의 native title bar 와 충돌 없도록 inner border 처리.
- **Button F** (Sprint 256): "Execute on <conn>" 라벨 폭 ↑ 우려 (Q5 사용자 코멘트) — `max-w-[260px]` truncate + tooltip 으로 전체 노출. 모든 dialog footer 폭 ≥ 480px 확보.
- **Syntax palette** (Sprint 257): 각 theme 의 brand 와 syntax 색 의 *visual contrast* 가 ≥ 3:1 (WCAG large text). 큐레이션 시 contrast 자동 검증 helper (선택).

## Verification Hints

- **Sprint 253**: `pnpm vitest run src/components/layout/TabBar.test.tsx`. 수동 스모크: 1 connection 1 탭 → stripe 부재 확인. drag 빈 영역 release → snap.
- **Sprint 255**: `pnpm vitest run src/components/query/QueryTab.execution.test.tsx`. 수동 스모크: raw editor 에 `INSERT INTO x VALUES (1)` → preview dialog 상승. SELECT → 즉시 실행.
- **Sprint 254**: `pnpm vitest run src/lib/sql/sqlSafety.test.ts`. 단위 테스트 corpus 검토.
- **Sprint 256**: 수동 스모크 — prod connection 탭 활성 → 윈도우 빨강 stripe + 외곽 border. 탭 전환 → 즉시 갱신.
- **Sprint 257**: 수동 스모크 — `<html data-theme="clickhouse" data-mode="dark">` → SQL preview 색조 확인.

## References

- Reference spec (외부, 논의용): `Table View Design System/PRODUCTION-WARNING.md`
- 13-question grill 결과: `docs/sprints/sprint-253/grill-decisions.md`
- Banner 4-variants mockup (사용 안 됨, archived): `docs/sprints/sprint-253/banner-mockups.html`
- ADR 0022 (Safe Mode): `memory/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`
- Sprint 250-252 baseline: `docs/sprints/sprint-{250,251,252}/contract.md`
