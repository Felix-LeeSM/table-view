# Feature Spec: Phase 5 -- Extended Features

## Description

Phase 4(Editing & Polish) 완료 후 6개의 확장 기능을 구현하여 TablePlus 대체 도구로서의 완성도를 높인다. Views/Functions/Procedures 탐색으로 스키마 가시성을 확장하고, Quick Look으로 행 데이터를 상세히 검토하며, 쿼리 즐겨찾기와 향상된 쿼리 로그로 쿼리 작성 워크플로우를 강화한다. 연결 태그/환경 라벨로 다중 연결 관리 체험을 개선한다.

## Features (6)

| ID | Feature | Scope |
|----|---------|-------|
| F1.4 | Connection Tags & Colors | ConnectionConfig 확장, Sidebar UI, 필터 |
| F2.6 | Views Exploration | Rust `list_views`, SchemaTree Views 카테고리 활성화 |
| F2.7 | Functions & Procedures | Rust `list_functions`/`list_procedures`, 소스 코드 조회 |
| F3.6 | Data Detail View (Quick Look) | 행 선택 시 상세 패널, JSON 포맷, BLOB 뷰어 재사용 |
| F4.7 | Query Favorites | 쿼리 저장/재사용, 연결별/전역, localStorage 영속화 |
| F5.3 | Enhanced Query Log Panel | 전체 탭 누적 로그, 검색, 복사, 연결별 필터, 단축키 |

## Sprint Breakdown

### Sprint 55: Views & Functions Backend + SchemaTree Integration

**Goal**: Rust 백엔드에 Views, Functions, Procedures 조회 명령을 추가하고, SchemaTree의 빈 카테고리 플레이스홀더를 실제 데이터로 채운다. 이 스프린트는 F2.6과 F2.7의 백엔드 기반이자 프론트엔드 연결을 모두 포함한다.

**Verification Profile**: command

**Acceptance Criteria**:

1. `list_views` Tauri command가 지정된 스키마의 모든 뷰(`table_type = 'VIEW'`)를 반환한다 -- 반환 타입은 `Vec<ViewInfo>`이며 ViewInfo는 `{ name, schema, definition: Option<String> }` 필드를 갖는다
2. `list_functions` Tauri command가 지정된 스키마의 모든 함수를 반환한다 -- 반환 타입은 `Vec<FunctionInfo>`이며 FunctionInfo는 `{ name, schema, return_type, argument_types: Vec<String>, source: Option<String> }` 필드를 갖는다
3. `list_procedures` Tauri command가 지정된 스키마의 프로시저를 반환한다 (PostgreSQL은 프로시저와 함수를 pg_proc에서 구분, `prokind` 기준). 반환 타입은 `Vec<FunctionInfo>`와 동일한 구조
4. `get_view_definition` Tauri command가 지정된 뷰의 정의 SQL을 `pg_views.definition`에서 반환한다
5. `get_function_source` Tauri command가 지정된 함수의 소스 코드를 `pg_proc.prosrc`에서 반환한다
6. SchemaTree의 Views 카테고리가 실제 뷰 목록을 표시한다 (기존 "No views" 플레이스홀더 대체). 뷰 클릭 시 테이블과 동일한 UX로 데이터 탐색 탭이 열린다
7. SchemaTree의 Functions 카테고리가 실제 함수 목록을 표시한다. 함수 클릭 시 쿼리 탭이 열리고 함수 소스 코드가 에디터에 삽입된다
8. SchemaTree의 Procedures 카테고리가 실제 프로시저 목록을 표시한다. 프로시저 클릭 시 함수와 동일하게 쿼리 탭에 소스 코드가 삽입된다
9. `cargo test` 통과, `pnpm test` 통과, `pnpm tsc --noEmit` 통과

**Components to Create/Modify**:

