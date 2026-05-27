# State Management Strategy Review — 2026-05-15

> Archived strategy snapshot. Active engineering SOT:
> [`memory/engineering/architecture/state-management/memory.md`](../../../memory/engineering/architecture/state-management/memory.md).

> **Scope**: Table View 의 모든 mutable state 위치를 전수 audit 후, 평가
> framework 위에서 현재 위치 vs 적합 위치를 매핑. 발견된 mismatch / 잠재
> invariant 누수를 표면화하고, 새 state 가 어디 갈지 판단할 결정 트리를
> 제시.
>
> **Related**: [`code-smell-audit-2026-05-15.md`](../audits/code-smell-audit-2026-05-15.md)
> Part B (L1–L10) — store 책임 / invariant 누수 발견과 본 문서가 같이
> 봐야 할 페어.

> **Status**: Grill 완료 (2026-05-15 ~ 16) — **29개 결정 lock + 폐기 2개**.
> **Part D Lock 표 + Part F Contracts 가 source of truth**. Part A–C 는
> 분석 / 매핑 단계의 history. Part C §5 의 D1–D5 미해결 결정은 모두 Part
> D 에서 lock 됨 (D1→Q9 등). Part C §6 추천 마이그 단계는 **Part E 에
> 의해 Superseded**. ADR 작성 단계로 진행 가능.

---

## 1. State Inventory — 전수 매핑

### 1.1 매체 6 종

| 코드 | 매체 | 영속성 | Sync read? | 크기 한계 | 구조화 query | Cross-window | 비고 |
|------|------|--------|-----------|-----------|--------------|--------------|------|
| **M1** | Memory (Zustand / ref / module var) | ❌ ephemeral | ✅ | RAM | ❌ | ❌ (`zustand-ipc-bridge` 있을 시만 ✅) | 가장 단순 |
| **M2** | Backend AppState (`Mutex<T>`) | ❌ process-scope | N/A (IPC) | RAM | ❌ | ✅ 자동 (process-shared) | live handle / token |
| **M3** | localStorage (plain) | ✅ durable | ✅ | 5MB total | ❌ (JSON only) | ❌ (`zustand-ipc-bridge` 보조) | 현재 frontend 영속 표준 |
| **M4** | localStorage + sessionId envelope (`session-storage.ts`) | session | ✅ | 5MB total | ❌ | 🟡 **같은 process 의 두 window 가 read 가능** (launcher + workspace 공유 의도). 자동 reactivity 는 IPC bridge / 재진입 hydration 필요 | misnomer — 실제는 M3 위 wrapper |
| **M5** | File storage (atomic write JSON) | ✅ durable | ❌ (IPC) | filesystem | ❌ (full read) | ✅ (file system) | `connections.json` 현재 |
| **M6** | SQLite (sqlx) | ✅ durable | ❌ (IPC) | filesystem | ✅ | broadcast 별도 | **현재 미사용** — sqlx feature 추가 필요 |

### 1.2 모든 mutable state — 33개 store/module/ref 항목 (+ §1.3 의 5 non-store LS 사이트 + excluded transient infra)

#### Frontend Zustand 필드

| # | State | 현재 매체 | 크기 | Cross-win | 영속 의도 |
|---|-------|-----------|------|-----------|-----------|
| 1 | `connectionStore.connections` (config + encrypted pw) | M5 (백엔드) + redacted M1 mirror | medium | ✅ IPC bridge | durable |
| 2 | `connectionStore.groups` | M5 + M1 mirror | small | ✅ | durable |
| 3 | `connectionStore.activeStatuses` | M4 → **M2 backend truth + M1 event mirror** (Q14 lock) | small | ✅ via emit_all | session |
| 4 | `connectionStore.focusedConnId` | M4 → **M1 launcher only** (Q15 lock) | tiny | ❌ launcher 전용 | ephemeral |
| 5 | `connectionStore.loading` / `hasLoadedOnce` / `error` | M1 only | tiny | ❌ | ephemeral |
| 6 | `workspaceStore.workspaces.tabs[i]` (id, type, sql 등) | M3 (200ms debounce) | medium | ✅ | durable |
| 7 | `workspaceStore.workspaces.tabs[i].queryState` (incl. **result**) | M3 ❌ 의도와 mismatch | **medium–large** | ✅ | **ephemeral** |
| 8 | `workspaceStore.workspaces.activeTabId` | M3 | tiny | ✅ | durable |
| 9 | `workspaceStore.workspaces.closedTabHistory` | M3 | medium | ✅ | durable (cap 미확인) |
| 10 | `workspaceStore.workspaces.dirtyTabIds` | M3 → **M1 window-local** (Q16 lock) | tiny | ❌ | ephemeral |
| 11 | `workspaceStore.workspaces.sidebar.selectedNode` | M3 → **M1 window-local** (Q17 lock) | tiny | ❌ | ephemeral (S2 scope) |
| 12 | `workspaceStore.workspaces.sidebar.expanded[]` | M3 | small | ✅ | durable |
| 13 | `workspaceStore.workspaces.sidebar.scrollTop` | M3 → **M1 window-local** (Q18 lock) | tiny | ❌ | ephemeral (S2 scope) |
| 14 | `schemaStore` 6개 캐시 (schemas/tables/views/functions/triggers/columns) | M1 | large | ❌ | ephemeral |
| 15 | `documentStore` 5개 캐시 (databases/collections/fields/queryResults/aggregateResults) | M1 | large | ❌ | ephemeral |
| 16 | `dataGridEditStore.entries` (pendingEdits/newRows/deletedKeys/undoStack) | M1 | medium | ❌ window-local | ephemeral |
| 17 | `queryHistoryStore.entries` (per-tab) | M1 | medium | ❌ | ephemeral (사실상 dead?) |
| 18 | `queryHistoryStore.globalLog` (cap 500) | M1 | medium | ❌ | **ephemeral but 사용자는 durable 기대** |
| 19 | `queryHistoryStore.searchFilter` / `connectionFilter` | M1 | tiny | ❌ | ephemeral |
| 20 | `themeStore.themeId` / `mode` | M3 (Zustand persist mw) | tiny | ✅ | durable |
| 21 | `themeStore.resolvedMode` | M1 only (computed per-window) | tiny | ❌ | ephemeral |
| 22 | `favoritesStore.favorites[]` | M3 (hand-rolled) | small | ✅ | durable |
| 23 | `mruStore.recentConnections[]` (cap 5) | M3 (hand-rolled) | tiny | ✅ | durable |
| 24 | `mruStore.lastUsedConnectionId` | M3 | tiny | ✅ | durable (backward compat — derived) |
| 25 | `safeModeStore.mode` | M3 (Zustand persist mw) | tiny | ✅ | durable |

#### 모듈-스코프 변수 (file-scope `let` / `const`)

| # | Variable | 위치 | 의도 | Seed from persisted? |
|---|----------|------|------|--------|
| 26 | `tabCounter` | `workspaceStore.ts:71` | tab id 생성 | ❌ **버그 가능** |
| 27 | `queryCounter` | `workspaceStore.ts:72` | query tab id 생성 | ❌ **버그 가능** |
| 28 | `historyCounter` | `queryHistoryStore.ts:102` | history entry id | ❌ (history 가 메모리 only 이라 무관) |
| 29 | `favoriteCounter` | `favoritesStore.ts:74` | favorite id | ✅ (line 133–134) |
| 30 | `requestCounters` (Map) | `documentStore.ts:73` | stale request guard | N/A (ephemeral) |
| 31 | `persistTimer` | `workspaceStore/persistence.ts:16` | 200ms debounce | N/A |
| 32 | `_sessionId` | `session-storage.ts:16` | session UUID cache | from Tauri IPC at boot |
| 33 | `lastApplied` | `themeStore.ts:93` | subscriber dedup | computed |

#### Backend Tauri AppState

| # | Field | 매체 | 의도 |
|---|-------|------|------|
| – | `active_connections: Mutex<HashMap<String, ActiveAdapter>>` | M2 | live DB handle |
| – | `connection_status: Mutex<HashMap>` | M2 | runtime status |
| – | `keep_alive_handles: Mutex<HashMap>` | M2 | tokio task handle |
| – | `query_tokens: Mutex<HashMap>` | M2 | cancel token |
| – | `session_id: String` (immutable) | M2 | per-process UUID |

#### 컴포넌트 useRef (의미 있는 mutable state)

7개 — `AppRouter.firstPaintMarkedRef`, `DataGrid.prevPropsRef` / `fetchIdRef` / `queryIdRef`, `DbSwitcher.lastFetchKeyRef`, `useDataGridEdit.fallbackInstanceKeyRef`, `FilterBar.autoCreatedRef`. 모두 M1 ephemeral — 적합.

#### Non-store local UI persistence — hand-rolled `window.localStorage` (5 사이트, Audit Part A §2.5)

| Site | Key | 무엇 | 현재 매체 | 결정 후 매체 |
|------|-----|------|----------|-------------|
| `HomePage.tsx:64, :73` | `RECENT_COLLAPSE_KEY` | Home "Recent" 섹션 접힘 | M3 (raw LS) | **A** (`settings.home_recent_collapsed`, Q20) |
| `Sidebar.tsx:32, :112` | `WIDTH_KEY` | sidebar 폭 | M3 | **A** (`settings.sidebar_width`, Q20, drag debounce 500ms) |
| `ConnectionGroup.tsx:43, :54` | `COLLAPSE_KEY` | group 접힘 | M3 | **A** (`connection_groups.collapsed`, Q20) |
| `useColumnWidths.ts:38` | `STORAGE_PREFIX` (per-table) | DataGrid column width | M3 | **A** (`datagrid_column_prefs.widths_json`, Q20) |
| `useHiddenColumns.ts:29` | `STORAGE_PREFIX` (per-table) | DataGrid 숨김 column | M3 | **A** (`datagrid_column_prefs.hidden_columns_json`, Q20) |

전부 Phase 1–4 사이에 SQLite 로 이주. Reset-to-default UI 의무 (Q21).

#### Excluded transient UI infra (audit scope 밖)

다음 mutable state 는 inventory 33 개 카운트에서 제외 — 모두 ephemeral
M1, 영속 의도 없음, 매체 결정 grill 대상 아님 (codex review 2026-05-16):

- `useToastStore` + module-scope `toastSeq` — toast queue. ephemeral M1.
- `draggedConnectionId` (ConnectionItem.tsx:46) — drag 중 transient.
- `summaryLogged` 등 module-scope dev-time flag — 한 process 1회 동작 가드.

이 그룹은 분류상 D (Client ephemeral) 의 sub-category. SQLite 이주 / event
broadcast 대상 아님 — 정책 단순 ("memory only, no persistence").

#### 사용 0

- URL state (React Router 미사용)
- Cookies / IndexedDB / WebSQL
- Window globals (production 0)
- sessionStorage (M4 가 misnomer — 실제는 localStorage)

---

## 2. 평가 Framework — 8 축

새 state 추가 시 또는 기존 state 재배치 시 다음 8 축 평가:

| 축 | 값 | 의미 |
|----|-----|------|
| **A1 영속성** | ephemeral / session / durable | app restart 후 복원 필요? |
| **A2 크기** | tiny <1KB / small <10KB / medium <100KB / large >100KB | 매체 한계 (localStorage 5MB 전체) |
| **A3 Sync read** | 필수 / 비필수 | 첫 paint 또는 sync 코드 경로에서 즉시 필요? |
| **A4 Cross-window** | 필요 / 불필요 | launcher ↔ workspace 둘 다 일관 view 필요? |
| **A5 구조화 query** | 필요 / 불필요 | 검색 / 필터 / ORDER BY / pagination 필요? |
| **A6 민감 정보** | 있음 / 없음 | 암호화 필요? |
| **A7 변경 빈도** | low / medium / high | high 면 batching / debounce 필요 |
| **A8 손실 짜증** | none / low / medium / high | 잃었을 때 사용자 비용 |

### 매체 선택 룰

```
if A6 (민감) → M5 file+encrypted (현재 connections.json) 또는 M6 SQLite+encrypted
elif A5 (구조화 query) → M6 SQLite
elif A3 (sync read 필수) AND A2 ≤ small → M3 localStorage
elif A1 == ephemeral → M1 memory
elif A1 == session AND A4 == ❌ → M1 memory (또는 M4 envelope 의도 있을 때만)
elif A1 == durable AND A2 ≤ medium AND A5 == ❌ → M3 localStorage
elif A1 == durable AND A2 > medium → M6 SQLite
elif process-scope live handle → M2 AppState
```

### 경계 케이스 — explicit 선택 필요

- **Theme**: A1 durable + A3 sync (boot FOUC 회피) + A2 tiny → M3 강제 (M6 이주 시 boot flash 위험).
- **Query history**: A1 durable + A5 구조화 + A2 medium-large → **M6 SQLite** (현재 M1 mismatch).
- **DataGrid pending edits**: A1 의도된 ephemeral + A8 medium (편집 lost 시 짜증) → M1 유지 + **crash recovery 별도 고민** (예: 5분마다 swap 파일).

---

## 3. 현재 위치 vs 적합 위치 — Mismatch 표

### 🔴 진짜 모순 (action 권장)

#### M-1. `QueryTab.queryState.result` 가 localStorage 에 persisted
- **현재**: `migrateLoadedWorkspaces` (persistence.ts:45) 는 **read 시** `queryState: idle` 로 collapse. 하지만 **write 시 strip 안 함**.
- **위험**: 큰 result (수만 행) 가 있는 query tab 이 여러개면 localStorage 5MB 전체 한계 위협. 한 번 5MB 넘으면 `localStorage.setItem` throw → `persistWorkspaces` 가 silent catch (line 25) → 워크스페이스 영속화 중단.
- **Fix**: `persistWorkspaces` 안에서 dehydration 함수로 다음을 strip 후 write:
  1. **활성 `tabs[]` 의 query tab**: `queryState` 를 `{ status: "idle" } as QueryState` 로 collapse (코드의 discriminant 이름이 `status`, `workspaceStore.ts:431` / `:495` 참조). result/rows/columns/sql 실행 결과 메모리 only.
  2. **`closedTabHistory[]` 의 query tab**: 같은 dehydration 적용. 닫힌 탭은 사용자가 재오픈 시 sql 텍스트만 복원되면 충분, 과거 result row 복원은 의도 아님.
  3. **`dirtyTabIds`**: write 시 빈 배열로 strip (Q16 lock).
  4. **`sidebar.selectedNode`**: write 시 null 로 strip (Q17 lock).
  5. **`sidebar.scrollTop`**: write 시 0 으로 strip (Q18 lock — Sprint 262 영속화 되돌림).
- **검증**: dehydration 후 JSON 크기 sanity bound — 한 workspace ≤ 50KB (typical). 초과 시 dev warning.
- **Severity**: 🔴 High — silent failure mode. 특히 `closedTabHistory` 는 사용자가 인지 못한 채로 큰 result 가 쌓일 수 있음.

#### M-2. `tabCounter` / `queryCounter` seeding 부재 — ID 충돌
- **현재**: `workspaceStore.ts:71-72` — `let tabCounter = 0`. App boot 시 0 으로 시작.
- **위험 시나리오**:
  1. 어제: workspace 에 5개 tab 생성 → `tab-1` … `tab-5` persisted.
  2. App restart → tabCounter = 0.
  3. 새 tab 추가 → `tab-1` 생성. **기존 `tab-1` 과 충돌**.
  4. `removeTab(connId, db, "tab-1")` 시 두 tab 중 어느 하나 삭제 (`tabs.find` 가 첫 매치).
- **`favoriteCounter` 는 seed 함** (line 133–134): `if (!isNaN(num) && num > favoriteCounter) { favoriteCounter = num; }`. tab/query 도 같은 패턴 필요.
- **Fix**: `loadPersistedWorkspaces` 안에서 모든 workspaces 의 tab id 를 scan 해서 counter seed.
- **Severity**: 🔴 High — silent invariant violation, 재현 가능.

