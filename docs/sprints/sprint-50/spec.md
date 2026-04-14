# Feature Spec: Phase 4 Remaining -- DataGrid Editing Completion & Query Polish

## Description
8개의 남은 Phase 4 기능을 구현하여 데이터 그리드 편집 경험을 완성하고 쿼리 에디터의 편의성을 높인다. 다중 행 선택을 기반으로 행 컨텍스트 메뉴, 행 복사, 행 복제 기능이 동작하며, 컬럼 드래그 재정렬과 BLOB 뷰어로 데이터 탐색 능력을 확장한다. 쿼리 에디터에서는 SQL Uglify와 선택 영역 포맷팅으로 편집 효율을 높이고, 스키마 트리에 계층별 아이콘과 선택 하이라이트로 시각적 명확성을 제공한다.

## Sprint Breakdown

### Sprint 50: Multi-row Selection Foundation
**Goal**: DataGrid의 단일 행 선택(`selectedRowIdx: number | null`)을 다중 행 선택으로 확장한다. 이는 후속 스프린트의 행 컨텍스트 메뉴, 행 복사, 행 복제 기능의 기반이 된다.
**Verification Profile**: command
**Acceptance Criteria**:
1. 행을 클릭하면 해당 행만 선택된다(기존 동작 유지)
2. Cmd/Ctrl 키를 누른 상태로 클릭하면 개별 행이 선택 토글된다 -- 이미 선택된 행은 해제, 미선택 행은 추가
3. Shift 키를 누른 상태로 클릭하면 마지막으로 클릭한 행(anchor row)부터 현재 클릭한 행까지 범위 선택된다
4. 선택된 모든 행에 시각적 하이라이트 배경색이 적용된다
5. 선택 상태는 `Set<number>`(또는 동등한 자료구조)로 관리되며, 기존 `selectedRowIdx` 기반 기능(행 삭제 등)이 다중 선택에서도 정상 동작한다 -- Delete Row 버튼으로 선택된 모든 행이 일괄 삭제 대상이 된다
6. `pnpm test` 통과, `pnpm tsc --noEmit` 통과
**Components to Modify**:
- `src/components/datagrid/useDataGridEdit.ts`: `selectedRowIdx`를 다중 선택 상태로 확장, anchor row 개념 추가
- `src/components/datagrid/DataGridTable.tsx`: 행 클릭 이벤트에 Shift/Cmd 키 감지 로직 추가, 다중 선택 시각화
- `src/components/datagrid/DataGridToolbar.tsx`: Delete Row 버튼이 다중 선택 행 수를 반영하여 비활성화/활성화
- `src/components/DataGrid.tsx`: editState 확장 인터페이스 반영

### Sprint 51: Row Context Menu & Copy Formats
**Goal**: DataGrid 행에 우클릭 컨텍스트 메뉴를 추가하고, 선택된 행을 다양한 포맷(Plain Text, JSON, CSV, SQL Insert)으로 클립보드에 복사한다.
**Verification Profile**: command
**Acceptance Criteria**:
1. 데이터 행에서 우클릭하면 컨텍스트 메뉴가 해당 행 위치에 나타난다
2. 컨텍스트 메뉴 항목: Edit Cell(해당 셀 편집 모드 진입), Delete Row(선택 행 삭제), Duplicate Row, Copy Row As(서브메뉴: Plain Text, JSON, CSV, SQL Insert)
3. "Copy Row As > Plain Text" 선택 시 행 데이터가 탭 구분 텍스트로 클립보드에 복사된다(컬럼명 헤더 포함)
4. "Copy Row As > JSON" 선택 시 행 데이터가 JSON 객체 배열(`[{column: value, ...}]`)로 클립보드에 복사된다
5. "Copy Row As > CSV" 선택 시 행 데이터가 콤마 구분(CSV) 텍스트로 클립보드에 복사된다(필드에 콤마/따옴표 포함 시 올바르게 이스케이프)
6. "Copy Row As > SQL Insert" 선택 시 행 데이터가 `INSERT INTO schema.table (columns) VALUES (values);` 구문으로 클립보드에 복사된다
7. 다중 행 선택 상태에서 복사 시 선택된 모든 행이 복사된다
8. 컨텍스트 메뉴 외부 클릭 또는 Escape 키로 메뉴가 닫힌다
9. `pnpm test` 통과
**Components to Modify**:
- `src/components/datagrid/DataGridTable.tsx`: 행 `onContextMenu` 핸들러 추가, ContextMenu 렌더링
- `src/components/ContextMenu.tsx`: 서브메뉴 지원(선택적, 또는 평면 리스트로 Copy Row As 항목 4개 나열)
- `src/components/datagrid/useDataGridEdit.ts`: 복사 유틸리티 함수 추가(클립보드 API 사용)
- `src/lib/format.ts` 또는 신규 유틸: `rowsToPlainText`, `rowsToJson`, `rowsToCsv`, `rowsToSqlInsert` 함수