- `src-tauri/src/models/schema.rs`: `ViewInfo`, `FunctionInfo` struct 추가 (신규)
- `src-tauri/src/db/postgres.rs`: `list_views`, `list_functions`, `list_procedures`, `get_view_definition`, `get_function_source` 메서드 추가
- `src-tauri/src/commands/schema.rs`: `list_views`, `list_functions`, `list_procedures`, `get_view_definition`, `get_function_source` Tauri command 추가
- `src-tauri/src/commands/mod.rs`: 신규 command 등록
- `src-tauri/src/main.rs`: 신규 command `invoke_handler` 등록
- `src/types/schema.ts`: `ViewInfo`, `FunctionInfo` TypeScript 인터페이스 추가
- `src/lib/tauri.ts`: `listViews`, `listFunctions`, `listProcedures`, `getViewDefinition`, `getFunctionSource` 함수 추가
- `src/stores/schemaStore.ts`: `views: Record<string, ViewInfo[]>`, `functions: Record<string, FunctionInfo[]>`, `procedures: Record<string, FunctionInfo[]>` 상태 및 `loadViews`, `loadFunctions`, `loadProcedures` 액션 추가
- `src/components/SchemaTree.tsx`: CATEGORIES 렌더링 로직 수정 -- views, functions, procedures 카테고리에 실제 데이터 표시. `handleViewClick`, `handleFunctionClick`, `handleProcedureClick` 핸들러 추가

**Data Flow**:

- SchemaTree가 스키마 확장 시 `loadTables`와 함께 `loadViews`, `loadFunctions`, `loadProcedures`를 병렬 호출
- Views는 기존 `query_table_data`를 그대로 재사용 가능 (`SELECT * FROM schema.view_name`)
- Functions/Procedures 클릭 시 쿼리 탭이 열리고 `get_function_source` 결과가 에디터에 자동 삽입

---

### Sprint 56: Data Detail View (Quick Look)

**Goal**: DataGrid에서 행 선택 시 하단 패널에 선택된 행의 전체 필드를 키-값 형태로 상세 표시한다. JSON 포맷팅, 대용량 텍스트 스크롤, BLOB hex 뷰어를 제공한다.

**Verification Profile**: command

**Acceptance Criteria**:

1. DataGrid에서 단일 행 클릭 시 하단에 Quick Look 패널이 나타나며, 컬럼명-값 쌍이 키-값 목록으로 표시된다
2. Quick Look 패널은 DataGrid 하단에 고정되며, 드래그로 높이를 조절할 수 있다 (기본 높이 180px, 최소 100px, 최대 400px)
3. JSON/JSONB 값은 포맷팅(들여쓰기)되어 구문 강조와 함께 표시된다
4. text/varchar 등 긴 문자열 값은 스크롤 가능한 텍스트 영역(max-height 80px)으로 표시된다
5. BLOB/binary 값은 "(BLOB)" 뱃지와 함께 표시되며, 클릭 시 기존 BlobViewerDialog가 열린다 (Sprint 53 구현체 재사용)
6. NULL 값은 흐린 텍스트로 "NULL"이라고 표시된다
7. Quick Look 패널 좌측 상단에 닫기 버튼(X)이 있으며, 행 선택 해제 시에도 패널이 자동으로 닫힌다
8. 다중 행 선택 시 첫 번째 선택 행의 데이터가 Quick Look에 표시된다
9. Quick Look 패널의 값 클릭 시 해당 값이 클립보드에 복사된다
10. `pnpm test` 통과, `pnpm tsc --noEmit` 통과

**Components to Create/Modify**:

- 신규 컴포넌트 `src/components/datagrid/QuickLookPanel.tsx`: 행 상세 표시 패널. Props: `columns`, `row`, `onClose`, `openBlobViewer`
- `src/components/datagrid/DataGridTable.tsx`: Quick Look 패널 렌더링 추가, 행 선택 상태를 Quick Look에 전달
- `src/components/DataGrid.tsx`: Quick Look 패널 표시/숨김 상태 관리, 패널 높이 리사이즈 로직
- `src/hooks/useResizablePanel.ts`: 하단 패널 리사이즈 로직 재사용 (또는 확장)

**Data Flow**:

- DataGridTable의 행 클릭 이벤트에서 선택된 행 데이터(row: `unknown[]`)와 컬럼 메타데이터를 QuickLookPanel에 전달
- QuickLookPanel은 컬럼명과 값을 순회하며 데이터 타입별로 적절한 렌더러(json/text/blob/null) 선택
- BLOB 값 클릭 시 BlobViewerDialog의 open 상태를 true로 설정하고 데이터 전달

---

### Sprint 57: Query Favorites

**Goal**: 자주 사용하는 쿼리를 이름과 함께 저장하고, 즐겨찾기 목록에서 재사용할 수 있게 한다. 연결별 또는 전역으로 관리되며 localStorage에 영속화된다.

**Verification Profile**: command