#### M-3. Query history 가 메모리만 — 사용자 가치 vs 매체 mismatch
- **현재**: `queryHistoryStore.globalLog` 메모리, cap 500.
- **A5 (구조화 query) = 필요** (`filteredGlobalLog` 가 search + connection filter), **A1 = durable** (어제 쿼리 찾고 싶음), **A2 = medium** (500 entry × 평균 1KB ≈ 500KB).
- **Framework 결과**: **M6 SQLite**.
- **현재 M1 의 결과**: app restart 시 lost. Cap 500 도 메모리 절약 목적, SQLite 면 unlimited.
- **Severity**: 🔴 Medium-High — 기능 회귀 위험 없는 ROI 명확.

#### M-4. `entries` vs `globalLog` — 책임 중복 (정정 2026-05-16)
- **현재**: `entries` 와 `globalLog` 둘 다 메모리.
  - `entries` 는 **live** — `QueryLog.tsx:32`, `QueryTab.tsx:58` 에서 active read. 무제한 누적, per-tab history panel source.
  - `globalLog` 는 cap 500 + `filteredGlobalLog()` (search + connectionFilter) 가 read.
  - `clearHistory()` 는 `entries`, `clearGlobalLog()` 는 `globalLog`.
- **이전 audit 오류**: "dead state 가능" 으로 잘못 분류. 실제는 live source — 두 array 모두 사용 중.
- **진짜 문제**: **책임 중복** — 두 array 가 같은 entry 를 다른 cap 정책으로 관리. `entries` 는 무제한 (메모리 누수 가능), `globalLog` 는 cap 500, search 도 한 쪽만. SQLite 이주 시 단일 source 로 통합 권장.
- **Severity**: 🟡 Medium — Part B L5 와 같은 발견 (이중성). Phase 5 이주 시 한 table 로 합침.

---

### 🟡 mismatch (검토 권장)

#### M-5. `sidebar.scrollTop` / `selectedNode` / `dirtyTabIds` 가 durable persisted — **RESOLVED (Q16–Q18)**
- **현재**: workspace 의 일부로 M3 영속화.
- **분석**:
  - `scrollTop` — A1 session (다음 boot 에 같은 스크롤 의미 없음). 영속화는 over-engineering.
  - `selectedNode` — 보통 session (boot 후 default selection 으로 OK).
  - `dirtyTabIds` — A1 session (commit 안 한 편집은 메모리 사라지면 의미 없음).
- **결정**: 셋 다 M1 window-local demote (Q16/Q17/Q18 lock). Phase 0 dehydration 에서 strip.

#### M-6. DataGrid pending edits — 손실 시 짜증 vs 의도된 ephemeral
- **현재**: M1 window-local, app close / crash 시 lost.
- **A8 손실 짜증 = medium-high** — 5개 셀 수정 중 사고 close 면 짜증.
- **의도**: tab close 시 명시적 discard (현재 패턴). 즉 **명시적 discard 만 lost 의도** — crash 는 의도와 다름.
- **Fix 옵션**:
  - (a) 변경 없이 유지 (현재).
  - (b) M3 영속화 (window-local 의도 깨짐).
  - (c) M6 영속화 + crash recovery (큰 변화).
  - (d) 5분 timer swap (snapshot file) — 작은 추가.
- **Severity**: 🟡 Low-Medium — UX 결정.

#### M-7. `session-storage.ts` 이름 misnomer
- **현재**: 이름은 sessionStorage 같으나 실제 `window.localStorage` + sessionId envelope.
- **이유**: 진짜 sessionStorage 는 window 별로 분리 — cross-window 동기화 불가. localStorage 가 cross-window 가능. sessionId envelope 으로 "session-scoped" 의미 흉내.
- **개선**: 이름만 변경 (`session-scoped-storage.ts` 또는 `scopedLocalStorage.ts`) + 모듈 doc 명시.
- **Severity**: ⚪ Low — 동작 정상, 이름만.

---

### ⚪ 일관성 (정리)

#### M-8. Zustand persist middleware 일관성 깨짐
- **현재**:
  - middleware 사용: `themeStore`, `safeModeStore` (2개).
  - hand-rolled: `workspaceStore` (debouncePersistWorkspaces), `favoritesStore` (persistFavorites), `mruStore` (persistMruList), `connectionStore` (session-storage wrapper).
- **이유 추정**: hand-rolled 가 더 많은 통제 (envelope, migration, debounce). middleware 는 작은 store 에 적합.
- **개선 후보**: 한 패턴으로 통일 — middleware + 작은 wrapper 추출, 또는 모두 hand-rolled.
- **Severity**: ⚪ Low — 정상 동작.

#### M-9. 모듈-스코프 변수 8개가 store 파일 안에 hidden state
- **현재**: counter / cache / timer 가 `let` / `const` 로 file-scope.
- **문제**: Zustand selector 로 보이지 않음. test 에서 reset 어려움 (특히 `historyCounter` 는 `__resetForTests` 없음).
- **개선**:
  - counter 들 → store state 의 일부로 (selector 안 보이게는 internal field).
  - timer / cache → 명시적 cleanup API.
- **Severity**: ⚪ Low — 정상 동작.

---

## 4. 매체 별 적합 데이터 — 결정 트리 (요약)

```
┌──────────────────────┐
│ 새 state 등장        │
└──────────┬───────────┘
           ↓
┌──────────────────────────────────┐
│ A6 민감 정보?                    │
└──────────┬───────────────────────┘
           ├─ YES → M5 file+enc (또는 M6 SQLite + 암호화)
           ↓ NO
┌──────────────────────────────────┐
│ A5 구조화 query 필요?            │
└──────────┬───────────────────────┘
           ├─ YES → **M6 SQLite** (현재 인프라 없음 — 도입 비용 있음)
           ↓ NO
┌──────────────────────────────────┐
│ live process handle?             │
└──────────┬───────────────────────┘
           ├─ YES → M2 AppState
           ↓ NO
┌──────────────────────────────────┐
│ A1 영속성?                       │
└──────────┬───────────────────────┘
           ├─ ephemeral → M1 memory
           ├─ session   → M1 memory (또는 M4 envelope — cross-window 필요 시만)
           ├─ durable   ↓
┌──────────────────────────────────┐
│ A3 sync read 필수?               │
│ (boot FOUC / sync 경로)          │
└──────────┬───────────────────────┘
           ├─ YES → M3 localStorage (sync read)
           ↓ NO
┌──────────────────────────────────┐
│ A2 크기?                         │
└──────────┬───────────────────────┘
           ├─ tiny/small/medium → M3 localStorage
           └─ large             → M6 SQLite (또는 M5 큰 파일)
```

---

## 5. 미해결 결정 — D1–D5 (모두 Part D 에서 lock 됨, history 보존)

> **Status (2026-05-16)**: D1–D5 는 grill 진행 중 Part D 의 Q1–Q11 +
> Q5.1–Q5.6 로 펼쳐져 lock 됨. 매핑: D1 → Q9 (SQLite + bootstrap), D2
> → Phase 5 query history 이주, D3 → Q6 (현재 유지), D4 → Phase 0
> M-2 fix, D5 → Phase 6. 본 섹션은 분석 history 보존용.

이 5 결정이 lock 되어야 ADR 작성 + 마이그 가능.

### D1. SQLite 인프라 도입할 것인가?

- Option (a) **도입**: sqlx 에 `sqlite` feature 추가 + migration system 도입 (`sqlx::migrate!`) + `storage/local.rs` 신설.
  - 비용: feature flag + sqlite3 native build dep (cross-platform 확인). Cargo.toml 1 줄 + 인프라 sprint 1개.
  - 이득: query history 영속화 + 검색, 미래 structured state 의 정착점.
- Option (b) **도입 안 함**: M3 localStorage 만 사용. 큰 누적 데이터는 cap.
  - 비용: query history 가 영속 불가 + 5MB total limit 그대로.

**Tradeoff**: 도입 비용 1 sprint vs query history / 미래 structured data 영속 가능.

### D2. Query history 이주 우선순위?

D1 = (a) 도입 가정 하에:
- Option (a) **즉시 이주**: query history 를 첫 SQLite client 로 — sprint 1 의 사용 사례로 인프라 검증.
- Option (b) **추후**: 인프라만 도입 + history 는 나중에.

**Tradeoff**: 즉시 이주가 인프라 검증을 강제하지만 sprint 범위 커짐.

### D3. `dataGridEditStore` crash recovery 필요한가?

- Option (a) **현재 유지** (memory only) — 명시적 discard 만 lost. crash 는 의도와 다르나 비-인지 영역.
- Option (b) **5분 swap snapshot** — IndexedDB 또는 localStorage 에 backup. recover 시 prompt.
- Option (c) **항상 M3 영속화** — window-local 의도 깨짐, 다른 window 에 leak 가능 (Part B L1 관련).

**Tradeoff**: 사용자 가치 (UX) vs 코드 복잡도 vs invariant 유지.

### D4. Tab counter seeding fix 즉시 vs 마이그 시?

M-2 의 fix:
- Option (a) **즉시 패치** (별도 sprint) — 작은 bug fix.
- Option (b) **state-management 마이그 sprint 에서 같이** — 만약 D1 도입 시 ID 생성 자체를 SQLite autoincrement 로 옮기면 자연 해결.

**Tradeoff**: 시간 vs 일괄 처리.

### D5. `session-storage.ts` 이름 정리 + Zustand middleware 일관성?

- Option (a) **그대로** — 동작 정상, 일관성은 cosmetic.
- Option (b) **rename + middleware 통일** — drive-by cleanup sprint.

**Tradeoff**: cosmetic, 우선순위 낮음.

---

## 6. 추천 마이그 단계 — ~~SUPERSEDED~~ (Part E 가 source of truth)

> **Status (2026-05-16)**: 본 섹션은 D1–D5 가정 위에서 작성된 *초기*
> Phase 초안. Grill 완료 후 **Part E — 마이그 Phase Plan** 이 최종
> source of truth. 본 섹션은 의사결정 history 보존용으로만 남김.
>
> 차이점: Part E 는 Q5.x (connection affinity), Q3 (single-instance),
> Q9 (snapshot bootstrap) 등 추가 lock 을 반영해 Phase 0–6 으로 재구성.

(아래는 history)

### D1 = a, D2 = a, D3 = a, D4 = a, D5 = a 가정

### Phase 0 — Quick fixes (1 sprint, 인프라 영향 0)
- **M-1 fix**: `persistWorkspaces` 에 dehydration step (`queryState → idle` strip).
- **M-2 fix**: `loadPersistedWorkspaces` 에서 counter seed.
- **M-4 검증**: `entries` read 사이트 grep — 0 이면 삭제, 있으면 의미 명문화.