### Sprint 52: Duplicate Row & Column Drag Reorder
**Goal**: Duplicate Row 기능으로 선택된 행을 복제하여 INSERT 대기 행으로 추가한다. 컬럼 헤더를 드래그하여 컬럼 순서를 시각적으로 재정렬한다.
**Verification Profile**: command
**Acceptance Criteria**:
1. 컨텍스트 메뉴에서 "Duplicate Row" 선택 시 해당 행의 데이터로 새 행이 `pendingNewRows`에 추가된다
2. 복제된 행은 편집 대기 상태로 DataGrid 하단에 표시된다(기존 new row와 동일한 노란색 배경)
3. 복제된 행은 커밋 전까지 실제 DB에 반영되지 않으며, SQL Preview에 INSERT 구문으로 나타난다
4. 컬럼 헤더를 마우스로 드래그하면 컬럼 순서가 시각적으로 재정렬된다
5. 재정렬은 현재 DataGrid 뷰에만 적용되며, 실제 DB 스키마는 변경되지 않는다
6. 재정렬된 컬럼 순서는 정렬, 필터, 인라인 편집과 호환된다 -- 편집 시 올바른 컬럼에 UPDATE가 적용된다
7. 페이지 전환 또는 새로고침 시 컬럼 순서가 기본(스키마 순서)으로 초기화된다
8. `pnpm test` 통과
**Components to Modify**:
- `src/components/datagrid/useDataGridEdit.ts`: `handleDuplicateRow` 액션 추가
- `src/components/datagrid/DataGridTable.tsx`: 컬럼 드래그 앤 드롭 이벤트 핸들러 추가, `columnOrder` 상태 관리
- `src/components/datagrid/DataGridToolbar.tsx`: Duplicate Row 버튼 추가(선택적)
- `src/components/DataGrid.tsx`: columnOrder 상태 조율

