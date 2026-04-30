# UX Laws — Action Plan

> 출처: [`docs/ux-laws-mapping.md`](ux-laws-mapping.md) Top 6
> 작성일: 2026-04-30 · 작성자: 계획만, 실행 X
> 사용법: 이 문서는 transient. 각 항목이 sprint contract로 분해되면 해당 항목 줄을 지운다. 마지막 항목까지 분해되면 본 문서 폐기.

## 진행 상황

| # | UX 법칙 | 상태 |
|---|---------|------|
| 1 | Peak-End / Zeigarnik / Von Restorff (P1 5건) | ✅ sprint-97~101 완료 |
| 2 | Selective Attention | 📋 계획 (아래 §A) |
| 3 | Law of Similarity + Jakob's Law (Mongo MQL) | 📋 계획 (§B) |
| 4 | Postel's Law | 📋 계획 (§C) |
| 5 | Mental Model | 📋 계획 (§D) |
| 6 | Doherty + Goal-Gradient | 📋 계획 (§E) |

---

## §A. Selective Attention — refetch overlay 포인터 차단 + RISK-035 플래시 가드

**대상 RISK**: RISK-009 (refetch 오버레이) + RISK-035 (StructurePanel 첫 렌더 flash)
**비용**: 작음 (≈1d)
**의존성**: 없음 — 기존 z-20 overlay 위에 한 줄 추가

### A.1 현재 상태
- `src/components/datagrid/DataGridTable.tsx:829-833` — loading overlay (`absolute inset-0 z-20 bg-background/60`). `pointer-events` 미설정 → spinner 위에서 행 클릭/더블클릭/메뉴가 grid에 도달.
- `src/components/schema/StructurePanel.tsx:27` — `loading` 초기값 `false`, `hasFetched` 미도입 → 첫 렌더에 `data.length === 0`일 때 "No columns found" 노출 가능 (RISK-035).
- 다른 overlay 후보 (audit 필요): `EditableQueryResultGrid`, `QueryResultGrid`, `DocumentDataGrid`, `SchemaTree` skeleton 등.

### A.2 Step-by-step
1. **Audit**: `grep -rn "absolute inset-0" src/components` → loading/refetch 의도의 overlay 식별. 결과를 contract `findings.md`에 listing.
2. **DataGridTable overlay 수정**: `<div className="absolute inset-0 z-20 ... pointer-events-none">` 추가. spinner는 visual만이므로 click target 불필요.
3. **다른 overlay에 동일 적용**: audit 결과 모든 loading overlay에 `pointer-events-none` 일관 적용.
4. **StructurePanel 가드**: 두 옵션 중 택1 — (a) `loading` 초기값 `true`, useEffect mount 시 fetch 직후 false, (b) `hasFetched: boolean` state 도입 후 `!hasFetched` 동안 빈 상태 미노출. (b) 권장 — race condition 회피.
5. **회귀 테스트** 추가:
   - DataGridTable: `loading=true` 중 cell 더블클릭 시 grid `onCellDoubleClick` 미호출 단언 (`fireEvent` + `getByRole("grid")` blocking)
   - StructurePanel: 첫 렌더 직후 `queryByText("No columns found")` null 단언
6. **RISK 종결**: `docs/RISKS.md`에서 RISK-009/035 → resolved + Resolution Log 항목 작성.

### A.3 AC
- AC-01: refetch 중 user pointer 이벤트가 grid 행에 도달하지 않음.
- AC-02: spinner 시각 위치/색 unchanged (회귀 0).
- AC-03: 다른 loading overlay (≥2개)도 동일 적용 — audit 결과대로 일관.
- AC-04: StructurePanel 첫 렌더에 빈 상태 미노출.
- AC-05: RISK-009 + RISK-035 resolved.

### A.4 위험
- spinner 위 클릭 dismiss 같은 의도적 동작이 있다면 깨짐 — 현재 코드 미확인. audit step 1에서 확인.
- e2e가 spinner 영역을 클릭하는 케이스 — Playwright 셀렉터 검토.

---

## §B. Law of Similarity — `QuerySyntax` 일관 적용 + Mongo MQL 색

**대상**: 시각 일관성 격차 1건 (`QueryLog.tsx`)
**비용**: 작음~중 (≈2d)
**의존성**: 없음 — `QuerySyntax` dispatcher + `MongoSyntax` 이미 존재 (Sprint 85)

### B.1 현재 상태
- `src/components/shared/QuerySyntax.tsx` — paradigm dispatcher (`document` → `MongoSyntax`, else `SqlSyntax`).
- 호출처: `QueryTab.tsx`, `GlobalQueryLogPanel.tsx` ✅
- 격차: `src/components/query/QueryLog.tsx:115` — `truncateSql(entry.sql, 80)` plain text 사용.
- `QueryHistoryEntry`에 `paradigm: Paradigm` + `queryMode: QueryMode` 이미 정의됨 (`src/stores/queryHistoryStore.ts:18`).
- **legacy entry 폴백 함정**: `paradigm` 없는 entry는 `"rdb"`로 fallback (`queryHistoryStore.ts:75`) → Mongo 쿼리에 paradigm 누락 시 SQL 색으로 칠해짐.

