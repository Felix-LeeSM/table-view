# Feature Spec: UX Polish & Bug Fixes Batch

## Description
사용자 피드백 기반 13개 항목의 버그 수정 및 UX 개선. 쿼리 에디터 핵심 버그 수정, 사이드바 개선, 임시 탭 시스템 고도화, 데이터 그리드 UX 개선, 단축키 추가를 포함.

## Sprint Breakdown

### Sprint 41: Query Editor Core Fixes
**Goal**: 쿼리 에디터의 핵심 동작 버그 3건 수정
**Verification Profile**: command
**Acceptance Criteria**:
1. 빈 쿼리 또는 whitespace-only 쿼리 실행 시 "null row"가 표시되지 않고, 쿼리가 실행되지 않거나 빈 결과가 정상적으로 표시됨
2. QueryEditor CodeMirror에서 Cmd+Enter 누르면 줄바꿈이 발생하지 않고 쿼리가 실행됨
3. 자동완성 팝업이 활성 상태일 때 Tab 키를 누르면 들여쓰기가 아닌 자동완성 선택이 동작함
**Components to Modify**:
- `src/components/QueryEditor.tsx`: keymap 우선순위 수정 (Tab → autocomplete accept)
- `src/components/QueryTab.tsx`: 빈 쿼리 실행 방지 가드
- `src-tauri/src/db/postgres.rs`: execute_query에서 빈 결과 처리 확인

### Sprint 42: Schema Tree & Sidebar Fixes
**Goal**: SchemaTree의 UUID 노출 문제와 테이블 검색 버그 수정
**Verification Profile**: mixed
**Acceptance Criteria**:
1. SchemaTree 헤더에 connectionId(UUID) 대신 연결 이름이 표시됨
2. SchemaTree의 "New Query" 버튼이 여전히 정상 동작함
3. 테이블 검색(Filter tables...) 입력이 정상적으로 테이블을 필터링함
4. 검색 결과가 없을 때 "No matching tables" 메시지가 표시됨
**Components to Modify**:
- `src/components/SchemaTree.tsx`: connectionId → 연결 이름 표시, 테이블 검색 버그 수정
- `src/stores/connectionStore.ts` 또는 props: 연결 이름 접근 방식

### Sprint 43: Preview Tab System Overhaul
**Goal**: 임시 탭 시스템을 사용자 기대에 맞게 재구현
**Verification Profile**: mixed
**Acceptance Criteria**:
1. 테이블 클릭 시 임시 탭(preview tab)으로 열림 — 탭 제목이 이탤릭체 + 흐림으로 시각 구분
2. 임시 탭에서 스크롤만 하는 경우(데이터 열람) 다른 테이블 클릭 시 기존 임시 탭이 교체됨
3. 다음 상호작용 발생 시 임시 탭이 정식 탭으로 자동 승격됨:
   - 정렬(컬럼 헤더 클릭)
   - 필터 적용/해제
   - 페이지 변경
   - 셀 더블클릭(인라인 편집 진입)
   - 행 추가/삭제 버튼 클릭
4. 탭 바에서 임시 탭을 더블클릭하면 수동으로 정식 탭으로 승격됨
5. 정식 탭은 다른 테이블 클릭 시 유지되며, 새 임시 탭이 추가로 열림
6. 이미 열린 테이블을 다시 클릭하면 해당 탭이 활성화됨(새 탭 생성 안 함)
**Components to Modify**:
- `src/stores/tabStore.ts`: promoteTab 트리거 로직, addTab 교체 로직 점검
- `src/components/DataGrid.tsx`: promoteTab 호출 시점 확장
- `src/components/TabBar.tsx`: 더블클릭 → promoteTab 연결
- `src/components/SchemaTree.tsx`: 테이블 클릭 시 addTab 동작 확인