**Acceptance Criteria**:

1. 쿼리 에디터 툴바에 "Save to Favorites" 버튼(Star 아이콘)이 있다. 클릭 시 이름 입력 다이얼로그가 열리고, 저장 시 이름+SQL 쌍이 즐겨찾기에 추가된다
2. 쿼리 에디터 툴바에 "Favorites" 버튼(Bookmark 아이콘)이 있다. 클릭 시 드롭다운 패널에 즐겨찾기 목록이 표시된다
3. 즐겨찾기 목록 항목을 클릭하면 해당 SQL이 쿼리 에디터에 삽입된다 (기존 내용 교체)
4. 즐겨찾기 항목에 우클릭 또는 삭제 아이콘 클릭 시 삭제 가능하다
5. 저장 시 "Scope" 선택이 가능하다: "Global"(모든 연결) 또는 "Current Connection"(현재 연결에만). 기본값은 "Current Connection"
6. 즐겨찾기 데이터는 localStorage에 `table-view-favorites` 키로 JSON 배열 형태로 영속화된다. 구조: `[{ id, name, sql, scope: "global" | "connection", connectionId: string | null, createdAt: number }]`
7. 앱 재시작 후에도 즐겨찾기가 유지된다
8. Zustand 스토어 `useFavoritesStore`가 즐겨찾기 상태를 관리한다. 초기 로드 시 localStorage에서 읽고, 변경 시 localStorage에 저장한다 (debounce 500ms)
9. `pnpm test` 통과, `pnpm tsc --noEmit` 통과

**Components to Create/Modify**:

- 신규 스토어 `src/stores/favoritesStore.ts`: Zustand 스토어. 상태: `favorites: FavoriteEntry[]`. 액션: `addFavorite`, `removeFavorite`, `loadFavorites`
- 신규 타입 `src/types/favorite.ts`: `FavoriteEntry` 인터페이스
- 신규 컴포넌트 `src/components/FavoritesDropdown.tsx`: 즐겨찾기 목록 드롭다운. Props: `connectionId`, `onSelect`, `onDelete`, `onClose`
- 신규 컴포넌트 `src/components/SaveFavoriteDialog.tsx`: 저장 다이얼로그 (이름 입력 + scope 선택). shadcn Dialog 기반
- `src/components/QueryTab.tsx`: 툴바에 Star/Bookmark 버튼 추가, FavoritesDropdown/SaveFavoriteDialog 렌더링
- `src/components/QueryEditor.tsx`: insert-sql 이벤트 핸들러 (즐겨찾기 SQL 삽입용)

**Data Flow**:

- Save: 사용자가 Star 클릭 -> SaveFavoriteDialog에서 이름/scope 입력 -> favoritesStore.addFavorite -> localStorage에 저장
- Load: 앱 시작 시 favoritesStore.loadFavorites가 localStorage에서 읽어 초기화
- Use: Bookmark 클릭 -> FavoritesDropdown 표시 -> 항목 클릭 -> dispatch CustomEvent("insert-sql") -> QueryEditor가 SQL 교체
- Delete: FavoritesDropdown에서 삭제 아이콘 클릭 -> favoritesStore.removeFavorite -> localStorage 업데이트

---

### Sprint 58: Enhanced Query Log Panel

**Goal**: 기존 QueryLog를 탭 간 누적 로그로 강화한다. 검색, 복사, 연결별 필터, 단축키(Cmd+Shift+C)를 지원하고 에러 쿼리를 시각적으로 구분한다.

**Verification Profile**: command

**Acceptance Criteria**:

1. queryHistoryStore의 entries가 모든 탭에서 공유되는 단일 누적 로그로 동작한다 (기존 스토어는 이미 connectionId를 포함하므로 구조 변경 불필요)
2. QueryLog 패널에 검색 입력이 있다. SQL 텍스트 기준으로 대소문자 무시 필터링이 동작한다
3. QueryLog 패널에 연결별 필터 드롭다운이 있다. "All Connections" 또는 특정 연결 선택 시 해당 연결의 로그만 표시된다
4. 에러(status=error) 로그 항목이 빨간색 배경(`bg-destructive/10`)과 빨간색 SQL 텍스트로 구분되어 표시된다
5. 각 로그 항목의 SQL 텍스트를 클릭하면 해당 SQL이 현재 활성 쿼리 탭의 에디터에 삽입된다 (기존 "insert-sql" 이벤트 재사용)
6. 로그 항목에 복사 버튼이 있으며, 클릭 시 해당 SQL이 클립보드에 복사된다 (`navigator.clipboard.writeText`)
7. Cmd+Shift+C(Ctrl+Shift+C) 단축키로 QueryLog 패널 토글이 동작한다. 기존 "toggle-query-log" 이벤트와 병행하여 App.tsx에 글로벌 단축키 등록
8. QueryLog 패널 헤더에 총 로그 건수와 에러 건수가 뱃지로 표시된다 (예: "42 queries, 3 errors")
9. 각 로그 항목에 타임스탬프가 절대 시간(HH:MM:SS)과 상대 시간("3m ago")이 모두 표시된다
10. `pnpm test` 통과

**Components to Modify**:

- `src/stores/queryHistoryStore.ts`: 구조 유지 (이미 connectionId 포함). 필요시 `maxEntries` 상한(기본 1000) 추가하여 메모리 관리
- `src/components/QueryLog.tsx`: 검색 기능 강화, 연결별 필터 드롭다운 추가, 에러 하이라이트, 복사 버튼, 카운트 뱃지, 타임스탬프 개선
- `src/App.tsx`: Cmd+Shift+C 글로벌 키보드 단축키 등록, "toggle-query-log" 커스텀 이벤트 디스패치

**Data Flow**:

- 로그 추가: 쿼리 실행 시 queryHistoryStore.addHistoryEntry가 호출되며 connectionId, sql, duration, status, executedAt 포함
- 필터링: QueryLog 컴포넌트에서 search 키워드 + selectedConnectionId로 entries.filter 적용
- 복사: navigator.clipboard.writeText(entry.sql)
- SQL 삽입: dispatchEvent(new CustomEvent("insert-sql", { detail: { sql } }))

---

### Sprint 59: Connection Tags & Colors

**Goal**: 연결에 환경 태그(Local/Testing/Development/Staging/Production)와 색상 라벨을 지정할 수 있게 한다. 사이드바에서 시각적으로 표시하고 태그/색상으로 필터링한다.

**Verification Profile**: command

**Acceptance Criteria**:

1. ConnectionConfig(Rust, TypeScript)에 `environment` 필드가 추가된다: `Option<String>` (Rust) / `string | null` (TypeScript). 허용값: "local", "testing", "development", "staging", "production"
2. ConnectionDialog 편집 화면에 Environment 선택 드롭다운이 추가된다. 선택지: None, Local, Testing, Development, Staging, Production
3. 기존 `color` 필드가 색상 선택기(Color Picker)로 시각화된다. 선택지: Red(#ef4444), Orange(#f97316), Yellow(#eab308), Green(#22c55e), Blue(#3b82f6), Purple(#a855f7), None
4. 사이드바의 각 연결 항목에 환경 태그 뱃지와 색상 점이 표시된다
5. 환경 태그 뱃지는 태그별 고유 색상을 갖는다: Local=slate, Testing=amber, Development=blue, Staging=purple, Production=red
6. 사이드바 상단에 환경 태그 필터 버튼 그룹이 있다. 클릭 시 해당 환경의 연결만 표시된다. "All" 버튼으로 전체 표시 복원
7. 기존 연결 데이터에 `environment` 필드가 없는 경우 null로 역직렬화되어 하위 호환이 유지된다 (Rust `#[serde(default)]` + TypeScript `string | null`)
8. `cargo test` 통과, `pnpm test` 통과, `pnpm tsc --noEmit` 통과

**Components to Modify**:

- `src-tauri/src/models/connection.rs`: `ConnectionConfig`에 `environment: Option<String>` 필드 추가, `#[serde(default)]` 적용
- `src/types/connection.ts`: `ConnectionConfig`에 `environment?: string | null` 필드 추가, `createEmptyConnection` 업데이트
- `src/components/ConnectionDialog.tsx`: Environment 드롭다운 추가, Color 선택기 시각화
- `src/components/Sidebar.tsx`: 연결 항목에 환경 뱃지 + 색상 점 렌더링, 필터 버튼 그룹 추가
- `src/components/ConnectionItem.tsx`: 환경 뱃지 + 색상 점 표시 추가
- `src/stores/connectionStore.ts`: 태그 필터 상태 `environmentFilter: string | null` 및 `setEnvironmentFilter` 액션 추가

**Data Flow**:

- 저장: ConnectionDialog에서 environment/color 선택 -> saveConnection Tauri command -> AES-256-GCM 암호화 JSON에 environment 필드 포함
- 로드: loadConnections 시 기존 데이터는 environment=null로 역직렬화
- 필터: Sidebar에서 environmentFilter 상태에 따라 connections.filter 적용
- 표시: ConnectionItem이 connection.environment와 connection.color를 읽어 뱃지/점 렌더링

---

### Sprint 60: Polish & Integration Testing

**Goal**: Sprint 55-59에서 구현한 6개 기능의 통합 테스트, 에지 케이스 처리, 일관성 검증을 수행한다.

**Verification Profile**: mixed

**Acceptance Criteria**:

1. 전체 기능이 다크/라이트 모드에서 일관되게 렌더링된다
2. Views/Functions/Procedures가 없는 빈 스키마에서 "No views"/"No functions"/"No procedures" 플레이스홀더가 정상 표시된다
3. Quick Look 패널이 0개 컬럼, NULL 전체 행, 초대용량 JSON(1MB+) 등의 에지 케이스에서 에러 없이 동작한다
4. Query Favorites가 localStorage 용량 초과(5MB) 시 경고 없이 가능한 한 많이 저장하며, 복구 시 손상된 JSON을 무시한다
5. Enhanced Query Log가 1000개 이상의 엔트리에서 성능 저하 없이 동작한다 (가상 스크롤 또는 윈도잉 필요시 적용)
6. Connection Tags가 없는 기존 연결에서 업그레이드 후에도 정상 동작한다
7. `pnpm test` -- 전체 테스트 통과
8. `pnpm tsc --noEmit` -- 타입 에러 0건
9. `pnpm lint` -- ESLint 에러 0건
10. `pnpm build` -- 프로덕션 빌드 성공
11. `cargo clippy --all-targets --all-features -- -D warnings` 통과
12. `cargo test` 통과

**Components to Modify**:

- Sprint 55-59에서 구현한 모든 컴포넌트의 에지 케이스 처리 보강
- 신규 테스트 파일: 각 스프린트 기능에 대한 통합 시나리오 테스트
- `src/components/SchemaTree.tsx`: 대량 functions/procedures 스크롤 성능 확인
- `src/components/datagrid/QuickLookPanel.tsx`: 에지 케이스 방어 로직

---

## Global Acceptance Criteria

1. `pnpm test` -- 기존 테스트 전부 통과 + 신규 테스트 통과
2. `pnpm tsc --noEmit` -- 타입 에러 0건
3. `pnpm lint` -- ESLint 에러 0건
4. `pnpm build` -- 프로덕션 빌드 성공
5. `cargo clippy --all-targets --all-features -- -D warnings` -- Rust 린트 통과
6. `cargo test` (src-tauri/) -- 백엔드 테스트 통과
7. 다크/라이트 테마에서 모든 새 UI가 정상 표시
8. 기존 사용자 워크플로우(연결 -> 탐색 -> 조회 -> 편집 -> 쿼리)가 단절 없이 동작

## Data Flow (Cross-Feature)

```
SchemaTree
  |-- Views 카테고리 클릭 --> loadViews() --> list_views Tauri command --> pg_views
  |-- Functions 카테고리 클릭 --> loadFunctions() --> list_functions Tauri command --> pg_proc
  |-- 뷰 클릭 --> addTab(type="table") --> query_table_data --> DataGrid + QuickLookPanel
  |-- 함수 클릭 --> addQueryTab() --> get_function_source --> QueryEditor

QueryTab
  |-- Star 버튼 --> SaveFavoriteDialog --> favoritesStore --> localStorage
  |-- Bookmark 버튼 --> FavoritesDropdown --> insert-sql 이벤트 --> QueryEditor
  |-- 쿼리 실행 --> queryHistoryStore.addHistoryEntry --> QueryLog 패널

Sidebar
  |-- 환경 필터 버튼 --> connectionStore.setEnvironmentFilter --> connections.filter
  |-- 연결 색상 점 --> ConnectionConfig.color --> 색상 인디케이터

QueryLog (Cmd+Shift+C)
  |-- 검색 --> entries.filter(sql.includes)
  |-- 연결 필터 --> entries.filter(connectionId)
  |-- 항목 클릭 --> insert-sql 이벤트 --> QueryEditor
  |-- 복사 버튼 --> navigator.clipboard.writeText
```

## Edge Cases

- **뷰가 없는 스키마**: "No views" 플레이스홀더 유지
- **함수 소스가 없는 경우** (C 확장 함수 등): `prosrc`가 빈 문자열이면 "Source code not available" 표시
- **뷰 데이터 탐색 시 편집**: 뷰는 읽기 전용이므로 DataGrid의 인라인 편집, 행 추가/삭제 버튼이 비활성화되어야 함
- **Quick Look + 0행 결과**: DataGrid에 데이터가 없으면 Quick Look 패널이 표시되지 않음
- **Quick Look + NULL 전체 행**: 모든 필드가 NULL인 경우 "NULL" 텍스트가 각 필드에 표시됨
- **Quick Look + 대용량 JSON**: 1MB 이상의 JSON 값은 포맷팅하지 않고 원시 텍스트로 표시 (성능 보호)
- **즐겨찾기 localStorage 용량 초과**: try/catch로 JSON.stringify 실패 시 기존 데이터 유지하고 콘솔 경고
- **즐겨찾기 손상된 JSON 복구**: JSON.parse 실패 시 빈 배열로 초기화
- **쿼리 로그 1000개 상한**: 오래된 항목부터 자동 삭제 (FIFO)
- **쿼리 로그 + 탭 전환**: 로그는 전역 상태이므로 탭 전환에 영향받지 않음
- **연결 태그 + 기존 데이터**: environment 필드가 없는 기존 연결은 null로 처리되어 UI에 뱃지 미표시
- **Functions/Procedures + 권한 없는 스키마**: pg_proc 조회 권한이 없는 경우 빈 배열 반환, 에러 표시하지 않음
- **뷰 정의 SQL이 매우 긴 경우** (수천 줄): 쿼리 에디터에 삽입 시 CodeMirror 성능 저하 없음

## Visual Direction

- **SchemaTree 카테고리 아이콘**: 기존 유지 (Tables=LayoutGrid, Views=Eye, Functions=Code2, Procedures=Terminal)
- **뷰 항목 아이콘**: Eye 아이콘 (테이블의 Table2와 구분)
- **함수/프로시저 항목 아이콘**: Code2/Terminal 아이콘, 클릭 시 쿼리 탭 열림
- **Quick Look 패널**: DataGrid 하단, `border-t border-border bg-secondary`, 컬럼명 좌측 고정 폭, 값 우측 가변 폭
- **Quick Look JSON**: 구문 강조는 기본 텍스트 컬러 (키=퍼플, 문자열=그린, 숫자=오렌지)
- **Quick Look BLOB**: 기존 BlobViewerDialog 스타일 재사용
- **즐겨찾기 드롭다운**: 기존 컨텍스트 메뉴 스타일(`bg-secondary`, `border-border`, `shadow-lg`)
- **즐겨찾기 저장 다이얼로그**: shadcn Dialog, 이름 Input + Scope Select
- **쿼리 로그 에러 행**: `bg-destructive/10` 배경, `text-destructive` SQL 텍스트
- **쿼리 로그 카운트 뱃지**: `bg-muted rounded-full px-2 py-0.5 text-xs`
- **연결 환경 뱃지**: `rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide`
- **환경 뱃지 색상**: Local=slate, Testing=amber, Development=blue, Staging=purple, Production=red (배경은 `bg-{color}-500/15 text-{color}-600 dark:text-{color}-400`)
- **연결 색상 점**: 기존 8px 원형 인디케이터 스타일 유지, Color Picker는 6색 원형 팔레트

## Verification Hints

- `pnpm vitest run` -- 프론트엔드 단위 테스트
- `pnpm tsc --noEmit` -- 타입 체크
- `pnpm lint` -- ESLint 검사
- `pnpm build` -- 프로덕션 빌드
- `cargo test` (src-tauri/) -- 백엔드 테스트
- `cargo clippy --all-targets --all-features -- -D warnings` (src-tauri/) -- Rust 린트
- `pnpm tauri dev` -- 수동 검증 (Views/Functions 탐색, Quick Look, 즐겨찾기, 쿼리 로그, 연결 태그)
- `docker compose up -d` -- PostgreSQL 테스트 DB (뷰/함수/프로시저 포함)