### Phase 1 — SQLite 인프라 (1 sprint)
- `sqlx` feature `sqlite` 추가.
- `storage/local.rs` + `migrations/` 디렉토리.
- 첫 schema: `query_history(id, sql, executed_at, duration_ms, status, connection_id, paradigm, query_mode, database, collection, source)`.
- `tauri::Command` IPC: `add_history_entry`, `list_history(filter)`, `get_history_detail(id)`, `clear_history` (codex 8차 #2 — final wire 이름과 통일. Part D 의 F.5 가 source of truth).
- Frontend `useQueryHistory()` hook + Tauri event broadcast on insert.

### Phase 2 — Query history 이주 (1 sprint)
- `queryHistoryStore` retire — backend 가 source.
- 모든 `addHistoryEntry` 호출 → IPC.
- search / connectionFilter → SQL WHERE.
- localStorage globalLog 삭제 (마이그 코드는 한 번 read → backfill SQLite → key 삭제).

### Phase 3 — 인프라 명문화 (1 sprint)
- ADR 신설: **"State medium decision rules"** — 본 문서 section 2, 4 의 framework.
- `session-storage.ts` rename + doc 명확화 (D5).
- 모듈 변수 8개 정리 (D5).

### Phase 4 (선택) — 추가 이주 후보
- DataGrid pending edits crash recovery (D3 선택 따라).
- `closedTabHistory` cap 추가.
- `sidebar.scrollTop` 등 session 신호 M1 로 demote.

---

---

# Part D — Grill Lock 결과 (2026-05-15 ~ 16)

D1–D5 grill 진행 중 추가 결정 트리 펼쳐짐 — 총 12개 결정 lock. 진짜
요구사항 7개 (#1 multi-window sync ~ #17 multi-instance) 위에서 결정.

## 29개 Lock + 폐기 2개 (최종, 2026-05-16 8차 갱신 — 미해결 0)

| # | 영역 | 결정 |
|---|------|------|
| **Q1** | Export envelope 범위 | **(b)** connections 만 envelope. favorites/mru/workspaces 는 새 머신서 재생성. ADR 0021 envelope 모델 유지 |
| **Q2** | Corrupt 영속 정책 | **(a')** silent quarantine — `.corrupt-{timestamp}` 또는 `.bak` backup 남기되 사용자 toast 없음. 디버깅용 |
| **Q3** | Multi-instance 정책 | **(b) single-instance 강제** — `tauri-plugin-single-instance`. 2번째 launch → 기존 window focus. **Launcher window 영속** — connection 열고 workspace 떠도 launcher 안 사라짐 |
| **Q4** | Cross-window sync 범위 | **In-process Tauri event 만** — single-instance 가정 위에서 같은 process 의 launcher ↔ workspace 동기화. ~~L3 cross-process model~~ 폐기 |
| ~~Q4.a~~ | ~~file watcher~~ | **제거** — single-instance 라 불필요 |
| ~~Q4.b~~ | ~~cross-process cache invalidation~~ | **제거** — 같은 process 안 backend 가 DDL 후 emit, 다른 window 가 in-process receive |
| **Q5** | Backend connection 모델 | **M-affinity** — tab = session. TablePlus 패리티 (transaction / SET / TEMP TABLE) |
| **Q5.1** | 같은 conn ID 의 두 tab | **(1)** 각자 dedicated PoolConnection. 격리 |
| **Q5.2** | Tab close 시 처리 | **(a)+(α)** 즉시 release + transaction 자동 rollback (silent, confirm 없음) |
| **Q5.3** | Cancel 메커니즘 | **(a)** paradigm-native (`pg_cancel_backend` / `KILL QUERY` / `killOp`) 통일. `DbAdapter::cancel_query` 추가 |
| **Q5.4** | Sidebar 격리 | **(1)** 별도 introspection pool — shared idle connection round-robin |
| **Q5.5** | Cancel 실패 처리 | **(c) Hybrid** — `AlreadyCompleted` silent, `PermissionDenied` / `NetworkError` toast |
| **Q5.6** | Tab 수 한계 | **(c) Lazy acquire** — tab 열어도 connection 안 잡음. 첫 query/SET/BEGIN 실행 시 acquire. Idle tab 자원 0 |
| **Q6** | Crash 시 DataGrid pending edits | **(a)** 현재 유지. TablePlus / DBeaver 와 동일. Auto-save 안 함 |
| **Q7** | Audit log | **(a)+(c)** 별도 audit table 신설 안 함. `query_history.source` 필드 확장으로 DDL / Mongo write 까지 분류 |
| **Q8** | First-run | **(a)** 빈 화면 + "Add Connection" 강조 CTA |
| **Q9** | Boot hydration | **(c)** 단일 snapshot IPC — `getInitialAppState()` 1회, SQLite atomic snapshot, boot critical 5 store hydrate |
| **Q10** | Telemetry | **(a) 수집 0 명문화** — 분석 / crash report / 사용량 통계 외부 송신 0. ADR 으로 lock |
| **Q11** | Auto-update | **(c) Notification only** — GitHub releases GET check, 새 버전 toast, 다운로드는 외부 브라우저. Signing infra 불필요 |
| **Q12** | Theme + SafeMode SOT | **(b) SQLite = truth** — 액션은 IPC `set_setting` → SQLite write → `emit_all("state-changed", {domain:"setting",entityId:key})` → 모든 window 가 `get_setting(key)` refetch → store mutate. **분리 (codex 5차 #1 fix)**: (a) `theme` 는 FOUC critical 이라 추가로 각 window 가 mutate 후 자기 LS (`table-view-theme`) sync write — ThemeBoot 가 다음 boot 의 LS sync read 로 즉시 paint. (b) `safeMode` 는 boot FOUC critical 아님 — **LS read/write 0**. Boot 시 snapshot 의 SQLite truth 만 사용 (default `none` 까지 IPC 대기 OK). 기존 `view-table.safeMode` LS key 는 Phase 6 cleanup |
| **Q13** | Workspace window 정책 | **(a) Connection 당 최대 1 workspace window — TablePlus 패턴**. 같은 conn 두 번 클릭 시 backend 가 기존 window label (`workspace-{connection_id}`) focus, 새 window 안 뜸. 서로 다른 N 개 connection 동시 가능. **Window 는 connection 당 1 개, persisted sub-workspace 는 `(connection_id, db_name)` 단위** — 한 window 안에서 사용자가 DB 전환할 때마다 sub-workspace state 가 분리 영속. `workspaces` SQLite PK = `(connection_id, db_name)`. `query_history` 도 `connection_id` 만으로 충분 — `workspace_id` 컬럼 / index 제거 |
| **Q14** | `activeStatuses` 매체 | **Backend M2 (`Mutex<HashMap<conn_id, Status>>`) = truth**. Status 변경 시 backend `emit_all("state-changed", {domain:"connection",op:"status"})`. 모든 window 가 자기 store 의 statuses 슬롯 mirror 갱신. Snapshot bootstrap 에 포함 — boot 시 backend 가 current state 채워 보냄. M4 envelope 의존 제거 |
| **Q15** | `focusedConnId` 매체 | **Launcher window in-memory M1 only**. Sidebar selection 신호일 뿐 — durable 의도 0. Launcher mount 시 default = `mruStore.lastUsedConnectionId` 또는 null. M4 envelope retire. **Workspace window 의 마이그**: 현재 `Sidebar.tsx`, `workspaceStore.useCurrentWorkspaceKey` 등이 `focusedConnId` 를 "이 window 가 보는 connection" 의 의미로도 사용 — 이건 사실 **window identity** (Q13 으로 1:1 결정됨). Phase 4 에 `useCurrentWindowConnectionId()` hook 도입, Tauri window label (`workspace-{conn_id}`) 에서 const derive. Workspace code path 의 모든 `connectionStore.focusedConnId` read 가 이 hook 으로 대체되어 grep 시 0. Launcher code path 만 store slot read 유지 |
| **Q16** | `dirtyTabIds` 매체 | **M1 window-local only — 영속에서 strip**. 진짜 source 는 `dataGridEditStore.pendingEdits` (Q6 lock 으로 memory only). 영속하면 boot 후 stale marker → DataGrid mount 가 false publish 하면 사라짐 = 일관성 깨짐. Boot 시 빈 배열, 첫 DataGrid mount 가 진짜 dirty 계산. F.6 Phase 0 AC 에 dehydration strip 추가 |
| **Q17** | `sidebar.selectedNode` scope/매체 | **Scope S2 (sub-workspace 전환 시까지만), 매체 M1 window-local**. Workspace store 의 in-memory map `{ (connId, db) → selectedNode }`. App restart 후엔 null — schema/category 클릭은 1회성 navigation 신호, 영속 가치 0. 영속에서 strip |
| **Q18** | `sidebar.scrollTop` scope/매체 | **Scope S2, 매체 M1 window-local**. Sprint 262 Slice B 의 M3 영속화 결정은 **명시적으로 되돌림** — 같은 process 안 DB 전환 시 복원 (`useSidebarScrollPersistence` 의 진짜 가치) 만 충족하면 충분, App restart 후 scrollTop 복원은 over-engineering. Hook 은 그대로 유지 (M1 store read/write 로 변경). 영속에서 strip |
| **Q19** | `closedTabHistory` cap | **B with N=25** — sub-workspace `(connId, db)` 별 LRU 25 개. Push 시 length > 25 면 oldest drop. Boot dehydration 시에도 25 초과 entries 잘라서 write. Chrome 의 25 와 동일, "직전 닫은 N 개 복원" 이 main usecase 면 충분. M-1 dehydration 의 query result strip 과 결합해 byte 한계 보호. **현재 코드 cap = 20 (`workspaceStore.ts:251` `.slice(0, 20)`) — Phase 0 에 `slice(0, 25)` 로 변경** |
| **Q20** | Non-store hand-rolled LS 5 사이트 매체 | **모두 A (Backend durable, SQLite + `emit_all`)**. (1) `RECENT_COLLAPSE_KEY` → `settings.home_recent_collapsed` boolean. (2) `WIDTH_KEY` → `settings.sidebar_width` integer + drag 중 D 메모리, mouseup 시 IPC (debounce 500ms). (3) `COLLAPSE_KEY` → `connection_groups.collapsed` boolean 컬럼 추가. (4) `columnWidths` → 신규 table `datagrid_column_prefs(connection_id, paradigm, db_name, namespace, table_name, widths_json, hidden_columns_json, updated_at)` PK `(connection_id, paradigm, db_name, namespace, table_name)` (codex 7차 #2 — DDL / entityId JSON key 와 `db_name` 통일). drag end 시 IPC. (5) `hiddenColumns` → 같은 table 의 `hidden_columns_json`. 정책 통일 + cross-window 일관성 자연스러움 |
| **Q21** | 영속 상태의 reset-to-default UI 요구 | **모든 A/C 영속 상태는 사용자가 직관적 위치에서 default 로 되돌릴 수 있어야 함**. 각 영속 항목마다 reset affordance 위치 명시 (Phase 6 audit 의무). 일반 원칙: (a) tiny UI 가구 (collapse / width) — 더블클릭 / 우클릭 컨텍스트 메뉴의 "Reset" 항목, (b) per-table prefs (columnWidths / hiddenColumns) — DataGrid 헤더 우클릭 메뉴, (c) global settings (theme / safeMode) — 설정 패널 안 "Reset to defaults" 버튼, (d) workspace state — sidebar / 메뉴의 "Reset workspace layout". F.6 Phase 6 AC 에 사이트별 audit 항목 추가, 누락 시 머지 보류 |
| **Q22** | File-key 저장 위치 | **OS 키체인** (`keyring` Rust crate). macOS Keychain / Windows Credential Manager / Linux Secret Service. Entry name `com.tableview.app.file-key`. 디스크에 `.key` 평문 두지 않음 — 노트북 도난 / 디스크 image dump 시 OS 로그인 모르면 풀 수 없음. **Linux fallback**: Secret Service 없는 환경 (서버 / minimal desktop) 에서 `.key` 파일 mode (현재 동작, perm 0o600) 유지, 사용자에게 "디스크 암호화 권장" toast. **Migration**: 기존 사용자 boot 시 1회 `get_or_create_key()` 가 (1) keyring read 시도, (2) 없으면 디스크 `.key` 존재 확인, (3) 디스크에 있으면 keyring 으로 import + 디스크 파일 0o000 권한 변경 후 secure delete. Threat 1 (offline disk-access) 보호 추가, Threat 2 (running malware) 는 보호 못 함 (어떤 옵션이든 동일) |
| **Q23** | SchemaCache invalidation 정책 | **(a) in-process event + wide + eager**. DDL 실행한 window 의 IPC 응답 후 backend 가 `emit_all("state-changed", {domain:"schemaCache", op:"invalidate", entityId:connection_id})`. 모든 window 의 `schemaStore` 가 그 `connection_id` 의 **전체 cache** drop (wide — schemas/tables/views/functions/triggers/columns 모두) + sidebar 가 mount 중이면 **즉시 refetch** (eager). Self-echo: DDL 한 window 는 IPC 응답에서 이미 처리, event 도착 시 originWindow 일치하면 skip. Narrow invalidation 은 추후 ROI 확인 후 도입 (현재는 단순성 우선) |

## Boot 모델 (Q9 lock)

```
[Window launch]
  ↓ getInitialAppState() IPC (~10ms)
[Backend SQLite atomic snapshot + M2 runtime]
  ├─ connections + groups                                   (durable A)
  ├─ workspaces — Map<conn_id, Map<db_name, WorkspaceState>>(durable A, Q13)
  ├─ mru                                                    (durable A)
  ├─ settings (theme, safeMode, sidebar_width, …)           (durable A)
  └─ runtime.activeStatuses                                  (ephemeral B, Q14)
[Frontend hydrate]
  - connectionStore: items+groups (durable) + activeStatuses (runtime mirror)
  - workspaceStore / mruStore / themeStore / safeModeStore
  - Launcher window 만 focusedConnId 슬롯 사용 — default = mru[0] (Q15)
  - Workspace window 의 connection identity = Tauri window label derive
[Lazy stores — 사용자 그 기능 처음 쓸 때 별도 IPC]
  - favoritesStore (favorites panel 열 때)
  - queryHistoryStore (history panel 열 때)
  - schemaStore / documentStore (connect 후)
  - dataGridEditStore (영속 없음, 메모리만)
```

## Connection 모델 (Q5.x lock)

```
[Rust AppState (single-instance)]
  active_connections: HashMap<connection_id, ActiveAdapter>
    "conn-1" → AdapterEnum::Pg(PgAdapter {
      introspection_pool: PgPool (shared idle, max_K=5),
      tab_affinity: HashMap<tab_id, Option<(PoolConnection, server_pid)>>,
                                    ↑ Q5.6 lazy: None until first query
    })
    "conn-2" → ...

[Tab lifecycle — Q5.6 lazy acquire]
  - Tab open              → tab_affinity[tab_id] = None (자원 0)
  - First query/SET/BEGIN → acquire PoolConnection, server_pid 기록
  - 이후 같은 tab 의 모든 query → 같은 (PoolConnection, server_pid)
  - Cancel                → cancel_query(server_pid) native
  - Tab close             → release, transaction 자동 rollback (silent)

[Sidebar / autocomplete / prefetch]
  - introspection_pool 의 idle connection round-robin
  - Affinity 와 무관 — long user query 동안에도 schema tree 동작
```

## Single-instance 모델 (Q3 + Q4 lock)

```
[Single Process — tauri-plugin-single-instance]
  ├─ Rust backend (AppState)
  │   - active_connections: HashMap<conn_id, ActiveAdapter>
  │   - tab_affinity: HashMap<tab_id, Option<PoolConnection>>  (Q5.6 lazy)
  │   - introspection_pool: shared idle (Q5.4)
  │   - query_tokens: HashMap<query_id, CancellationToken>
  │
  ├─ Launcher window (영속 — connection 열고 workspace 떠도 안 사라짐)
  │   → 새 connection 추가 / 열기 가능
  │
  └─ Workspace window(s) — lazy spawn (ADR 0017)
      → 같은 backend 공유, 같은 in-process EventEmitter

[Cross-window sync — in-process Tauri event]
  - Backend: tauri::AppHandle::emit_all("state-changed", payload)
  - 모든 window 가 같은 process 안 receive
  - 별도 broadcast 인프라 (file watcher / events table) 불필요

[2번째 launch 시도]
  - tauri-plugin-single-instance 가 가로채서 기존 instance focus
  - args 전달 가능 (예: connection ID hint)
```

---

# Part E — 마이그 Phase Plan (29개 lock + 폐기 2개 반영)

각 Phase 가 1 sprint 단위. 종속성 그래프 명시. Q3 = single-instance 로
변경되어 multi-process 인프라 Phase 제거.

## Phase 0 — Quick fixes (인프라 영향 0)
**선행 조건**: 없음. 즉시 진행 가능.

- **M-1 fix**: `persistWorkspaces` 에 dehydration step — `queryState` 를 idle 로 strip 후 write. localStorage 5MB 위협 제거.
- **M-2 fix**: `loadPersistedWorkspaces` 에서 `tabCounter` / `queryCounter` seed (favoriteCounter 패턴 적용).
- **L2 정리** (Part B): `schemaStore` 의 비-schema 5 메서드 (`queryTableData` / `executeQuery` / `executeQueryBatch` / `dropTable` / `renameTable`) → `lib/tauri/*` 직접 호출로 옮김.
- **M-4 메모만**: `entries` / `globalLog` 책임 중복은 Phase 5 (history 이주) 에서 single table 로 통합 — Phase 0 에서는 변경 없음 (현재 두 array 모두 live source).

## Phase 1 — SQLite 인프라 (Q1, Q9 의 토대)
**선행 조건**: Phase 0.

- `sqlx` Cargo feature `sqlite` 추가. 현재 `src-tauri/Cargo.toml` 에 `[features]` section 없음 — Phase 1 첫 commit 으로 다음 추가:
  ```toml
  [features]
  default = ["sqlite"]
  sqlite = ["sqlx/sqlite", "sqlx/runtime-tokio-rustls"]
  ```
  이후 AC 의 `cargo build --features sqlite` 가 검증 가능.
- `src-tauri/migrations/0001_initial.sql` — tables: `connections`, `connection_groups` (with `collapsed`), `workspaces` (PK `(connection_id, db_name)`), `mru`, `settings` (key-value), `query_history`, `favorites`, `datagrid_column_prefs`, `meta` (key-value, `legacy_imported` 4-state + sentinels). 9 tables (8 domain + meta).
- **`query_history` schema (explicit, Q13 반영)**:

  ```sql
  CREATE TABLE query_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id   TEXT NOT NULL,                 -- FK soft → connections.id (Q13 으로 workspace 1:1)
    tab_id          TEXT,                          -- nullable: sidebar-prefetch / oneshot 은 null
    paradigm        TEXT NOT NULL,                 -- 'rdb' | 'document'
    query_mode      TEXT NOT NULL,                 -- dispatched method. rdb='sql'; document=find|findOne|aggregate|countDocuments|estimatedDocumentCount|distinct|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite (codex 6차 #2 — tab hint 와 별도, 실제 dispatch 된 method)
    database        TEXT,                          -- PG: database name, MySQL: schema, Mongo: db
    collection      TEXT,                          -- Mongo collection / RDB table (sidebar derived)
    source          TEXT NOT NULL,                 -- 'raw' | 'grid-edit' | 'ddl-structure' | 'mongo-op' | 'sidebar-prefetch'
    sql             TEXT NOT NULL,                 -- 원문 (Mongo: JSON-serialized op spec)
    sql_redacted    TEXT NOT NULL,                 -- Part F.5 privacy — 항상 생성. redact 함수 결과 또는 sql 그대로 (fallback). 검색은 이 컬럼 위에서 단일 path
    status          TEXT NOT NULL,                 -- 'success' | 'error' | 'cancelled' (기존 `QueryHistoryStatus` type 과 일치, queryHistoryStore.ts:10)
    error_message   TEXT,
    rows_affected   INTEGER,
    duration_ms     INTEGER NOT NULL,
    executed_at     INTEGER NOT NULL,              -- unix ms
    server_pid      INTEGER                        -- Q5.3 cancel diagnostics
  );
  CREATE INDEX idx_history_connection_executed ON query_history(connection_id, executed_at DESC);
  CREATE INDEX idx_history_tab ON query_history(tab_id) WHERE tab_id IS NOT NULL;
  ```

  Q13 (workspace per connection 1:1) 으로 `workspace_id` 컬럼 / index 제거.
  Phase 5 의 per-tab derivation 은 `WHERE connection_id = ? AND tab_id = ?`
  로 covered (둘 다 index 있음).

  **`add_history_entry` IPC wire type (camel↔snake 변환은 backend 가 담당)**:

  ```ts
  // 공통 discriminated union (codex 9차 #4 — Add/List filter/Row 가
  // 모두 같은 union 을 참조해야 invalid combo 가 타입상 차단됨).
  type DocumentHistoryQueryMode =
    | "find" | "findOne" | "aggregate" | "countDocuments"
    | "estimatedDocumentCount" | "distinct"
    | "insertOne" | "insertMany" | "updateOne" | "updateMany"
    | "deleteOne" | "deleteMany" | "bulkWrite";
  type HistoryQueryMode =
    | { paradigm: "rdb";      queryMode: "sql" }
    | { paradigm: "document"; queryMode: DocumentHistoryQueryMode };

  // List 필터용 별도 union (codex 10차 #1) — queryMode 단독 필터
  // 타입상 차단. paradigm 없이는 queryMode 도 없어야 함.
  type HistoryQueryModeFilter =
    | { paradigm?: undefined; queryMode?: undefined }
    | { paradigm: "rdb";      queryMode?: "sql" }
    | { paradigm: "document"; queryMode?: DocumentHistoryQueryMode };
  // Backend Rust 표현 (#[serde(tag = "paradigm", rename_all = "lowercase")]
  // + 내부 enum 으로 queryMode 매핑). Invalid combo (예: paradigm:"rdb"
  // + queryMode:"find") 는 serde 가 deserialize 단계에서 reject → IPC 400.

  // frontend 송신 (camelCase)
  type AddHistoryEntryRequest = HistoryQueryMode & {
    connectionId: string;
    tabId: string | null;
    database: string | null;
    collection: string | null;
    source: "raw" | "grid-edit" | "ddl-structure" | "mongo-op" | "sidebar-prefetch";
    sql: string;
    status: "success" | "error" | "cancelled";
    errorMessage: string | null;
    rowsAffected: number | null;
    durationMs: number;
    executedAt: number;       // unix ms — frontend wall clock, backend 가 검증 (M6 fix)
    serverPid: number | null;
  };
  // Backend: #[derive(Deserialize)] + #[serde(rename_all = "camelCase")] —
  // 변환 단일 위치. SQLite insert 는 snake_case 컬럼명 사용.
  // sql_redacted 는 backend 가 redact 함수로 생성 (frontend 전송 안 함).
  //
  // executedAt validation (M6 fix): backend 가 `now_ms = SystemTime::now()` 와
  // frontend `executedAt` 의 차이 측정. |diff| > 5분 이면 frontend clock drift —
  // backend `now_ms` 로 override + dev warning log. Frontend 의 monotonic
  // ordering 은 보존하되 절대 시간은 server 가 truth.
  ```

  기존 store 의 camelCase 필드와 동일 — 변환 비용 0 on frontend side.

- **`workspaces` table (Q13 반영)**:

  ```sql
  CREATE TABLE workspaces (
    connection_id   TEXT NOT NULL,                 -- Q13
    db_name         TEXT NOT NULL,                 -- Sprint 262 의 (connId, db) sub-workspace 키
    active_tab_id   TEXT,
    tabs_json       TEXT NOT NULL,                 -- queryState/dirty/scrollTop/selectedNode strip 후 (Q16–Q18)
    sidebar_expanded_json TEXT NOT NULL,
    closed_tabs_json TEXT NOT NULL,                -- cap 25 (Q19)
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (connection_id, db_name)
  );
  ```

  tabs / sidebar.expanded / closedTabs 는 JSON blob — partial update 비용 < 단순성.
  Debounce 200ms 후 한 번에 write (Phase 4). `sidebar.selectedNode` /
  `sidebar.scrollTop` / `dirtyTabIds` 는 Q16–Q18 으로 영속 제외.

  **변환 책임 분할 (codex 2차 #2 fix, codex 6차 #1 정정)** — 두 layer:
  1. **Frontend**: raw `WorkspaceState` → `PersistedWorkspaceState`
     **dehydration** (queryState idle / Q16–Q18 strip / closedTabHistory cap 25).
     **`sql` 필드는 보존** — query tab 의 본문은 persist 대상 (사용자가 직접
     작성한 텍스트). Strip 되는 것은 **queryState 의 result rows**
     (`status:"idle"` 로 만들어 rows 와 partial column meta 폐기) 와
     `dirtyTabIds` / `sidebar.selectedNode` / `sidebar.scrollTop` (Q16–Q18).
     이유: result rows 는 PII 이며 next boot 에서 refetch 가능, sql 본문은
     사용자 작업물이라 손실 시 UX 손상.
  2. **Backend**: `PersistedWorkspaceState` ↔ SQLite 3 JSON columns
     **serialize/deserialize**. tabs_json / sidebar_expanded_json /
     closed_tabs_json 의 JSON parse 와 UPDATE 책임.

  Frontend 는 SQLite 컬럼 shape 모름 (PersistedWorkspaceState 만 봄).
  Backend 는 dehydration 정책 모름 (이미 dehydrated 받음).

- **`settings` table (Q12, Q20 반영)**:

  ```sql
  CREATE TABLE settings (
    key             TEXT PRIMARY KEY,
    value_json      TEXT NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  -- 알려진 key: 'theme', 'safe_mode', 'home_recent_collapsed',
  --             'sidebar_width', 'query_history_retention_days',
  --             'query_history_enabled' (Q21 의 reset-to-default 도
  --             이 key 들 단위로 동작)
  ```

  Key-value 형태 — schema migration 비용 0 (새 setting 추가 시 row 만).

- **`connection_groups.collapsed` 컬럼 (Q20.3)**:

  기존 `connection_groups` table 에 `collapsed BOOLEAN NOT NULL DEFAULT 0`
  컬럼 추가. Migration `0002_groups_collapsed.sql`.

- **`datagrid_column_prefs` table (Q20.4 + Q20.5)**:

  ```sql
  CREATE TABLE datagrid_column_prefs (
    connection_id   TEXT NOT NULL,
    paradigm        TEXT NOT NULL,                 -- 'rdb' | 'document'
    db_name         TEXT NOT NULL,
    namespace       TEXT NOT NULL,                 -- RDB schema / Mongo db (db_name 과 동일 가능)
    table_name      TEXT NOT NULL,                 -- RDB table / Mongo collection
    widths_json     TEXT NOT NULL DEFAULT '{}',    -- { columnId: pxWidth }
    hidden_columns_json TEXT NOT NULL DEFAULT '[]', -- string[]
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (connection_id, paradigm, db_name, namespace, table_name)
  );
  ```

  **IPC wire (codex 7차 #1 — partial patch + field-scoped reset)**:

  ```ts
  // frontend 송신 (camelCase, backend 가 serde rename_all="camelCase" 로 매핑)

  type ColumnPrefsPk = {
    connectionId: string;
    paradigm: "rdb" | "document";
    dbName: string;
    namespace: string;
    tableName: string;
  };

  // Partial patch — widths 만 또는 hiddenColumns 만, 또는 둘 다 update 가능.
  // 미포함 필드는 SQLite row 의 기존 값 유지. 같은 row 가 없으면 INSERT
  // (미포함 필드는 column default '{}' / '[]').
  //
  // 빈 patch ({...pk, widths:undefined, hiddenColumns:undefined}) 는
  // backend 가 400 error 반환 ("at least one of widths/hiddenColumns
  // required") — codex 8차 #5. Frontend 는 widths 변경 없으면 IPC 호출 자체 skip.
  type SetDatagridPrefsRequest = ColumnPrefsPk & (
    | { widths: Record<string, number>; hiddenColumns?: string[] }
    | { widths?: Record<string, number>; hiddenColumns: string[] }
  );

  // Read — mount 시 / event 수신 시 refetch (codex 9차 #3)
  type GetDatagridPrefsRequest  = ColumnPrefsPk;
  type GetDatagridPrefsResponse = {
    widths: Record<string, number>;            // row 없으면 {}
    hiddenColumns: string[];                    // row 없으면 []
    updatedAt: number | null;                   // row 없으면 null
  };
  // 동작: SELECT widths_json, hidden_columns_json, updated_at FROM
  //       datagrid_column_prefs WHERE PK 매치. row 0 → { {}, [], null }.
  //       UI 코드는 "exists" check 불필요 — 빈 default 가 정상 첫 사용 표현.

  // Field-scoped reset — widths 만 reset (drag end 의 "Reset column widths"),
  // hiddenColumns 만 reset ("Show all columns"), 또는 둘 다 (row DELETE).
  type ResetDatagridPrefsRequest = ColumnPrefsPk & {
    field: "widths" | "hiddenColumns" | "all";
  };
  // 동작:
  //   field="widths"         → UPDATE widths_json = '{}'
  //   field="hiddenColumns"  → UPDATE hidden_columns_json = '[]'
  //   field="all"            → DELETE row
  // 모든 경우 emit_all({domain:"datagridColumnPrefs", op:"reset",
  //                     entityId: encodeColumnPrefsId(pk),
  //                     field: ... })
  // 수신 window 는 payload.field 보고 widths 만 / hidden 만 / 둘 다 default 적용.
  ```

  Phase 6 AC: "Reset column widths" 우클릭 메뉴와 "Show all columns" 우클릭
  메뉴는 **서로 독립** — widths reset 이 hidden 을 풀거나 그 반대 금지.
  단위 테스트로 두 affordance 의 isolation 검증.

  **Legacy LS migration**: 현재 `useColumnWidths.ts:19` / `useHiddenColumns.ts:24`
  의 key 는 `column-widths:{paradigm}:{schema}:{table}` 형태로
  `connection_id` / `db_name` 부재. SQLite PK 5 튜플 복원 불가.
  → **Drop without migration**. Phase 4 의 datagrid_prefs IPC 도입 sprint (sprint-369) boot migration 단계에서 legacy key
  delete + 사용자에게 1회 toast ("Per-table preferences will reset once").
  Mount context 에서 connection/db 알 때 best-effort import 는 ROI 낮음
  (사용자가 단일 머신에서 column 폭만 다시 조절 = 작은 비용).
- `src-tauri/src/storage/local.rs` — SQLite open / migration runner / atomic snapshot helper.
- IPC: `get_initial_app_state()` — Q9 snapshot.
- IPC: `persist_*` 액션별 (예: `upsert_workspace`, `add_history_entry`).
- Corrupt 시 quarantine (Q2) — `.bak` rename + fresh start, toast 없음.

## Phase 2 — Backend connection affinity (Q5.x)
**선행 조건**: 없음 (core affinity 부분). 단 **Q23 schemaCache invalidation
emit_all 은 Phase 3 의 in-process event 인프라 의존** — Phase 3 이전엔
DDL 후 자기 window 의 invalidation 만, cross-window broadcast 는 Phase
3 머지 후 활성화 (L3 fix). 그 동안엔 single window 라 기능 회귀 없음
(Q3 single-instance 결정 안 됐던 시기엔 multi-process 가정이었으나, Q3
lock 후엔 단순화됨).

- `AppState.active_connections` → adapter enum 내부에 `introspection_pool` + `tab_affinity: HashMap<tab_id, Option<PoolConnection>>` 분리 (Q5.6 lazy).
- `DbAdapter` trait `cancel_query(connection_id, query_id)` 추가, PG/MySQL/Mongo native impl (Q5.3).
- Cancel 결과 enum: `AlreadyCompleted` / `PermissionDenied` / `NetworkError` (Q5.5).
- Tab IPC API 확장: `executeQuery(tab_id, ...)`. Tab close IPC `release_tab_connection(connection_id, tab_id)` — transaction 자동 rollback (Q5.2). Connection scope 필요 — 같은 tab_id 가 두 connection 에서 collision 가능 (codex 7차 #4 정합).
- Frontend: `useQueryExecution` 가 tab_id 전달. `workspaceStore.removeTab` 이 release IPC 호출.

## Phase 3 — Single-instance + Launcher 영속 (Q3)
**선행 조건**: 없음. Phase 1 과 병렬.

- `tauri-plugin-single-instance` 추가.
- 2번째 launch 가로채기 → 기존 launcher window show + focus.
- Launcher lifecycle 변경 — connection 열고 workspace 떠도 launcher hide/show 사이클, close 안 함.
- Cross-window event — `AppHandle::emit_all(...)` in-process broadcast.

## Phase 4 — Boot bootstrap 이주 (Q9)
**선행 조건**: Phase 1 + **Phase 3 의 window label 마이그 + state-changed
listener infra** (codex 2차 #5 fix). Phase 3 없이 Phase 4 의 `useCurrentWindowConnectionId()`
hook 도, in-process event subscribe 도, snapshot scope window 별 partition
도 동작 안 함.

- Frontend `loadAllFromSnapshot()` — boot critical 5 store 한 번에 hydrate.
- 기존 localStorage hand-rolled persist 코드 retire (workspaceStore.persistence, favoritesStore.persistFavorites, mruStore.persistMruList, session-storage).
- ThemeBoot — sync localStorage 유지 (FOUC 회피).

## Phase 5 — Query history 이주 (Q7)
**선행 조건**: Phase 1 + Phase 4.

- `queryHistoryStore.entries` + `globalLog` 둘 다 retire — backend 가 단일 source. SQL WHERE 으로 filter.
- 두 array 의 책임 중복 (M-4) 해소 — per-tab view 도 SQL 의 `WHERE connection_id = ? AND tab_id = ?` 로 derive.
- History entry `source` 확장 — `raw` / `grid-edit` / `ddl-structure` / `mongo-op` / `sidebar-prefetch` (5종, codex 4차 #7 fix — schema/AC 와 일치).
- **백필 코드 불필요** — 현재 `queryHistoryStore` 는 localStorage persist 안 함, 메모리만. App restart 시 history lost 가 현재 동작. SQLite 이주 후부터 영속화 시작 — 기존 데이터 lost 는 회귀 아닌 baseline.

## Phase 6 — ADR 명문화 + cosmetic 정리
**선행 조건**: Phase 1–5.

- ADR 신설 (codex 2차 #9 fix — repo 의 최신 ADR 이 0031 `syntax-palette-manual-and-token-integrity` 이라 본 ADR 들은 **0032–0041** 로 renumber):
  - **ADR-0032**: SQLite 인프라 + atomic snapshot bootstrap (Q1/Q9 + SQLite 도입).
  - **ADR-0033**: Single-instance + in-process cross-window sync (Q3/Q4).
  - **ADR-0034**: Per-tab connection affinity + native cancel (Q5.x 통합).
  - **ADR-0035**: Corrupt recovery silent quarantine (Q2).
  - **ADR-0036**: Telemetry zero collection (Q10) — privacy contract.
  - **ADR-0037**: Auto-update notification-only (Q11).
  - **ADR-0038**: Theme/SafeMode SOT — SQLite truth + LS FOUC cache (Q12).
  - **ADR-0039**: Workspace window 정책 — connection 당 1 window, TablePlus 패턴 (Q13). Backend `open_workspace_window` idempotent.
  - **ADR-0040**: File-key 저장 위치 — OS keyring (Q22). macOS/Windows native, Linux Secret Service + file fallback. 디스크 `.key` 평문 폐기. Threat 1 (offline disk-access) 보호.
  - **ADR-0041**: SchemaCache cross-window invalidation — in-process event + wide + eager (Q23). DDL 후 connection 단위 invalidate, self-echo 단축.
  - **ADR-0042** (codex 3차 #8 fix): Query history retention/privacy/export — local at-rest 정책 (default 30d retention, sqlite-cipher 미도입 / OS file perm 의존, redaction 컬럼, history disable toggle, separate `Export query history` path). ADR-0036 의 telemetry zero (외부 송신) 와 별 결정. F.5 의 7항목이 본 ADR 의 본문.
- ADR-0032 안에 본 문서 Part B (8 평가 축 + 6 매체 + 결정 트리) 반영.
- `session-storage.ts` rename — `scopedLocalStorage.ts` (D5).
- Module 변수 정리 (counter, timer) — store internal field 또는 명시적 reset API.
- Zustand persist middleware 일관성 (D5) — themeStore/safeModeStore 만 middleware, 나머지 hand-rolled. SQLite 이주로 이 분기 자체 해소.

## ~~Phase 5 (구) — Multi-process 정합성~~ — 제거

Q3 = single-instance 로 변경 (2026-05-16) — multi-process 인프라 불필요. ~~file watcher / events table / cross-process broadcast~~ 전부 제거.

## 미해결 후속

**미해결 0**. 전 29개 결정 (Q1–Q3, Q4, Q5, Q5.1–Q5.6, Q6–Q23) lock +
Q4.a / Q4.b 폐기. U-시리즈 모두 해소 (U1 → Q14/Q15, U2 → Q16, U3/U4
→ Q17/Q18, U5 → Q19, U7/U8 → Q20, reset-UI → Q21, U9 → Q22, X2 →
Q23). 본 전략 위에서 Phase 0–6 모든 코드 작성 가능. ADR 0032–0042
draft 진행 가능.

---

# Part F — Contracts (구현 전 동결)

> **Status**: Part D 가 *결정* 의 source of truth 라면 Part F 는 *계약*
> 의 source of truth. SQLite 이주 / snapshot bootstrap / cross-window
> event / query history privacy 는 구현 시작 전에 본 절의 wire-level
> 합의가 박혀 있어야 한다. ADR 0032–0042 가 본 절을 인용한다.

## F.1 SQLite Migration Contract (Phase 1 ↔ Phase 4)

`connections.json` 등 기존 file/localStorage → SQLite 이주는 다음 단계
계약을 따른다. 한 sprint 안에 atomic 이 아니라 **dual-state 윈도우**가
필수.

**Domain-별 split (codex 3차 #3 fix)** — workspaces 는 다른 domain 과
W1 정책 다름. SQLite single-source 조기 전환 (legacy global blob race
회피, H3 와 일관). 다른 domain (connections / favorites / mru / settings)
은 기존 dual-write.

`workspaces`:

| 단계 | 기간 | Read source | Write target | 검증 |
|------|------|-------------|--------------|------|
| **W0** baseline | (Phase 0 끝) | LS `table-view-workspaces` | LS | 기존 |
| **W1** SQLite only | (Phase 1 시작) | SQLite | SQLite only — LS write 금지 | 두 workspace window 동시 persist → SQLite 두 row 보존, LS write 0 |
| **W3/W4** | 그대로 | SQLite | SQLite | LS key cleanup (Phase 6) |

`connections / favorites / mru / settings`:

| 단계 | 기간 | Read source | Write target | 검증 |
|------|------|-------------|--------------|------|
| **W0** baseline | (Phase 0 끝) | file/LS | file/LS | 기존 |
| **W1** dual-write | (Phase 1 안에서) | file/LS | file/LS **+** SQLite (best-effort) | SQLite write 실패 시 file/LS write 성공으로 간주, 다음 boot 에 재시도 |
| **W2** dual-read | (Phase 4 시작) | SQLite 우선, file/LS fallback | SQLite primary, file/LS mirror | mismatch log dev console |
| **W3** SQLite primary | (Phase 4 끝) | SQLite | SQLite only | file/LS read 금지 (코드 grep CI) |
| **W4** legacy 정리 | (Phase 6) | SQLite | SQLite | file/LS key 삭제, `connections.json` 은 `.legacy.json` rename 30일 보관 |

**Rollback**: W3 까지는 `--rollback-state` CLI flag 로 `.legacy.json`
복사 후 file 기반 동작 (degraded). W4 이후 rollback 불가 — 그 전에
issue 발견되어야 함.

**Password ciphertext (`connections.json` 의 enc 필드)**: SQLite 의
`connections.password_enc` BLOB 으로 그대로 byte-copy. File-key 자체는
별도 Q22 path 로 keyring 이주 (아래 별항). **재암호화 금지** — 한 번의
이주에서 plaintext 가 메모리에 노출되는 윈도우를 만들지 않음.

**File-key keyring 이주 (Q22, codex 2차 #4 fix — 2-phase with rollback)**:

SQLite migration 과 별개의 1회 boot-time step. 현재 `crypto.rs:67-97`
의 `get_or_create_key()` 는 `.key` 없으면 **새 key 생성** — ciphertext
있는데 새 key 만들면 모든 connection password 가 orphan (영구 복호화
실패). 따라서 2-phase 절차:

1. OS keyring read 시도 (`com.tableview.app.file-key`). Hit 시 그 key 사용,
   migration 끝.
2. Miss 면 디스크 `.key` 존재 확인.
3. 디스크 `.key` 있음:
   - a. Read → keyring write.
   - b. Keyring readback → byte equality 검증 (write 성공 확인).
   - c. **모든 non-empty `connections.password_enc` 를 새 key 로 decrypt
     시도** — `.key` 와 keyring 의 key 는 같아야 하므로 둘 다 성공해야 함.
   - d. (a)(b)(c) 모두 성공 시에만 `.key` secure delete (overwrite + unlink).
   - e. 한 단계라도 실패 → `.key` 유지 + **file sidecar `.key.migration-failed`**
     (1-byte marker) + dev log + 다음 boot 재시도. SQLite meta 에는 안 씀 —
     이 step 자체가 SQLite migration **전** 이라 meta table 부재 (codex 5차 #5 fix).
4. 디스크 `.key` 도 없음 (codex 3차 #5 fix — keyring step 은 SQLite migration **전** 에 수행, table 검사 불가):
   - **`connections.json` 파일이 있고 그 안에 비어있지 않은 `password_enc` 가 1개라도 있음**
     → fatal error. "Connection passwords cannot be decrypted (key
     missing)" toast + safe mode 진입. **새 key 생성 금지** (orphan 회피).
     판정 source = file system, 아직 SQLite empty.
   - `connections.json` 자체 없음 OR 안의 password_enc 모두 empty (신규
     사용자) → 새 key 생성 → keyring 저장 → 정상 boot. 이 시점에 frontend
     의 legacy import 도 어차피 빈 LS 라 race 없음.
5. Linux 의 Secret Service 미가용 환경 → 디스크 file mode 유지 + 사용자
   에게 "디스크 암호화 권장" 1회 toast. Step 3 의 (a)–(b) 생략, (c)–(d)
   는 LS Secret Service 동등하게 수행.

이 step 은 SQLite migration 시작 전에 완료 — password ciphertext decrypt
가 새 위치의 file-key 로 가능해야 함.

**File preservation**: W4 의 `.legacy.json` 30일 보관 정책은 사용자
manual recovery 용. 사용자가 명시적으로 `Reset Local Data` 실행 시에만
즉시 delete.

## F.2 Snapshot Payload Contract (Q9 `getInitialAppState()`)

```ts
type InitialAppState = {
  schemaVersion: 1;          // increment on breaking shape change
  snapshotVersion: number;    // monotonic per boot — frontend uses for event dedup
  generatedAt: number;        // unix ms (server time)
  partial: boolean;           // true if one or more stores failed to hydrate

  stores: {
    connections: { items: Connection[]; groups: ConnectionGroup[] } | { error: string };
    workspaces:  {
      // Q13 으로 PK (connection_id, db_name) — frontend 는 nested map 으로 받음.
      // **Persisted wire type 은 raw WorkspaceState 가 아닌 dehydrated 형태**
      // (Q16–Q18 strip + M-1 query result strip).
      //
      // **Scope (H5 fix)**: window 별 partition.
      // - Launcher window 가 `getInitialAppState()` 호출 시: `byConnectionId`
      //   는 **빈 object** — launcher 는 workspace state 사용 안 함 (다만
      //   sidebar 에서 connection count badge 등에 쓰면 별 IPC 로 fetch).
      // - Workspace window (`workspace-{conn_id}`) 가 호출 시: `byConnectionId`
      //   는 그 connection 만 (= `{ [connId]: { [dbName]: ... } }`). 다른
      //   connection 의 workspace 는 받지 않음 — 100 conn × 5 db = 500 row
      //   boot 폭주 방지.
      // - Window scope 결정 source (codex 2차 #8 fix): Tauri command
      //   signature 가 `window: tauri::Window` 인자 받아 `window.label()`
      //   사용. `app_handle.get_focused_window()` 는 boot 중 focus 가
      //   OS/activation timing 으로 launcher 일 수 있어 workspace 가 빈
      //   snapshot 받을 위험 — `window` 인자가 호출 source 보장.
      //   Frontend 는 인자 전달 안 함 (Tauri 가 자동 주입).
      //
      // **Launcher 의 workspace snapshot escape hatch (codex 3차 #7 fix)**:
      // Launcher 가 명시적 사용자 동작 (예: "Reopen recent connection",
      // 미래 "Open all favorites") 으로 다른 connection 의 workspace
      // metadata 가 필요할 때 별도 IPC 사용:
      //   #[tauri::command]
      //   async fn get_workspace_snapshot(connection_id: String)
      //       -> Result<Option<Record<String, PersistedWorkspaceState>>, AppError>
      //   // 한 connection 의 모든 db_name sub-workspace 반환 (Q13 의 1:N).
      //
      //   #[tauri::command]
      //   async fn get_workspace_summaries(connection_ids: Vec<String>)
      //       -> Result<Vec<WorkspaceSummary>, AppError>
      //   // Batch — { connection_id, db_count, tab_count, last_updated }.
      //   // Tab 내용 없음 (UI badge 용).
      // Boot 시점 `getInitialAppState()` 의 workspaces scope 제한은 유지 —
      // 위 IPC 는 명시적 사용자 동작에서만.
      byConnectionId: Record<string, Record<string, PersistedWorkspaceState>>;
    } | { error: string };
    mru:         { recentConnections: string[]; lastUsedConnectionId: string | null } | { error: string };
    theme:       { themeId: string; mode: ThemeMode } | { error: string };
    safeMode:    { mode: SafeMode } | { error: string };
  };

  // Q14 lock: Backend M2 truth — snapshot 에 별도 runtime slot (durable
  // 아닌 process state). Frontend 가 store mirror 슬롯 hydrate.
  // 빈 객체 가능 — 첫 boot 에 아무 connection 도 connect 안 한 상태.
  //
  // **ConnectionStatus shape 정합 (codex review 2026-05-16)**:
  // 현재 Rust enum (`models/connection.rs:194`) = `Connected | Disconnected
  // | Error(String)` — frontend 의 `connecting` / `connected.activeDb` 가
  // 표현 안 됨. Phase 3 (Q14 backend truth, sprint-364) 시작 시 Rust enum 을 다음 shape
  // 으로 확장:
  //
  //   #[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
  //   pub enum ConnectionStatus {
  //       Disconnected,                                  // pool 미초기화
  //       Connecting,                                    // pool::connect() 진행 중
  //       Connected {
  //           #[serde(skip_serializing_if = "Option::is_none")]
  //           active_db: Option<String>,                 // None → wire 에 필드 자체 생략 (codex 4차 #4 fix)
  //       },
  //       Error { message: String },                     // pool::connect() 실패
  //   }
  //
  // **`rename_all_fields = "camelCase"` 필수 (codex 2차 #7 fix)**: 안 박으면
  // `active_db` 가 그대로 직렬화되어 frontend `activeDb` 와 mismatch.
  // 영향 callsite (모두 새 variant 로 갱신): `crud.rs:132-133`,
  // `session.rs:179-182`, serde tests `connection.rs:381-404`.
  //
  // **`Connected` 의미 (M2 fix)**: sqlx Pool::connect() 가 성공한 상태 —
  // 즉 PgPool / MySqlPool 객체가 created. 개별 query 의 PoolConnection acquire
  // (Q5.6 lazy) 와는 **별 layer**. Tab open 후 query 안 한 idle tab 도 그 connection
  // 의 status 는 `Connected` (pool 초기화는 connect 시 1회).
  //
  // active_db = pool 의 default db (PG `USE db` 또는 connection string 의 dbname).
  // 사용자가 Workspace 안에서 DB 전환하면 backend 가 active_db 갱신 + emit_all.
  //
  // 직렬화 결과 frontend `types/connection.ts:111-117` 의 union 과 일치.
  // 이 확장이 Phase 3 / sprint-364 의 첫 step. 안 하면 Q14 의 backend
  // truth 가 frontend mirror 시 activeDb / connecting 누락.
  runtime: {
    activeStatuses: Record<string, ConnectionStatus>;  // 확장된 enum 의 직렬화 형태
  };

  // Q15 lock: focusedConnId 는 launcher window 의 in-memory 신호 →
  // snapshot 에 들어가지 않음. Workspace window 의 connection identity
  // 는 window label 에서 derive (Tauri `workspace-{connection_id}`).
};

// Phase 0 의 dehydration wire type — raw store state 와 별도로 정의.
// 구현자는 snapshot / persist write 시 반드시 이 타입으로 변환.
type PersistedWorkspaceState = {
  activeTabId: string | null;
  tabs: PersistedTab[];
  closedTabHistory: PersistedTab[];     // cap 25 (Q19), 같은 PersistedTab shape
  sidebar: {
    expanded: string[];                  // sidebar.scrollTop / selectedNode 제외
  };
  // dirtyTabIds / sidebar.scrollTop / sidebar.selectedNode 는 wire type 에 존재하지 않음
};

// 실제 frontend Tab union (workspaceStore/types.ts:41-131):
//   - type: "table" | "query" 만 두 variant
//   - view 는 type: "table" + objectKind?: "view"
//   - Mongo collection 도 type: "table" + paradigm: "document" + database + collection
// → PersistedTab 도 같은 shape 사용 (codex 2차 #6 fix, 매핑 단순화)

type PersistedTabBase = {
  id: string;                            // workspace-scoped, M-2 fix 후 seeded counter
  title: string;
  connectionId: string;
  closable: boolean;
};

// paradigm discriminated — invalid 조합 차단 (codex 3차 #6 fix)

type PersistedRdbTableTab = PersistedTabBase & {
  type: "table";
  paradigm: "rdb";
  objectKind?: "view";
  schema: string;                         // required
  table: string;                          // required
};

type PersistedDocumentTableTab = PersistedTabBase & {
  type: "table";
  paradigm: "document";
  database: string;                       // required
  collection: string;                     // required
};

// QueryTab 도 paradigm discriminated — 실제 Tab union 정합 (codex 4차 #3 fix)

type PersistedRdbQueryTab = PersistedTabBase & {
  type: "query";
  paradigm: "rdb";
  sql: string;
  database?: string;                      // optional — connection default db 면 undefined
  queryMode?: "sql";                      // 실제 QueryMode 의 RDB variant (workspaceStore/types.ts:88)
  queryState: { status: "idle" };
};

type PersistedDocumentQueryTab = PersistedTabBase & {
  type: "query";
  paradigm: "document";
  sql: string;                            // Mongo: JSON-serialized op spec
  database: string;                       // required — Mongo 는 namespace 명시
  collection?: string;                    // optional — collection-less ops 가능
  // 실제 QueryMode (workspaceStore/types.ts:88) 의 Mongo variants — codex 5차 #2 fix.
  // "raw" 는 코드에 없음. 13 variants 중 "sql" 제외 12.
  queryMode?: Exclude<QueryMode,
    "sql">;  // "find" | "findOne" | "aggregate" | "countDocuments"
             // | "estimatedDocumentCount" | "distinct"
             // | "insertOne" | "insertMany" | "updateOne" | "updateMany"
             // | "deleteOne" | "deleteMany" | "bulkWrite"
  queryState: { status: "idle" };
};

type PersistedTab =
  | PersistedRdbTableTab
  | PersistedDocumentTableTab
  | PersistedRdbQueryTab
  | PersistedDocumentQueryTab;
```

**Validation 책임 (M6 fix)**:
- Frontend dehydrate: raw `Tab` → `PersistedTab` 변환 시 `paradigm` 별
  required 필드 assert. Invalid 면 logical bug — TypeScript exhaustiveness
  + runtime check + dev console error. Wire 로 invalid 안 보냄.
- Backend `persist_workspace` / `import_legacy_localstorage`: 받은
  `PersistedTab` 의 discriminant 별 required 필드 검증. 누락 시 row 자체
  drop + dev log + 사용자 toast 없음 (다른 tab 은 정상 저장).

이전 문서의 `type: "view"` / `type: "collection"` 별 sub-variant 는
실제 코드에 없음 — 코드 union 그대로 mirror 하는 게 hydrate mapper 비용 0.

**Tab id lifecycle 와 `query_history.tab_id` 의 관계 (H4 fix)**:

`query_history.tab_id` 는 **단순 logging 필드** — workspace 의 tab
lifetime 과 무관. Tab close 후 같은 id 가 새 tab 에 reassign 되면
(M-2 fix 후 seeded counter 라 이론상 안 됨, 그러나 forever-app 가정
하 collision 가능) history 의 tab_id 는 **과거 시점의 logical
identifier** 일 뿐 — 현재 tab 을 가리키는 게 아님.

구현 의미:
- History panel 의 "이 tab 의 history" 필터는 **현재 열린 tab id 와
  매칭하는 행**만 표시. 그 tab 닫힌 후엔 그 tab_id 매칭 행이 "고아
  history" 가 됨 — 사용자가 명시적으로 query history panel 에서
  보지 않으면 visible 영향 0.
- Workspace tab close 시 history row 의 tab_id 를 NULL 로 갱신 **안
  함** — 영구 logging 의 부정확성 회피.

**Tab id 충돌 회피**: M-2 fix 가 `Math.max(persisted ids) + 1` seed
하므로 같은 process 안에서는 collision 없음. 다음 boot 의 새 counter
도 같은 invariant. 다만 **workspace 전체 reset (Q21 의 "Reset
workspace layout") 시** counter 도 0 으로 초기화 — 그 시점 이후
새 tab id 가 옛 history 와 collision 가능. 사용자가 명시 reset 한
직후 history 가 잘못 매칭될 위험은 있으나, 사용자 mental model 상
"reset 했으니 옛 history 도 무관" 으로 자연.

**Atomic guarantee**: backend 는 SQLite `BEGIN IMMEDIATE` 안에서 5
store 를 같이 read — read-time consistent.

**Partial fallback**: 한 store 의 SQLite query 실패 시 `{ error }` 만
그 슬롯에 채우고 `partial: true`. Frontend 는 partial=true 면 dev mode
banner + 해당 store 만 empty 초기화. Boot 자체는 진행.

**Version migration**:
- `schemaVersion < 1` 의 데이터 (현 file/LS 시대) 는 SQLite 안 들어옴
  → snapshot 도 안 나옴 → **Phase 1 의 W1 단계** (이전 표기 "Phase 0
  dual-write" 는 오류, H6 fix) 에서 one-shot migration 후 SQLite insert.
- `schemaVersion` mismatch (미래 v2) → frontend 가 모르는 버전이면
  fatal toast + safe mode 진입 (사용자 데이터 read-only).

**W1 boot import 절차 (H7 + codex 2차 #1 fix)**:

Backend 는 WebView localStorage 를 enumerate / read 할 수 없으므로
**frontend 가 export, backend 가 import** 하는 흐름이 정답:

1. SQLite 의 `migrations` 테이블 확인 — `0001_initial` 적용 완료 후 진행.
2. Backend 단독 작업: `connections.json` 파일 read → 모든 connection 을
   SQLite `connections` table 에 insert. file-key 도 같은 시점에 keyring
   으로 이주 (Q22). password_enc 는 byte-copy.
3. **Launcher window 가 ready 되면** frontend 가 LS key 들을 sync read +
   **이미 dehydrate / normalize** 한 후 1회 IPC
   `import_legacy_localstorage(payload)` 호출. Backend 는 validate +
   SQLite serialize 만 — raw workspace 데이터가 IPC 경계 안 넘김 (PII 보호,
   codex 3차 #1 fix):

   ```ts
   type LegacyPayload = {
     // workspaces — frontend 가 PersistedWorkspaceState 로 dehydrate 후 전송
     workspaces?: Record<string, Record<string, PersistedWorkspaceState>>;

     // favorites — 실제 LS shape = 배열 JSON (codex 3차 #4)
     favorites?: Favorite[];

     // mru — 실제 LS shape = 배열 JSON (legacy "string" entry 도 있을 수 있음, frontend 가 정규화)
     mru?: MruEntry[];

     // theme — 실제 LS shape = { themeId, mode } (themeBoot.ts:10)
     theme?: { themeId: ThemeId; mode: ThemeMode };

     // safeMode — 실제 LS key = "view-table.safeMode" (Zustand persist envelope { state: { mode }, version })
     // Frontend 가 envelope 풀어서 raw { mode } 만 전송
     safeMode?: { mode: SafeMode };
   };
   ```

   Frontend 책임: 각 LS key 의 **실제 raw shape** 을 알고 parse / normalize
   /dehydrate. Backend 는 위 contract shape 만 받음 (LS key 명도, envelope
   shape 도 backend 가 모름).

4. Backend 가 payload 받아 SQLite insert. workspaces 는 PersistedWorkspaceState
   를 3 JSON 컬럼으로 serialize. 다른 domain 도 정해진 columns 로 insert.
5. 성공 시 backend 가 `meta.legacy_imported = "done"` 저장 — 다음 boot
   부터 step 3 건너뜀.
6. Import 성공 후 frontend 는 **LS key 즉시 삭제 안 함** — W3 진입 step 에서 cleanup.

**Race gate (codex 3차 #2 + 4차 #2 fix)** — import 진행 중 사용자
durable write 충돌 방지:

`meta.legacy_imported` 가 `pending | importing | done | failed` 4 state.
- `pending`: 새 사용자 또는 첫 boot. Frontend 가 LS read 시도 — 있으면
  `importing` 으로 transition + IPC 호출. 없으면 즉시 `done`.
- `importing`: **모든 A/C durable write IPC 가 backend 공통 guard
  `guard_legacy_import_done()` 통과 후 진행**. 통과 못 하면
  `Error::LegacyImportInProgress` 반환.
- `done`: 정상 동작.
- `failed`: dev log + safe mode 진입. 사용자가 retry 버튼으로 step 3
  재시도. 그 동안 durable write 도 block.

**Guard 적용 IPC 전체 목록 (Phase 1 머지 시 모두 등록)**:

`connection` domain: `add_connection`, `update_connection`,
`delete_connection`, `reorder_connections`.

`group` domain: `add_group`, `update_group`, `delete_group`, `reorder_groups`.

`mru` domain: `set_mru_lastused`, `reorder_mru`, `clear_mru`.

`favorite` domain: `add_favorite`, `update_favorite`, `delete_favorite`,
`reorder_favorites`.

`setting` domain: `set_setting`, `reset_setting`.

`workspace` domain: `persist_workspace`, `delete_workspace`.

`history` domain: `add_history_entry`, `list_history`, `get_history_detail`,
`clear_history` (codex 8차 #2). **Retention/disable 토글은 settings 도메인**
(`set_setting("query_history_retention_days", N)` /
`set_setting("query_history_enabled", bool)`) — 별도 IPC 없음
(codex 9차 #2 — single path).

`datagrid_column_prefs` domain: `set_datagrid_prefs`, `reset_datagrid_prefs`.

**예외 (guard 없음)** — M1/M2 only 또는 read-only IPC: `connect`,
`disconnect`, `execute_query`, `cancel_query`, `get_runtime_status`,
`get_initial_app_state`, `get_workspace_snapshot`, `get_*` read IPC 일체.

Phase 1 머지 시 backend grep CI: `#[tauri::command]` 함수가 A/C domain
mutate 면 함수 첫줄에 `state.guard_legacy_import_done()?` 있어야 함.

**실제 LS key (코드 검증 — codex 3차 #4 fix)**:
- `table-view-workspaces` 단일 blob (`workspaceStore/persistence.ts:14`)
- `table-view-favorites` (`favoritesStore.ts:25`, array JSON)
- `table-view-mru` (`mruStore.ts:29`, array JSON)
- `table-view-theme` (`themeBoot.ts:10`, `{ themeId, mode }`)
- `view-table.safeMode` (`safeModeStore.ts:18`, Zustand persist envelope)

F.6 Phase 4 AC 의 grep CI 는 이 실제 key 5 개. 이전 문서의 `viewtable:*`
도, `table-view-safe-mode` 도 오류.

**W1 동안 workspace LS write 정책 (codex 2차 #3 fix)** — legacy global blob 레이스 방지:

실제 LS key 는 `table-view-workspaces` 단일 blob (workspaceStore/persistence.ts:14).
Window A 가 자기 connection partition 만 가진 상태로 그 blob 을 통째로
overwrite 하면 connection B 의 workspace 가 날아감.

→ **W1 시작부터 workspace LS write 금지**. Workspaces 는 W1 진입 시점에
이미 SQLite single-source 로 전환 (favorites/mru/theme/safeMode 와는
다른 일정 — workspace 만 일찍). 다른 dual-write domain (W3 까지 mirror)
과 별 path:

- W1 진입 후 `persistWorkspaces` 의 LS write 경로 제거 (코드 직접 변경).
- Backend `persist_workspace(connId, dbName, persisted)` IPC 만 single
  source.
- 만약 SQLite write 실패 → frontend 는 1회 retry (memory 살아있음, 다음
  debounce). LS fallback 없음.

대안 (legacy LS 유지하려면): "한 owner 단일 process" 패턴 — launcher
window 만 LS write 권한, workspace window 는 IPC `forward_workspace_persist`
보냄, launcher 가 single owner 로 LS 의 global blob merge-write. 그러나
복잡도 큼 — workspace LS 조기 retire 가 ROI 높음. **위 옵션 선택**.

**AC 위치 (codex 5차 #6 fix)**:
- **Phase 1 AC**: workspace `persist_workspace` IPC 안 `state.guard_legacy_import_done()?` 통과 후 SQLite UPDATE. Frontend 의 LS write path 코드 제거 — grep `localStorage.setItem.*table-view-workspaces` 가 src/ 에서 0건. 단위 테스트: `persistWorkspaces` 호출 시 IPC 1회 + LS write 0회.
- **Phase 3 또는 4 AC**: 두 workspace window (서로 다른 conn, `workspace-{conn_id}` label 도입 후) 가 200ms debounce 로 동시 persist 호출 → SQLite 의 두 connection_id row 모두 보존. Legacy LS `table-view-workspaces` 는 W1 진입 시점부터 read-only (boot import 용), 그 후 write 0.

**W1 reconcile (L5 fix)**:

W1 의 "SQLite write 실패 시 file/LS write 성공으로 간주, 다음 boot
재시도" 의 메커니즘:
1. Boot 시 backend 가 file/LS (W1 동안 SOT) 와 SQLite 의 row diff 계산
   — `connections.id` set 차이 / `favorites.id` set 차이 / etc.
2. file/LS 에만 있는 entry → SQLite 에 insert (이전 boot 의 write 실패
   재시도).
3. SQLite 에만 있는 entry → unexpected (W1 동안 SQLite 가 SOT 아님) →
   dev console warning + skip (W2 시작 후엔 다른 의미).
4. Reconcile 은 W1, W2 boot 마다. W3 진입 후엔 SQLite SOT 라 더 이상
   reconcile 안 함 (file/LS read 금지).

## F.3 Write Ownership Contract

이주 후 모든 mutable state 의 write 흐름:

| State | Write 시작 | 1차 영속 | UI 업데이트 시점 | Rollback 시 |
|-------|-----------|---------|-----------------|------------|
| `connections.*`, `groups`, `mru`, `favorites`, `settings`, `query_history` | Frontend action 호출 | **Backend-first** — IPC `persist_*` 가 SQLite write 후 응답 | 응답 후 store mutate + event emit | IPC error → toast + store 미변경 |
| `workspaces.*` (활성 tab/sidebar 상태) | Frontend action | **Optimistic frontend-first** — store 즉시 mutate, debounce 200ms 후 frontend 가 `dehydrate(state)` 호출해 `PersistedWorkspaceState` 생성 (queryState 의 result rows 폐기 후 `status:"idle"` / Q16–Q18 strip / closedTabHistory cap 25 적용. **sql 본문은 보존** — codex 6차 #1) → IPC `persist_workspace(connId, dbName, persisted)` (M1 fix: dehydration 책임은 **frontend** — result rows 등 PII 가 backend 로 넘어가지 않게) | 즉시 (action 호출 시점) | IPC error → 다음 debounce 까지 retry, 3회 실패 시 toast + 사용자 reload 권고 |
| `theme` | Frontend action | **Backend-first** (Q12) — IPC `set_setting` → SQLite write → `emit_all` → 모든 window mutate. 각 window mutate 후 자기 LS (`table-view-theme`) sync write (다음 boot FOUC cache) | event 수신 시점 (자기 window 는 self-echo 단축 경로로 IPC 응답 시점) | IPC error → toast + store 미변경. LS 는 마지막 성공값 유지 (다음 boot FOUC 0 보장) |
| `safeMode` | Frontend action | **Backend-first** (Q12, codex 4차 #5 fix — LS sync 제거) — IPC `set_setting` → SQLite write → `emit_all` → 모든 window mutate. **LS write 없음** — safeMode 는 boot FOUC critical 아님 (IPC 응답 전까지 default safe 가정 안전). 기존 `view-table.safeMode` LS key 는 Phase 6 cleanup 대상 | event 수신 시점 | IPC error → toast + store 미변경 |
| `dataGridEdit.*` | Frontend | M1 only (영속 없음) | 즉시 | N/A |
| `active_connections.*` (live handle) | Backend (IPC `connect`) | M2 only | IPC 응답 시 | error 응답 |

**왜 mixed**: 사용자 가치 / 손실 짜증 (A8) 차이.
- 큰 mutation (connection 추가, history insert) 은 backend-first — 실패
  시 store mismatch 위험이 더 큼.
- 빠른 UI 상호작용 (tab switch, sidebar expand) 은 optimistic — 200ms
  IPC round-trip 이 매번 노출되면 UX 깨짐.

## F.4 Cross-Window Event Contract (Q4 in-process)

`AppHandle::emit_all("state-changed", payload)` 로 broadcast 되는
in-process event 의 wire 형식:

```ts
type StateChangedPayload = {
  domain: "connection" | "group" | "workspace" | "mru" | "favorite"
        | "history" | "setting" | "schemaCache" | "datagridColumnPrefs";
  op:     "create" | "update" | "delete" | "reorder" | "bulk"
        | "status"      // Q14 — backend connection status 변경
        | "invalidate"  // Q23 — schemaCache drop
        | "reset"       // Q21 — reset-to-default 작업
        | "clear";      // history 전체 삭제 (codex 7차 #3)
  entityId: string | null;       // create 시 새 id, bulk/clear 시 null
  version: number;               // monotonic per (domain, entityId) — server-assigned
  snapshotVersion: number;       // 발신 시점 base snapshot — 수신자 dedup 용
  originWindow: string | null;   // 원인 window label (self-echo skip 용). null = backend-initiated
  emittedAt: number;             // unix ms
  field?: "widths" | "hiddenColumns" | "all";  // datagridColumnPrefs.reset 에만 (codex 7차 #1)
};
```

**Domain 별 payload 예시 (wire 고정)**:

```ts
// theme / safeMode (Q12) — settings 의 sub-type
{ domain: "setting", op: "update", entityId: "theme", version: 42, ... }
{ domain: "setting", op: "update", entityId: "safe_mode", version: 17, ... }

// Q14 — connection status
{ domain: "connection", op: "status", entityId: "conn-1", version: 8, ... }
// 별도 fetch: get_runtime_status(connection_id) → ConnectionStatus
// (payload 안에 status 값 자체는 안 넣음 — 수신자가 refetch 로 single source 유지)
//
// IPC 시그니처 (H3 fix):
//   #[tauri::command]
//   async fn get_runtime_status(state: State<'_, AppState>, connection_id: String)
//       -> Result<ConnectionStatus, AppError>
//   // 응답 = Q14 의 확장된 enum 직렬화 그대로
//
// IPC 시그니처 (M3 fix — Q21 reset):
//   #[tauri::command]
//   async fn reset_setting(state: State<'_, AppState>, key: String)
//       -> Result<(), AppError>
//   // 동작: DELETE FROM settings WHERE key = ?; 그 후 emit_all({ domain:"setting",
//   //       op:"reset", entityId: key }). Frontend 는 default 값을 자체적으로 알고
//   //       있어야 함 (각 settings key 의 default 는 frontend 상수).
//   #[tauri::command]
//   async fn set_setting(state: State<'_, AppState>, key: String, value_json: String)
//       -> Result<(), AppError>
//   // value_json 이 "null" 이면 reset_setting 과 동등 의미. 명시적 reset_setting 을
//   // 별도 IPC 로 분리한 이유: emit op 가 "update" vs "reset" 으로 명확히 구분.

// Q23 — schemaCache invalidate
{ domain: "schemaCache", op: "invalidate", entityId: "conn-1", version: 99, ... }

// Q20 — column prefs / hidden columns 변경
// entityId 는 base64url-encoded JSON (아래 datagridColumnPrefs 규약 참조 — codex 6차 #3).
// 예: encodeColumnPrefsId({ connection_id:"conn-1", paradigm:"rdb",
//                          db_name:"appdb", namespace:"public", table_name:"users" })
//     => "eyJjb25uZWN0aW9uX2lkIjoiY29ubi0xIiwicGFyYWRpZ20iOiJyZGIiLCJkYl9uYW1lIjoiYXBwZGIiLCJuYW1lc3BhY2UiOiJwdWJsaWMiLCJ0YWJsZV9uYW1lIjoidXNlcnMifQ"
{ domain: "datagridColumnPrefs", op: "update",
  entityId: "<base64url(JSON{connection_id,paradigm,db_name,namespace,table_name})>", ... }

// Q21 — reset to default
{ domain: "setting", op: "reset", entityId: "sidebar_width", ... }
// datagridColumnPrefs.reset 은 field 로 scope 지정 (codex 7차 #1)
{ domain: "datagridColumnPrefs", op: "reset",
  entityId: "<base64url(JSON{connection_id,paradigm,db_name,namespace,table_name})>",
  field: "widths" /* or "hiddenColumns" or "all" */, ... }

// F.5 — Clear query history (codex 7차 #3)
{ domain: "history", op: "clear", entityId: null, version: 314, ... }
// History panel 이 mount 된 모든 window 가 entries=[] + page reset.
// add_history_entry 의 "create" event 와 별도 — refetch 없이 즉시 비움.
```

`setting` domain 의 `entityId` 는 settings table 의 `key` 컬럼 값.

`datagridColumnPrefs` 의 `entityId` 는 **base64url-encoded JSON** of
the PK 5-tuple `{connection_id, paradigm, db_name, namespace, table_name}`
(codex 5차 #4 fix — colon-join 은 이름에 `:` 포함 시 비가역). Frontend
helper `encodeColumnPrefsId(pk)` / `decodeColumnPrefsId(id)` 단일 path.

**Domain 별 수신자 처리 (codex 4차 #1 fix)** — payload 가 metadata 만이라
event 수신 시 어떻게 mutate 할지 별 정함 필요:

| Domain | Op | 수신자 동작 |
|--------|-----|-----------|
| `connection` | `create`/`update`/`delete`/`reorder` | `get_all_connections()` IPC refetch |
| `connection` | `status` | `get_runtime_status(entityId)` IPC refetch |
| `group` | `create`/`update`/`delete`/`reorder` | `get_all_groups()` IPC refetch |
| `mru` | `bulk` | `get_mru()` IPC refetch |
| `favorite` | `create`/`update`/`delete`/`reorder` | `get_all_favorites()` IPC refetch |
| `setting` | `update` | `get_setting(entityId)` IPC refetch (key 별 단일) |
| `setting` | `reset` | **refetch 안 함** — `reset_setting` 은 row 삭제 후 emit (codex 6차 #4). 수신자는 settings key 별 frontend default 상수를 store 에 직접 set (`SETTING_DEFAULTS[entityId]`), Q12 의 theme 인 경우 LS sync 도 같이. `get_setting` 결과는 row 삭제됐기에 null 일 수밖에 없어 refetch 무의미 |
| `workspace` | `update` | **workspace window 만**: `currentWindowConnId === entityId` 일 때만 `get_workspace_snapshot(entityId)` refetch. 다른 workspace window (different conn) 는 ignore. Launcher window 는 무시 (workspace state 없음, 단 future summary cache invalidation 시 lazy refresh 가능) — codex 5차 #3 fix |
| `history` | `create` | History panel 이 mount 중이면 visible page refetch (`list_history(filter)`), 아니면 lazy |
| `history` | `clear` | F.5 "Clear query history" 의 결과 — backend 가 `DELETE FROM query_history` 후 `{domain:"history", op:"clear", entityId:null, version:N+1}` emit. 모든 window 의 mounted history panel 은 즉시 `entries=[]` set + page reset. Mount 안 된 panel 은 next mount 시 빈 list 부터 fetch (codex 7차 #3) |
| `schemaCache` | `invalidate` | `schemaStore.clearForConnection(entityId)` + sidebar mount 시 refetch |
| `datagridColumnPrefs` | `update` | 해당 (`connection_id, paradigm, db_name, namespace, table_name`) tab 이 mount 중이면 prefs refetch (`get_datagrid_prefs(decodeColumnPrefsId(entityId))`), 아니면 lazy on next mount |
| `datagridColumnPrefs` | `reset` | **refetch 안 함** — row DELETE 또는 부분 reset 후 emit (codex 6차 #4 + 7차 #1). 수신자는 `op:"reset"` payload 의 `field` (`"widths"` / `"hiddenColumns"` / `"all"`) 에 따라 widths 만, hidden 만, 또는 둘 다 frontend default 로 set. Mount 안 된 tab 은 next mount 시 default 로 시작 |

원칙: event 는 **"무엇이 바뀜" 알림** 만, 실제 값은 **수신자가 refetch** —
single-source 정책. Payload 에 value 안 넣음 (history insert 정도는 예외
가능, 그러나 페이지네이션 일관성 위해 refetch 가 더 안전).

**Phase 3 AC 보강** — 각 domain event 의 수신자 mutate 검증 (전체 9
domain 의 mount-중 / mount-아닌 시나리오 매트릭스).

**Ordering**: backend 가 같은 entity 의 update 를 직렬화 (entity-level
mutex). 다른 entity 는 reorder 허용.

**Dedup**: 수신 window 는 `(domain, entityId, version)` 마지막 적용을
기억. 같은 version 재수신 시 drop. version < lastApplied 도 drop
(stale).

**Self-echo**: 원인 window 가 자기 action 의 결과 event 를 받으면
optimistic 경로로 이미 적용된 상태. `originWindow === currentWindowLabel`
이면 mutate skip, 단 `version`/`snapshotVersion` 만 갱신 (이후 stale
detection 정확).

**Reset op 처리 흐름 (M7 fix, codex 6차 #4 통일)**:

`op:"reset"` 은 update 와 달리 **refetch 경로를 타지 않는다**. Backend
`reset_setting` 은 `DELETE FROM settings WHERE key = ?` 후 emit —
row 가 사라졌으므로 `get_setting` 은 null 반환할 수밖에 없고
refetch 가 무의미. 그래서:

- **Origin window**: IPC 응답 핸들러에서 store 를 `SETTING_DEFAULTS[key]`
  값으로 즉시 set + Q12 의 theme 인 경우 LS sync write.
- **수신 window** (event 만 받은 다른 window): 같은 `SETTING_DEFAULTS[key]`
  적용 + Q12 의 theme 인 경우 LS sync write.
- **Self-echo**: `originWindow === currentWindowLabel` 시 skip (위
  Self-echo 규칙과 동일), `version` 만 갱신.

`SETTING_DEFAULTS` 는 frontend 의 settings 상수 — backend payload 에
default 값 안 들어감. 모든 window 가 같은 frontend 코드를 실행하므로
default 값 일관성은 자동 보장.

`datagridColumnPrefs` 의 `op:"reset"` 도 같은 패턴 — payload `field`
별로 분기 (codex 8차 #1):
- `field:"widths"`: backend 가 `widths_json='{}'` UPDATE 후 emit.
  수신자는 widths 만 frontend default (자동 column width) 적용,
  hiddenColumns 는 그대로 유지.
- `field:"hiddenColumns"`: backend 가 `hidden_columns_json='[]'` UPDATE
  후 emit. 수신자는 hiddenColumns 만 빈 배열로 set, widths 그대로.
- `field:"all"`: backend 가 row DELETE 후 emit. 수신자는 widths +
  hiddenColumns 모두 default.

세 경우 모두 `get_datagrid_prefs` refetch 안 함.

**Retry**: in-process event 는 transport 신뢰 — retry 없음. 단 frontend
hydrate 가 boot snapshot 이후 첫 event 까지 사이에 missed event 가 있을
수 있어 다음 두 보호:

1. **Listener 선등록**: window mount 시 listener 등록을 snapshot IPC
   호출 **이전** 에 수행. Backend 가 snapshot 응답 보내는 동안 emit_all
   이 발생해도 buffer 됨 (Tauri event listener 가 등록 후 모든 event
   queue 받음). 순서: `listen()` → `getInitialAppState()` → snapshot 처리.
2. **Version gap 감지**: `(domain, entityId)` 별 last applied version
   추적. 수신 event 의 `version > lastApplied + 1` 이면 missed gap —
   해당 domain refetch (예: `domain:"connection"` 이면
   `get_all_connections()` 재호출). `snapshotVersion` gate 는 listener
   등록 전 발생 event 만 막을 수 있어 단독으로는 불충분.

**Subscribe lifecycle**: 각 window 의 root component mount 시 1회
`listen("state-changed", ...)`, unmount 시 unsubscribe. 두 번 listen
방지 (React StrictMode `useEffect` 이중 mount 고려 — cleanup 안에서 ref
flag).

**`schemaCache` 도메인 정책 (Q23)**:
- Trigger: DDL IPC (`CREATE`/`ALTER`/`DROP` table/view/function/trigger/index/column, MongoDB collection 조작) 응답 직후 backend.
- Payload: `{ domain:"schemaCache", op:"invalidate", entityId: connection_id, version, snapshotVersion, originWindow }`.
- Wide invalidation: 받은 window 가 `schemaStore.clearForConnection(connection_id)` — 6 cache (schemas/tables/views/functions/triggers/columns) 모두 drop. `documentStore` 도 같은 connection 의 databases/collections/fields drop.
- Eager refetch: 현재 sidebar 가 그 connection 을 mount 중이면 invalidate 직후 `refreshSchema(connection_id)` 자동 호출. Mount 중 아니면 lazy — 다음 mount 시 빈 cache 라 자동 fetch.
- Self-echo: DDL 한 window 는 IPC 응답 핸들러에서 이미 `clearForConnection` 호출. Event 도착 시 `originWindow === currentWindowLabel` 이면 skip (이중 invalidation 방지).
- 다른 connection 의 schemaCache 는 영향 없음 — `entityId` 가 connection_id 라 다른 connection 의 window 는 wildcard match 안 함.

## F.5 Query History Privacy Contract (A9 — 새 평가 축)

8축 framework 에 **A9 민감 데이터 가능성** 추가:

> A9 = `none | incidental | likely | guaranteed`
>
> - `none`: 데이터에 사용자 입력 literal 없음 (예: theme id)
> - `incidental`: 사용자 입력 가능하지만 드뭄 (예: connection name)
> - `likely`: SQL/Mongo query 등 사용자 작성 statement — literal 에
>   email/token/PII 포함 가능성 상존
> - `guaranteed`: password / API key / token 자체

**`query_history.sql` = `likely`.** 따라서:

1. **Retention**: 기본 보관 30일. SQLite `executed_at < now - 30d`
   row 는 boot 시 vacuum. 사용자가 settings 에서 변경 가능 (7d / 30d /
   90d / forever).
2. **Clear-all**: 사용자가 settings 의 "Clear query history" 클릭 →
   `DELETE FROM query_history` + `VACUUM`. 토스트로 N rows 삭제 안내.
3. **Disable history**: settings 의 boolean key `query_history_enabled`
   (default `true`). **`false` 면** frontend 가 `add_history_entry`
   IPC 호출 안 함. 기존 row 는 유지 (별도 clear). 의미 — "enabled=true 면
   기록함, false 면 기록 안 함". Key 이름과 동작 일치.
4. **Encryption at rest**: SQLite 파일은 OS file-permission (user-only
   read) 으로 충분 — 디스크 풀-디스크 암호화 가정. 추가 sqlite-cipher
   는 도입 안 함 (cross-platform 빌드 비용 > 이득). ADR-0042 (query history privacy) 에 명시. ADR-0036 (telemetry zero) 와 분리.
5. **Sql redaction (필수 컬럼, 실패 시 원문 fallback — codex 4차 #6 fix)**:
   `sql_redacted` 컬럼은 NOT NULL — 항상 row 와 함께 backend 가 생성.
   Regex 로 quoted literal 을 `?` 로 마스킹한 사본. Redact 함수가
   panic / 예외 시 원문 `sql` 로 fallback (column 은 채워짐, 검색 path
   단일 유지). 검색은 `sql_redacted` 위에서 (false negative 적음).
   원문은 row detail view 에서만.
6. **Export 시**: Q1 의 export envelope 은 **connections only** lock —
   query history 포함 안 함. 별도 메뉴 `Export query history` 가 따로 있으며
   이는 envelope 과 다른 wire (단순 JSON dump + 사용자 확인 dialog). Q1
   envelope 과 history export 는 분리된 별 path — envelope 확장이 아님.
7. **Telemetry**: Q10 의 zero-collection 정책 — `sql`/`sql_redacted`
   모두 외부 송신 0.

**List / Detail IPC wire (codex 7차 #4)**:

검색은 redacted 위에서, 원문 보기는 별도 IPC. List 응답은 `sqlRedacted`
만 포함, 원문 `sql` 은 `get_history_detail(id)` 로만.

```ts
// 송신 (camelCase). Backend serde rename_all="camelCase".
// HistoryQueryMode (위 add_history_entry 영역 정의 — codex 9차 #4 공통 union).
type ListHistoryRequest = {
  connectionId?: string;            // 없으면 전체 conn
  // tabId 사용 시 connectionId 동반 필수 (codex 8차 #4) — tab_id 는
  // workspace 의 in-memory counter 라 connection 간 collision 가능.
  // Backend 가 검증: tabId !== undefined && connectionId === undefined →
  // 400 error ("tabId requires connectionId").
  tabId?: string;
  // paradigm/queryMode 필터링 — 별도 HistoryQueryModeFilter union
  // (codex 10차 #1). paradigm 없이 queryMode 만 지정하는 invalid wire 는
  // 타입상 차단. paradigm 만 지정 시 그 paradigm 의 모든 mode 매치.
  filter?: HistoryQueryModeFilter;
  database?: string;
  collection?: string;
  source?: "raw" | "grid-edit" | "ddl-structure" | "mongo-op" | "sidebar-prefetch";
  status?: "success" | "error" | "cancelled";
  search?: string;                  // sql_redacted 위 LIKE %?%
  fromMs?: number;                  // executed_at >= ?
  toMs?: number;                    // executed_at <= ?
  // limit optional, backend 가 default 100 적용. max 500 — 초과 시 backend
  // 가 500 으로 clamp (codex 8차 #3).
  limit?: number;
  cursor?: number | null;           // 직전 page 의 마지막 id (descending pagination)
};

// 응답 — sql 본문 제외. id 만 detail IPC 의 key.
type ListHistoryRow = HistoryQueryMode & {
  id: number;
  connectionId: string;
  tabId: string | null;
  database: string | null;
  collection: string | null;
  source: "raw" | "grid-edit" | "ddl-structure" | "mongo-op" | "sidebar-prefetch";
  sqlRedacted: string;              // ← 검색 / 표시 surface. 원문 sql 은 없음
  status: "success" | "error" | "cancelled";
  errorMessage: string | null;
  rowsAffected: number | null;
  durationMs: number;
  executedAt: number;
  serverPid: number | null;
};

type ListHistoryResponse = {
  rows: ListHistoryRow[];
  nextCursor: number | null;        // null = 더 없음
};

// 원문 보기 (detail panel / "Copy original SQL" / re-run) 만 본문 반환
type GetHistoryDetailRequest  = { id: number };
type GetHistoryDetailResponse = {
  id: number;
  sql: string;                       // 원문 — list 에는 없음
  sqlRedacted: string;
};

// Clear-all (codex 8차 #6 — toast 의 "N rows" 가 deletedCount 에서 옴)
type ClearHistoryRequest  = {};         // 파라미터 없음 — 전체 삭제
type ClearHistoryResponse = {
  deletedCount: number;                 // DELETE 직전 row 수. UI toast "N rows cleared"
};
// 동작 순서 (codex 9차 #1 — SQLite VACUUM 은 transaction 밖에서만 실행 가능):
//   1) BEGIN;
//   2) SELECT COUNT(*) FROM query_history → deletedCount.
//   3) DELETE FROM query_history;
//   4) COMMIT;
//   5) VACUUM;                                 ← transaction 밖
//   6) emit_all({domain:"history", op:"clear", entityId:null,
//                version:N+1, originWindow:caller, ...});
//   7) Return ClearHistoryResponse { deletedCount }.
// VACUUM 실패 시 (디스크 풀 / busy) toast 만 띄우고 ClearHistoryResponse 는
// 정상 반환 — DELETE 는 이미 commit. event 도 emit 됨.
```

**Privacy 보강 AC**:
- List response 어디에도 `sql` 필드 없음 (단위 테스트).
- Detail IPC 는 단일 row id 만 — 일괄 dump path 0 (audit log 무관 — 원문
  bulk extraction 은 별도 `Export query history` 메뉴 1 path 만).
- Detail IPC 호출은 사용자 직접 액션 (panel expand / right-click "View
  original" / re-run) 에만 — 자동 prefetch 금지.

## F.6 Phase 별 Acceptance Criteria

각 Phase 종료 시 다음 기준 충족 — 미충족이면 다음 Phase 진행 금지.

### Phase 0
- [ ] `persistWorkspaces` 가 `tabs[].queryState` 와 `closedTabHistory[].queryState` 둘 다 idle 로 strip 후 write (M-1 fix).
- [ ] `persistWorkspaces` 가 `dirtyTabIds` (Q16) / `sidebar.selectedNode` (Q17) / `sidebar.scrollTop` (Q18) strip — 각각 `[]` / `null` / `0`.
- [ ] `table-view-workspaces` LS blob 의 byte size 가 1000 row 결과 시뮬레이션 후에도 < 50KB (codex 3차 #9 fix — 실제 LS key).
- [ ] `tabCounter` / `queryCounter` 가 boot 직후 `Math.max(persisted ids) + 1` 로 seed (M-2 fix).
- [ ] 시뮬레이션 테스트: tab 5개 persist → restart → tab 추가 시 id 충돌 없음.
- [ ] DataGrid dirty cycle: 셀 수정 → app close → boot → tab marker 0개 → 그 tab 클릭 시에도 marker 0개 (Q16 stale 회귀 방지).
- [ ] Sub-workspace 전환 round-trip (Q17/Q18 검증): dbA 의 schema 1000개 sidebar 에서 500번째 노드 클릭 + 스크롤 → dbB 전환 → dbA 복귀 → selectedNode + scrollTop 둘 다 복원. App restart → 둘 다 default.
- [ ] `closedTabHistory` cap (Q19): `workspaceStore.ts:251` 의 `.slice(0, 20)` → `.slice(0, 25)` 변경. tab 30번 열고 닫기 → `history.length === 25`. 가장 오래된 5개 drop. Boot dehydration 시에도 25 초과면 잘림.
- [ ] `schemaStore` 의 비-schema 5 메서드 호출 사이트가 모두 `lib/tauri/*` 직접 호출로 변경.

### Phase 1
- [ ] `cargo build --features sqlite` 성공 (Win/Mac/Linux CI).
- [ ] `migrations/0001_initial.sql` 적용 후 9 table 존재 (8 domain + `meta` for legacy_imported state — Q20 으로 datagrid_column_prefs 포함).
- [ ] `get_initial_app_state()` IPC 응답 시간 p95 < 50ms (10 connections 시드).
- [ ] Corrupt SQLite 파일 시뮬레이션 → `.bak` rename + fresh start, 사용자 toast 없음 (Q2).
- [ ] Dual-write (W1) — `connections` / `favorites` / `mru` / `settings` 도메인만 file/LS write 와 SQLite write 둘 다 호출, mismatch log 0. **`workspaces` 는 W1 시작 시점부터 SQLite-only** — `localStorage.setItem(..., 'table-view-workspaces')` 가 src/ 코드 grep 0건, 단위 테스트 `persistWorkspaces` 호출 시 LS write 0회 (codex 6차 #5).
- [ ] **Q22 검증**: 신규 사용자 → `.key` 디스크에 안 만들어짐, keyring 에 entry 1개.
- [ ] **Q22 migration**: 기존 사용자 (디스크 `.key` 있음) → boot 1회 후 keyring entry 생기고 디스크 파일 삭제됨. 그 후 connections decrypt 정상.
- [ ] **Q22 Linux fallback**: Secret Service 미가용 환경 시뮬레이션 → file mode 유지 + 1회 toast.

### Phase 2
- [ ] `tab_affinity` HashMap 가 boot 시 빈 상태 (Q5.6 lazy).
- [ ] Tab open 직후 backend `active_connections[conn].tab_affinity[tab]` = `None`. 첫 `executeQuery(tab_id, ...)` 후 `Some((PoolConnection, server_pid))`.
- [ ] `cancel_query(connection_id, server_pid | opid)` 가 PG `pg_cancel_backend` / MySQL `KILL QUERY` / Mongo `killOp` 호출. 통합 테스트.
- [ ] Cancel error enum (`AlreadyCompleted` / `PermissionDenied` / `NetworkError`) — Q5.5 분류 일관.
- [ ] Tab close 시 release IPC + transaction rollback. 미해제 leak 0 (테스트로 검증).
- [ ] **Q23 self-window 검증** (cross-window 는 Phase 3 으로 이동, codex 2차 #5): `CREATE TABLE foo (...)` 실행 → DDL 한 window 의 sidebar 가 100ms 안에 `foo` 표시 (eager, 자기 window 의 schemaStore clear + refetch). Cross-window broadcast 검증은 event infra 머지된 Phase 3 AC 에서.

### Phase 3
- [ ] 2번째 launch → 기존 launcher window focus, 새 process 안 뜸.
- [ ] Launcher window 가 connection 열어도 hide 만 (close 아님).
- [ ] `emit_all` event 가 모든 active window 에 도달 (테스트 launcher + 2 workspace).
- [ ] Single-instance plugin 등록 후 cold-boot regression < 50ms (Sprint 175 baseline 대비).
- [ ] **Window label 마이그 (선행 조건, Q13/Q15 에 필수)**: 현재 `launcher.rs:71` / `window-label.ts:19` 의 단일 `"workspace"` label 을 **per-connection `workspace-{connection_id}`** 로 변경. 영향:
  - Backend: `open_workspace_window(connection_id)` IPC 신설 — 기존 label 존재하면 focus, 없으면 신규 create.
  - Frontend: `KnownWindowLabel` union 확장 (`"launcher" | \`workspace-${string}\``). Router 의 window resolve 로직, close handler, `useCurrentWindowConnectionId()` hook 모두 새 label 패턴 인식.
  - 이 마이그 없이 Phase 4 의 `useCurrentWindowConnectionId()` 또는 Q15 workspace-only derive 가 동작 안 함.
- [ ] **Q13 검증**: 같은 connection 두 번째 클릭 시 새 window 안 뜸. 기존 `workspace-{connection_id}` window label focus 만. Backend `open_workspace_window(conn_id)` idempotent.
- [ ] **Q14 검증**: backend status 변경 (connect / disconnect / error / `connecting` 신규 variant 포함) 시 모든 window 의 `connectionStore.activeStatuses` 50ms 안에 mirror 갱신. Rust enum 확장 (`Connecting` + `Connected { active_db }`) 적용됨.
- [ ] **ConnectionStatus serde regression test** (codex 3차 #6 + 4차 #4): 새 serde 출력 4 case 모두 명시 assert — `Connected{Some("foo")} → {"type":"connected","activeDb":"foo"}`, `Connected{None} → {"type":"connected"}` (activeDb 필드 생략, `skip_serializing_if`), `Connecting → {"type":"connecting"}`, `Error{...} → {"type":"error","message":"..."}`. `active_db` snake 또는 `activeDb: null` 이 wire 에 나타나면 test fail.
- [ ] **Q23 event delivery 검증** (codex 3차 #10 fix — Q13 으로 같은 conn 두 workspace 불가능하므로 mutate cross-window 는 검증 불가, 대신 event 라우팅 자체 검증): workspace window A 의 DDL → launcher window 가 50ms 안에 schemaCache invalidate event 수신 (Tauri event listener log). Launcher 는 schemaStore 없으므로 mutate 0 (no-op). 추가: 별도 test harness window (페이크 schemaStore 보유) 를 e2e 에서 spawn 해서 mutate 경로 검증 — schemaStore.clearForConnection 호출 1회.

### Phase 4
- [ ] Boot 시 `loadAllFromSnapshot()` 호출 → 5 store hydrate 완료까지 < 100ms.
- [ ] **Listener 선등록 boot-order 테스트 (codex 2차 #12 fix)**: `listen("state-changed")` 가 `get_initial_app_state()` IPC 호출 **이전** 에 등록. 통합 테스트: snapshot IPC handler 안에서 fake emit_all → frontend 가 그 event queue 에서 받음 (listener buffer 검증).
- [ ] localStorage key (실제 코드 확인, codex 4차 #5 — `view-table.safeMode` 정정) — `table-view-workspaces` / `table-view-favorites` / `table-view-mru` / `table-view-theme` / `view-table.safeMode` / `RECENT_COLLAPSE_KEY` / `WIDTH_KEY` / `COLLAPSE_KEY` / `column-widths:*` / `hidden-columns:*` — 모두 read 사이트 0 (grep CI). 단 `table-view-theme` 만 ThemeBoot 의 FOUC cache read 1사이트 유지 (Q12). SafeMode LS 는 Q12 결정에서 LS write 제거 (FOUC critical 아님).
- [ ] ThemeBoot 만 localStorage **read** (FOUC 회피 cache).
- [ ] `setTheme` / `setSafeMode` 액션이 LS 직접 write 안 함 — IPC 후 store mutate 안에서만 LS write (Q12 흐름).
- [ ] Theme 변경 시 다른 window 의 theme 도 50ms 안에 적용 (in-process event 검증).
- [ ] LS-only 시뮬레이션 테스트: SQLite 의 theme 값을 외부에서 다른 값으로 변경 후 boot → 첫 paint 는 LS 값 (FOUC 0), 그 후 silent 갱신 (jump 없이 transition 권장).
- [ ] **Q15 workspace migration**: `useCurrentWindowConnectionId()` hook 도입 (Tauri window label `workspace-{conn_id}` 에서 derive). Workspace code path 정의 (M5 fix) — `src/pages/WorkspacePage.tsx` 와 그 하위 컴포넌트 트리 (`src/components/layout/Sidebar.tsx`, `src/components/datagrid/**`, `src/components/query/**`, `src/components/schema/**`, `src/components/document/**`, `src/components/rdb/**`). Launcher code path = `src/pages/HomePage.tsx` + `src/components/connection/**` (connection list / group UI). 위 workspace path 에서 `connectionStore.focusedConnId` read 0건 — grep CI 로 강제 (`pnpm lint` 의 `no-restricted-syntax` 또는 별도 grep test). 영향 사이트: 최소 `Sidebar.tsx:55`, `workspaceStore.ts:854` — 모두 hook 으로 대체.
- [ ] **Test helper 마이그 (L2 fix)**: `workspaceStoreTestHelpers.ts` 의 `focusedConnId` set helper 도 hook 으로 stub 또는 launcher-only path 로 분리. 테스트는 workspace tree 를 mount 할 때 fake `WindowConnectionId` provider 를 주입.
- [ ] `connectionStore.focusedConnId` 슬롯은 launcher window 에서만 mutate / read. Workspace window 에서 set 호출 0건.
- [ ] W2 dual-read 동안 mismatch log 0 — 1주일 dogfood 후 W3 진입.

### Phase 5
- [ ] `queryHistoryStore.entries` + `globalLog` 모두 retire — store 자체가 thin wrapper.
- [ ] Phase 5 첫 boot 시 store 의 leftover `entries`/`globalLog` 메모리 비움 (M-4/L5 책임 중복 해소). 정적 read 0건 — 모든 read 사이트가 backend IPC `list_history(filter)` 로 변경됨을 grep CI 로 확인.
- [ ] History panel 이 SQL `WHERE connection_id = ? AND tab_id = ?` 로 derive (F.2 schema, Q13 반영).
- [ ] `add_history_entry` IPC source 분류 5종 (`raw` / `grid-edit` / `ddl-structure` / `mongo-op` / `sidebar-prefetch`) 모두 적어도 1회 호출 (e2e 검증).
- [ ] A9 retention — 31일 된 row 가 boot vacuum 후 0건 (시드 테스트).
- [ ] "Disable history" 토글 → 이후 insert IPC 호출 0건.

### Phase 6
- [ ] ADR-0032 ~ ADR-0042 머지.
- [ ] `session-storage.ts` → `scopedLocalStorage.ts` rename, 모든 import 갱신.
- [ ] 모듈 변수 8개 정리 — store internal field 또는 reset API.
- [ ] W4 — `.legacy.json` 30일 후 cleanup CLI cron 등록.
- [ ] `tab_id IS NULL` history row 분석 — sidebar-prefetch 만 null 이어야 함.
- [ ] **Reset-to-default UI audit (Q21)** — 모든 A 영속 항목마다 reset affordance 존재 검증:
  - `theme` / `safe_mode` / `query_history_retention_days` / `query_history_enabled` → 설정 패널 안 "Reset settings" 버튼.
  - `home_recent_collapsed` → Home "Recent" 섹션 헤더 우클릭 메뉴 "Reset".
  - `sidebar_width` → (1) Sidebar resize handle 우클릭 메뉴 "Reset width" + (2) 설정 패널 "Layout" 섹션 의 "Reset sidebar width" — 더블클릭만으로는 사용자 발견 불가 (convention 약함, M4 fix), 우클릭 또는 설정 panel 이 primary affordance.
  - `connection_groups.collapsed` → group 헤더 우클릭 "Reset collapse states".
  - `datagrid_column_prefs.widths_json` → DataGrid column header 우클릭 "Reset column widths".
  - `datagrid_column_prefs.hidden_columns_json` → DataGrid column header 우클릭 "Show all columns".
  - `workspaces.sidebar_expanded_json` → Sidebar 헤더 우클릭 "Collapse all".
  - `mru.recent_connections` → Home / launcher 메뉴 "Clear recent".
  - `favorites` → favorites panel 의 각 entry 별 remove (이미 존재).
  - 미커버 항목 발견 시 머지 보류 + UI 추가.

---

## Related

- [`code-smell-audit-2026-05-15.md`](../audits/code-smell-audit-2026-05-15.md) Part B
  — store 책임 mismatch / invariant 누수 (L1–L10).
- ADR 0001 — Desktop stack Tauri v2 + sqlx (현재 sqlite feature 미사용 — Phase 1 에서 추가).
- ADR 0002 — Zustand 채택.
- ADR 0025 — DataGrid self-managed (TanStack 미도입) — D1 의 TanStack 옵션 배제 근거.
- ADR 0027 — Per-workspace state store (Q4 / Q5 와 paired).
- `docs/archives/decisions/0021-export-envelope-auto-mnemonic-no-ttl/memory.md` — Q1 의 envelope 모델.
- `docs/archives/roadmaps/memory-roadmap/memory.md` — TablePlus 패리티 방향성 (Q5 affinity 근거).