### Sprint 44: Data Grid UX Improvements
**Goal**: 데이터 그리드의 가독성과 사용성 개선
**Verification Profile**: mixed
**Acceptance Criteria**:
1. JSONB, text 등 대용량 값이 셀에 200자(또는 적절한 길이)로 잘려서 표시되며, 잘린 경우 "..." 표시
2. 컬럼 헤더의 데이터 타입 표시가 길어도 줄바꿈이 발생하지 않음 (적절히 잘리거나 툴팁 제공)
3. 컬럼 너비가 콘텐츠에 맞게 스마트하게 초기 설정됨 (컬럼명/데이터 기반 추론)
4. 날짜/시간 컬럼 인라인 편집 시 date input 또는 datetime-local input이 제공됨 (plain text 아님)
5. 셀에 잘린 전체 값은 hover 시 tooltip으로 확인 가능
**Components to Modify**:
- `src/components/DataGrid.tsx`: 셀 렌더링 truncation, 컬럼 너비 스마트 계산, 날짜 편집 input
- `src/components/QueryResultGrid.tsx`: 동일한 truncation 로직 적용

### Sprint 45: Shortcuts & Toolbar Polish
**Goal**: 단축키 추가 및 툴바 UX 개선
**Verification Profile**: mixed
**Acceptance Criteria**:
1. QueryTab 툴바에 SQL 포맷 버튼(✨ 또는 {} 아이콘)이 표시되며, 클릭 시 Cmd+I와 동일하게 동작함
2. Cmd+Shift+T 입력 시 마지막으로 닫은 탭이 다시 열림
3. 탭의 연결 색상 점에 hover 시 연결 이름이 tooltip으로 표시됨
4. 기존 Cmd+I 포맷 단축키가 여전히 정상 동작함
**Components to Modify**:
- `src/components/QueryTab.tsx`: 툴바에 포맷 버튼 추가
- `src/App.tsx`: Cmd+Shift+T 단축키 등록
- `src/stores/tabStore.ts`: closedTabsHistory 스택 추가, reopenLastClosedTab 액션
- `src/components/TabBar.tsx`: 색상 점 tooltip 추가

## Global Acceptance Criteria
1. `pnpm test` — 기존 577개 테스트 모두 통과 + 신규 테스트 통과
2. `pnpm tsc --noEmit` — 타입 에러 0건
3. `pnpm lint` — ESLint 에러 0건
4. `cargo clippy` + `cargo test` (src-tauri/) — Rust 테스트 통과
5. 다크/라이트 테마에서 모든 UI 변경이 정상 표시

## Data Flow
- **Tab promotion**: DataGrid/FilterBar/StructurePanel → tabStore.promoteTab(tabId) → isPreview=false
- **Tab reopen**: TabBar close → tabStore pushes to closedTabHistory → Cmd+Shift+T → tabStore.pop + addTab
- **Connection name**: SchemaTree props에 connectionId + connectionName 전달 필요 (connectionStore에서 조회)
- **Smart column width**: DataGrid 초기 렌더 시 columns + 첫 페이지 rows 데이터로 너비 추론

## Edge Cases
- 빈 쿼리(whitespace only) 실행 시 아무 동작 안 함 또는 에러 표시
- 자동완성 팝업 비활성 상태에서 Tab은 들여쓰기로 동작 (기존 동작 유지)
- 임시 탭이 정식으로 승격된 후 다시 임시로 돌아가지 않음
- Cmd+Shift+T로 재생성된 탭은 정식 탭(isPreview=false)으로 열림
- JSONB 값이 null인 경우 truncation 적용 안 함 (NULL 표시 유지)
- 컬럼이 1개뿐인 테이블도 스마트 너비 정상 동작
- 날짜 컬럼에 NULL 값이 있는 경우 편집 input 미표시

## Visual Direction
- 임시 탭 구분: italic + opacity-70 유지, 승격 시 normal 스타일로 전환
- 포맷 버튼: 툴바 Run 버튼 옆에 배치, 💡 또는 {} 아이콘
- 셀 truncation: 잘린 텍스트 끝에 "..." 표시, 셀에 `overflow-hidden text-ellipsis` 적용
- 컬럼 헤더: 데이터 타입이 너무 길면 `truncate` 클래스로 줄임표 처리, hover 시 전체 타입명 tooltip

## Verification Hints
- `pnpm vitest run` — 프론트엔드 테스트
- `pnpm tsc --noEmit` — 타입 체크
- `cargo test` (src-tauri/) — 백엔드 테스트
- `pnpm tauri dev` — 수동 검증 (쿼리 에디터, 탭, 데이터 그리드)