### B.2 Step-by-step
1. **QueryLog.tsx 교체**: line 115 `{truncateSql(entry.sql, 80)}` → `<QuerySyntax sql={truncateSql(entry.sql, 80)} paradigm={entry.paradigm} queryMode={entry.queryMode} />`. truncate는 외부에서 먼저 — highlighting 비용 최소화.
2. **성능 측정**: QueryLog가 50~100 entry 렌더 시 CodeMirror 인스턴스 다수 mount 위험. 만약 `MongoSyntax`/`SqlSyntax`가 CodeMirror 기반이면, list 컨텍스트에서는 lightweight 토큰 렌더(`<pre>` + span)로 분기 필요. 현 구현 확인 후 결정.
3. **paradigm prop 누락 audit**: TS strict로 `paradigm?: Paradigm` → `paradigm: Paradigm` 강제 변경 검토. 모든 호출처가 이미 entry-level paradigm을 가지므로 가능. legacy entry 폴백은 store 레이어에서만 (`queryHistoryStore.ts:75`).
4. **회귀 가드**: `QueryLog.test.tsx` 신규 — Mongo entry가 `MongoSyntax` 마커 (e.g., JSON quote color) 단언, RDB entry는 SQL keyword 마커 단언.
5. **다른 호출처 audit**: `grep -rn "entry.sql\|history.*sql" src/components` → 또 다른 plain text 격차 있는지 확인. 발견 시 본 sprint 범위 흡수 또는 후속 micro-sprint.

### B.3 AC
- AC-01: QueryLog 항목이 `paradigm`에 맞는 highlighter로 렌더.
- AC-02: Mongo entry가 SQL 색으로 칠해지지 않음 (회귀 가드).
- AC-03: paradigm prop 명시 누락 시 TS 컴파일 에러 (또는 lint 경고).
- AC-04: 50 entry 렌더 시 paint < 16ms (RISK-028과 별개로 측정).
- AC-05: 다른 `QuerySyntax` 호출처 회귀 0.

### B.4 위험
- CodeMirror 인스턴스 다수 mount → 성능 회귀. 측정 후 lightweight 분기 결정.
- Mongo entry 중 multi-line BSON → truncate 80자로 잘리면 JSON 부분 깨짐. truncate 길이 paradigm-aware (Mongo 시 더 길게).

---

## §C. Postel's Law — ConnectionDialog 입력 정규화

**대상**: `src/components/connection/ConnectionDialog.tsx`
**비용**: 중 (≈2d)
**의존성**: 없음 — UI primitive 격리

### C.1 현재 상태
- 사용자가 `postgres://user:pass@localhost:5432/db` 형식 URL을 host에 붙여넣으면 strict로 그대로 들어가 연결 실패.
- 다른 필드 trim 안 됨 (앞뒤 공백 입력 시 연결 실패 또는 storage 오염).
- DBMS 종속 URL scheme: postgres/postgresql, mongodb/mongodb+srv, mysql, mariadb, sqlite (file:).

### C.2 Step-by-step
1. **URL parser 모듈 신규**: `src/lib/connection/urlParser.ts`.
   - `parseConnectionUrl(input: string, dbType: DatabaseType): Partial<ConnectionConfig> | null`
   - 지원 scheme: `postgres://`, `postgresql://`, `mongodb://`, `mongodb+srv://`, `mysql://`, `mariadb://`, `sqlite:` (file path)
   - WHATWG `URL` 사용 + 각 DBMS query 파라미터 파싱 (sslmode, replicaSet 등)
   - 단위 테스트: 각 scheme + edge case (encoded password, IPv6, `host:port` 만)
2. **host 필드 paste 핸들러**: `onPaste` (또는 `onChange`에서 URL 패턴 감지). URL 감지 시 → `parseConnectionUrl` → 다른 필드로 `setValue` + 토스트 "URL detected — fields populated. Undo".
3. **trim 적용 위치**: `onSave` / `onConnect` 시점 — display 시점은 사용자 입력 그대로.
   - 영향 필드: host, database, username, group_name, ssh_host, ssh_user
   - password는 trim 금지 (의도적 공백 가능성).
4. **`host:port` 분리**: host 필드 blur 시 `:` 포함 + tail이 number → port 필드로 이동.
5. **회귀 테스트**:
   - 정상 입력 (URL 아님)은 그대로 보존.
   - 잘못된 URL (e.g., `postgres://malformed`)은 host에 그대로 + 에러 토스트 미발생.
   - Password 평문이 토스트 메시지에 노출되지 않는지 단언.