### Sprint 53: BLOB Viewer & SQL Uglify & Format Selection
**Goal**: BLOB/바이너리 컬럼 데이터를 확인 가능하게 하고, 쿼리 에디터에 SQL Uglify(Cmd+Shift+I)와 선택 영역 포맷팅 기능을 추가한다.
**Verification Profile**: command
**Acceptance Criteria**:
1. BLOB/binary/bytea 데이터 타입 컬럼의 셀에 바이너리 아이콘 표시기가 나타나며, 셀 텍스트로는 `(BLOB)` 또는 `(binary data)`가 표시된다
2. BLOB 셀을 클릭하면 모달 다이얼로그가 열려 hex dump 뷰와 text 뷰를 전환하여 데이터를 확인할 수 있다
3. hex dump 뷰에서는 오프셋, hex 바이트, ASCII 문자 3열 형식으로 표시된다
4. text 뷰에서는 UTF-8 디코딩된 텍스트가 표시된다(디코딩 불가 시 hex fallback)
5. 쿼리 에디터에서 Cmd+Shift+I를 누르면 현재 SQL이 단일 행으로 압축된다(불필요한 공백/줄바꿈 제거, 키워드는 대문자 유지)
6. 쿼리 에디터에서 텍스트가 선택된 상태로 Cmd+I를 누르면 선택된 텍스트만 포매팅된다
7. 텍스트가 선택되지 않은 상태에서 Cmd+I를 누르면 기존과 동일하게 전체 SQL이 포매팅된다
8. `pnpm test` 통과
**Components to Modify**:
- `src/components/datagrid/DataGridTable.tsx`: BLOB 컬럼 감지 및 아이콘 표시, 클릭 핸들러
- 신규 컴포넌트 `src/components/datagrid/BlobViewerDialog.tsx`: BLOB 내용 표시 모달(hex/text 탭)
- `src/lib/sqlUtils.ts`: `uglifySql` 함수 추가, `formatSql`에 선택 영역 지원 추가
- `src/components/QueryTab.tsx`: Cmd+Shift+I 이벤트 리스너, 선택 영역 감지 로직
- `src/App.tsx`: Cmd+Shift+I 글로벌 단축키 등록

### Sprint 54: Schema Tree Visual Polish
**Goal**: 스키마 트리에 계층별 고유 아이콘을 적용하고, 현재 선택 노드를 명확히 하이라이트하여 시각적 탐색성을 높인다.
**Verification Profile**: command
**Acceptance Criteria**:
1. 연결(Connection) 노드에 데이터베이스 서버 타입에 따른 고유 아이콘이 표시된다(예: PostgreSQL은 코끼리 아이콘, MySQL은 돌고래 아이콘 -- 구 불가 시 Database 아이콘을 색상으로 구분)
2. 스키마(Schema) 노드에 기존 FolderOpen 아이콘 대신 스키마용 고유 아이콘이 표시된다
3. 카테고리(Tables, Views, Functions, Procedures)별로 서로 다른 아이콘이 표시된다 -- 기존 구현에서 LayoutGrid, Eye, Code2를 이미 사용하므로 시각적 명확성 추가 검증
4. 테이블(Table) 노드에 테이블 타입(일반 테이블, 뷰)에 따른 아이콘 구분이 적용된다
5. 현재 활성 탭과 연결된 테이블 노드가 스키마 트리에서 하이라이트된다 -- 해당 테이블이 속한 스키마가 자동으로 확장되어 있어야 한다
6. 선택된 노드의 하이라이트가 뚜렷하게 구분된다(배경색 + 텍스트 강조)
7. `pnpm test` 통과, `pnpm tsc --noEmit` 통과
**Components to Modify**:
- `src/components/SchemaTree.tsx`: 노드별 아이콘 매핑, 활성 탭 기반 하이라이트 로직, 자동 확장
- `src/stores/tabStore.ts`: 활성 탭의 schema/table 정보 접근성 확인(이미 가능한지 검증)

## Global Acceptance Criteria
1. `pnpm test` -- 기존 테스트 전부 통과 + 신규 테스트 통과
2. `pnpm tsc --noEmit` -- 타입 에러 0건
3. `pnpm lint` -- ESLint 에러 0건
4. `pnpm build` -- 프로덕션 빌드 성공
5. 다크/라이트 테마에서 모든 새 UI가 정상 표시
6. 기존 단일 행 선택, 행 삭제, 인라인 편집, 정렬, 필터 워크플로우가 단절 없이 동작

## Data Flow
- **다중 행 선택**: DataGridTable의 클릭 이벤트에서 Shift/Cmd 키 상태를 감지하여 useDataGridEdit의 선택 상태 업데이트
- **행 복사**: 선택된 행 데이터를 DataGridTable에서 읽어 포맷 변환 후 `navigator.clipboard.writeText()`로 클립보드에 기록
- **행 복제**: 선택된 행의 원본 데이터를 읽어 `pendingNewRows`에 새 배열로 추가, sqlGenerator가 INSERT 구문 생성
- **컬럼 재정렬**: DataGridTable의 로컬 상태로 columnOrder 배열 유지, 렌더링 시 컬럼을 해당 순서로 재배열
- **BLOB 뷰어**: 셀 클릭 시 바이너리 데이터를 BlobViewerDialog에 전달, hex/text 변환은 프론트엔드에서 수행
- **SQL Uglify**: sqlUtils의 `uglifySql`이 줄바꿈/다중 공백을 단일 공백으로 압축, 키워드 대문자 유지
- **선택 영역 포맷**: CodeMirror의 selection 범위를 QueryTab에서 읽어 해당 범위만 formatSql 적용 후 치환
- **스키마 트리 하이라이트**: tabStore의 activeTab에서 schema/table을 읽어 SchemaTree의 해당 노드에 추가 하이라이트 클래스 적용

## Edge Cases
- 빈 데이터(0행)에서 우클릭 시 컨텍스트 메뉴가 나타나지 않음
- pendingNewRows(새 행)에서 우클릭 시 "Delete Row"는 가능하지만 "Duplicate Row"는 의미 없으므로 비활성화
- BLOB 데이터가 null인 경우 뷰어를 열지 않고 기존 NULL 표시 유지
- BLOB 데이터가 매우 큰 경우(수 MB) 뷰어에서 가상 스크롤 또는 페이지 단위 표시 필요
- SQL Uglify 시 문자열 리터럴 내부의 공백은 보존되어야 함
- 선택 영역 포맷 시 선택 범위가 불완전한 SQL(예: 키워드 중간)인 경우에도 최선의 포매팅 시도
- Shift+Click 범위 선택에서 anchor 행이 없는 초기 상태에서는 일반 클릭으로 동작
- 컬럼 드래그 중 정렬 핸들러 영역에서 드래그가 시작되면 정렬이 아닌 드래그가 우선되어야 함
- 다중 행 선택 상태에서 페이지를 전환하면 선택 상태가 초기화되어야 함
- 스키마 트리에서 활성 탭의 테이블이 뷰(View) 카테고리에 속한 경우 해당 카테고리에서도 하이라이트 동작

## Visual Direction
- 다중 선택 행: `bg-accent/20` 또는 `bg-primary/10` 배경색 (기존 단일 선택과 동일한 색상)
- 컨텍스트 메뉴: 기존 SchemaTree 컨텍스트 메뉴와 동일한 스타일(`bg-secondary`, `border-border`, `shadow-lg`)
- BLOB 셀 표시: 작은 binary/package 아이콘 + `(BLOB)` 텍스트, 클릭 가능한 커서 표시
- BLOB 뷰어 모달: Hex/Text 탭 전환, shadcn Dialog 기반, 최대 80vh 높이
- 컬럼 드래그: 드래그 중인 컬럼 헤더에 `opacity-50` 효과, 드롭 위치에 수직선 인디케이터
- SQL Uglify 결과: 전체 SQL이 단일 행으로 압축되어 에디터에 반영
- 스키마 트리 활성 탭 하이라이트: 기존 `bg-primary/10 text-primary` 스타일에 `font-semibold` 추가로 명확성 강화

## Verification Hints
- `pnpm vitest run` -- 프론트엔드 단위 테스트
- `pnpm tsc --noEmit` -- 타입 체크
- `pnpm lint` -- ESLint 검사
- `pnpm build` -- 프로덕션 빌드
- `cargo test` (src-tauri/) -- 백엔드 테스트 (BLOB 관련 Rust 변경 없음 확인)
- `pnpm tauri dev` -- 수동 검증 (다중 선택, 우클릭, 컬럼 드래그, BLOB 뷰어, SQL Uglify, 스키마 트리)