6. **e2e 후보**: ConnectionDialog에서 paste → connect → 성공 (1 시나리오).

### C.3 AC
- AC-01: 5종 DBMS URL 붙여넣기 → 필드 자동 분배.
- AC-02: 모든 string field에 trim 적용 (save 시점).
- AC-03: `localhost:5432` → host=localhost, port=5432.
- AC-04: 잘못된 URL은 host에 그대로 (best-effort).
- AC-05: Password 노출 없음.
- AC-06: Undo 동작 (토스트 버튼 또는 Cmd+Z) — Stretch goal.

### C.4 위험
- 사용자가 URL이 아닌 문자열을 의도적으로 host에 입력했는데 `://` 패턴이 우연히 포함된 경우 — false positive 위험. 최소 scheme allowlist로 1차 필터.
- mongodb+srv는 SRV record 조회 — frontend에서 못 함. 파싱만 하고 host는 srv-host 그대로 보존, 서버에서 resolve.

---

## §D. Mental Model — Mongo paradigm 용어 정합성

**대상**: 다수 컴포넌트 (DataGridToolbar, FilterBar, StructurePanel, ColumnsList 등)
**비용**: 중 (≈2~3d)
**의존성**: paradigm prop 전파 (대부분 이미 존재)

### D.1 현재 상태
- 일부 paradigm-aware 적용됨 (sidebar table→collection, useDataGridEdit document 모드 등).
- 격차: 여전히 "Column" / "Add Column" / "Columns" 라벨이 RDB 어휘로 Mongo 컨텍스트에서 노출.
- Audit 필요: `grep -in "column\|table\|row" src/components/**/*.tsx` (UI 라벨만, prop/type/주석 제외).

### D.2 Step-by-step
1. **라벨 사전 신규**: `src/lib/paradigm/labels.ts`
   ```ts
   export const paradigmLabels = {
     rdb:      { unit: "Column", units: "Columns", record: "Row",      records: "Rows",       container: "Table",      addUnit: "Add Column" },
     document: { unit: "Field",  units: "Fields",  record: "Document", records: "Documents",  container: "Collection", addUnit: "Add Field"  },
     search:   { unit: "Field",  units: "Fields",  record: "Document", records: "Documents",  container: "Index",      addUnit: "Add Field"  },
     kv:       { unit: "Type",   units: "Types",   record: "Entry",    records: "Entries",    container: "Key prefix", addUnit: "—" },
   } as const;
   ```
2. **Hook 신규**: `src/hooks/useParadigmLabels.ts` — 현재 paradigm을 받아 사전 슬라이스 반환.
3. **Audit 결과 기반 컴포넌트 패치**:
   - `DataGridToolbar.tsx`: "Add Column" → `labels.addUnit`
   - `FilterBar.tsx`: "Column" 헤더 → `labels.unit`
   - `StructurePanel.tsx`: 탭 라벨 "Columns" → `labels.units`
   - `ColumnsList.tsx`: 비어있음 메시지 "No columns found" → "No {labels.units.toLowerCase()} found"
   - 기타 audit에서 발견된 항목.
4. **e2e 셀렉터 갱신**: 텍스트 기반 셀렉터가 깨지지 않도록 — 가능한 곳은 `data-testid` 도입, 안 되면 paradigm 분기 셀렉터.
5. **회귀 테스트**: 각 컴포넌트 paradigm prop 변화 → 라벨 변화 단언 (RTL `getByText`).
6. **i18n 호환성**: 미래 i18n 도입 시 사전이 i18n 키로 매핑되도록 구조 보존 (값을 `t(key)`로 교체 가능).

### D.3 AC
- AC-01: Mongo 컨텍스트에서 모든 사용자 가시 라벨이 Mongo 어휘.
- AC-02: RDB/Search/KV 컨텍스트 라벨 회귀 0.
- AC-03: paradigm prop 누락 시 fallback="rdb" — RDB 어휘 (legacy 안전).
- AC-04: 라벨 사전이 단일 source of truth — 인라인 string 잔존 0 (audit으로 확인).

### D.4 위험
- e2e 셀렉터 광범위 깨짐 — Playwright suite 별도 patch 필요.
- 라벨 길이 차이 (Field 5자 vs Column 6자, Document 8자 vs Row 3자) → 좁은 컬럼/툴바에서 wrap. 실측 필요 (RISK-030 1024×600과 묶어 검증).

---

## §E. Doherty + Goal-Gradient — 1s+ async progress + cancel

**대상**: 4 vector — data fetch / query exec / schema load / refetch
**비용**: 큼 (≈4~5d) — backend trait까지 변경
**의존성**: §A 완료 (overlay click-through 차단 후 cancel 버튼 추가)

### E.1 현재 상태
- 1초+ 작업에 spinner만, cancel 없음.
- Tauri `invoke()` 자체는 cancel 미지원 — 별도 cancel command가 필요.
- 어댑터별 cancel 능력 차이:
  - PostgreSQL (sqlx): connection-level cancel (`pg_cancel_backend`)
  - MySQL (sqlx): `KILL QUERY <id>`
  - SQLite: 단일 쓰레드 — 본질적으로 cancel 어려움
  - MongoDB driver: native `abortSignal` 지원
  - Redis: `CLIENT KILL`

### E.2 Step-by-step
1. **Cancel 추상화 ADR**: 새 ADR 작성 — "DbAdapter trait의 best-effort cancel 정책". 어댑터별 cancel 보장 수준 명시 (PG/Mongo: in-flight 취소 보장, SQLite: 다음 statement 경계까지 대기).
2. **Rust trait 확장**: `DbAdapter` trait에 cancel token receive 시그니처. 모든 long-running 메서드 (`get_table_data`, `execute_query`, `get_table_schema` 등)에 `CancellationToken` 인자 추가.
3. **Cancel command 신규**: `#[tauri::command] async fn cancel_query(token_id: String) -> Result<(), AppError>` — 프론트가 invoke한 토큰을 취소.
4. **프론트 hook 신규**: `useCancellableAsync<T>(invoke: () => Promise<T>, options: { thresholdMs: 1000 })` 반환 `{ data, loading, progress, cancel, error }`.
5. **Progress overlay 컴포넌트**: `<ProgressOverlay onCancel={cancel} elapsed={elapsedMs} />` — 1s 이전 미노출, 1s 이후 indeterminate progress + Cancel 버튼.
6. **4 vector 적용**:
   - `DataGrid.tsx` fetchData → 기존 `fetchIdRef` 패턴과 통합 (race + cancel 동시 처리)
   - `QueryEditor` execute → `addHistoryEntry`에 status="cancelled" 추가
   - `StructurePanel.tsx` schema load → 같은 hook
   - refetch → 동일
7. **회귀 테스트**:
   - <1초 작업: progress overlay 미노출 (timer 안 눌림)
   - 1.5초 작업: 1s 시점에 overlay 등장, Cancel 클릭 시 abort 신호 → loading=false
   - cancel 후 재시도: 정상 동작
   - 어댑터별 backend 단위 테스트 (cancel token receive)
8. **e2e**: long-running query (e.g., `pg_sleep(3)`) → 1s overlay → Cancel → grid empty + 토스트.

### E.3 AC
- AC-01: 1초 후 progress overlay + Cancel 버튼.
- AC-02: Cancel → 백엔드 abort → UI 즉시 복구.
- AC-03: <1초 작업은 overlay 없음 (flicker 0).
- AC-04: 4 vector 동일 패턴.
- AC-05: RDB/Mongo 어댑터에서 in-flight cancel 검증 (SQLite는 best-effort 명시).
- AC-06: cancelled 쿼리는 history에 status="cancelled"로 기록.

### E.4 위험
- SQLite cancel 본질적 한계 — ADR에 명시.
- Cancel token state 관리 — token id 누수 방지 (memory leak). HashMap에 weak ref 또는 timeout cleanup.
- cancel 타이밍 race: cancel 도달 전 결과 도착 → 결과 무시 정책 필요 (`fetchIdRef` 패턴과 통합).
- 4 vector 동시 적용 → PR 크기 큼. sub-sprint 분할 고려: §E.1 (RDB만) → §E.2 (Mongo) → §E.3 (UI hook) — sprint-180a/b/c.

---

## 의존성 그래프 & 추천 순서

```
§A (RISK-009/035)  ──┐
                     ├──→ §E (cancel; overlay + cancel 버튼이 §A의 pointer-events와 양립해야 함)
§C (Postel)        ──┤
§D (Mongo 용어)    ──┤
§B (QuerySyntax)   ──┘
```

**권장 순서**: A → B → C → D → E
- A 가장 작음, RISK 두 개 즉시 종결, 신뢰 빠르게 쌓음.
- B paradigm prop 인프라 검증 (D의 사전 검증 효과).
- C UI primitive 격리, 회귀 면적 작음.
- D paradigm-aware 라벨 도입 (B로 paradigm 흐름 확인 후 진입).
- E 가장 큰 작업 — 위 4개로 UI 안정화 후 백엔드까지 변경.

## 폐기 조건

- 각 §A~§E이 sprint contract로 분해되면 해당 절을 본 문서에서 삭제.
- §A~§E 모두 분해 완료 후 본 문서 자체 삭제 (`git log --grep="ux-laws-action-plan"` + sprint-176~180 contract로 추적).
- 분해 도중 우선순위 변경 / scope drift 발생 시 본 문서 직접 수정 — sprint contract와 동기화.
