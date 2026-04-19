# Sprint 60 Plan: UX P0 Fixes + Connection/Schema 분리

> **목표**: TablePlus 베테랑 페르소나 UX 평가에서 도출된 P0/P1 결함을 모두 해소하고, Connection과 Schema 트리의 시각적 계층을 재정비한다.
>
> **판단 기준** (PLAN.md): "TablePlus 사용자가 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)에서 끊김 없이 전환 가능한가?"

## 배경

스프린트 59까지의 평가 결과:
- 단축키 dispatch는 `App.tsx`에 있으나 listener가 누락된 패턴이 다수 발견됨 (Cmd+N, Cmd+S, Cmd+P).
- 인라인 편집의 셀 단위 키보드 이동(Tab/Enter)이 없어 50건 수정 같은 일상 워크플로우가 마우스 의존적.
- 자동완성에 컬럼 후보가 빠져 있어 SQL 작성 마찰.
- Connection 항목과 Schema/Table 노드가 같은 사이드바에 같은 레벨로 보여 시각적 계층이 흐림.

## 작업 단위 (순차 진행)

각 작업은 독립적으로 커밋/푸시한다. 가장 작고 안전한 작업부터 시작해 패턴을 잡고 점진적으로 큰 변경으로 진행한다.

### S60-1. P0-3 — Cmd+N 새 연결 listener (30분)

**문제**: `App.tsx:97`에서 `new-connection` 이벤트를 dispatch하지만 `Sidebar.tsx`가 구독하지 않아 단축키가 무동작.

**DOD**:
- [ ] Sidebar에서 `new-connection` window 이벤트를 구독하고 ConnectionDialog를 연다
- [ ] 단위 테스트: 이벤트 dispatch → 다이얼로그 열림 검증
- [ ] 이미 다이얼로그가 열린 상태에서 중복 dispatch 시 idempotent

### S60-2. P0-2 — Cmd+S commit listener (30분)

**문제**: `App.tsx:98`이 `commit-changes`를 dispatch하지만 DataGrid에 listener가 없어 인라인 편집의 표준 종결 단축키가 무동작.

**DOD**:
- [ ] `useDataGridEdit` 또는 DataGrid에서 `commit-changes` 이벤트 구독, pendingEdits가 있을 때만 SQL Preview 모달을 연다
- [ ] pendingEdits가 비어 있으면 noop (조용히 무시)
- [ ] 단위 테스트: 이벤트 dispatch + pending → 모달 열림 / pending 없음 → noop
- [ ] SQL Preview 모달에서 Enter로 Execute, Esc로 Cancel

### S60-3. P0-1 — Cmd+P QuickOpen 데이터 주입 (1-2시간)

**문제**: `App.tsx:99`의 dispatch에 `detail`이 없어 `QuickOpen`이 항상 `tables: []`로 시작. 빈 패널만 보임.

**DOD**:
- [ ] QuickOpen이 `useSchemaStore`/`useConnectionStore`를 직접 구독해 모든 활성 connection의 tables/views/functions/schemas를 모음
- [ ] 항목 타입(Table/View/Function/Schema)을 시각적으로 구분 (아이콘 + 라벨)
- [ ] 검색은 connection 이름까지 매칭 (`prod.users`, `analytics.orders`)
- [ ] 항목 선택 시 해당 connection의 적절한 탭 열림 (table → records, view → records, function → query, schema → expand)
- [ ] App의 dispatch는 단순 `open` 신호로만 사용
- [ ] 컴포넌트 테스트: 다중 connection, 빈 결과, 키보드 ↑/↓/Enter 동작

### S60-4. P0-4 — 인라인 편집 Tab/Enter 셀 이동 (2-3시간)

**문제**: `DataGridTable.tsx:519-527`의 input keydown이 Enter(저장+종료)/Esc(취소)만 처리. Tab/Shift+Tab/Enter로 다음 셀로 자동 이동이 안 됨.

**DOD**:
- [ ] Tab: 현재 셀 저장 → 같은 행의 다음 편집 가능 컬럼으로 이동 (편집 모드 유지)
- [ ] Shift+Tab: 저장 → 이전 편집 가능 컬럼
- [ ] Enter: 저장 → 같은 컬럼의 다음 행 (편집 모드 유지)
- [ ] Shift+Enter: 저장 → 같은 컬럼의 이전 행
- [ ] 마지막 셀에서 Tab → 다음 행 첫 컬럼으로 wrap (또는 정지, 결정 필요 — 표준은 wrap)
- [ ] PK/FK가 read-only인 경우 자동 스킵
- [ ] 단위 테스트: 4가지 키 모두, 경계(첫/끝 셀), read-only 스킵

### S60-5. P1-2 — 자동완성 컬럼 후보 (1-2시간)

**문제**: `QueryTab.tsx:38`이 `useSqlAutocomplete(tab.connectionId)`만 호출하고 `tableColumns` 인자를 전달하지 않아 `SELECT users.<Tab>`에서 컬럼이 안 뜸.

**DOD**:
- [ ] schemaStore에 `getCachedColumnsForConnection(connectionId): Record<string, ColumnInfo[]>` 같은 selector 추가 (이미 expand/탐색한 테이블만)
- [ ] QueryTab이 이를 `useSqlAutocomplete`에 전달
- [ ] `users.` 입력 시 `users` 테이블의 컬럼만, `u.` (alias) 같은 케이스는 best-effort
- [ ] 단위 테스트: cached 컬럼이 후보로 노출됨 / 빈 cache → 함수만 노출

### S60-6. Connection / Schema 시각적 분리 강화 (3-5시간)

**문제**: 현재 사이드바에 Connection 그룹/항목과 Schema/Table 노드가 같은 레벨로 보여 페르소나가 "지금 보고 있는 게 connection 자체인지 그 내부인지" 0.5초 망설임.

**TablePlus 패턴**: 초기 화면 = Connection 관리, 연결을 열면 새 창에서 schema 탐색.
**우리 결정**: 2-depth 창 분리는 하지 않되, **VS Code activity-bar 스타일**을 차용해 시각적으로 강하게 분리.

**디자인 의도**:
- 좌측 끝에 좁은 ConnectionRail (40-48px) — 활성 connection 아이콘 리스트, 색상/environment 배지로 시각화
- 그 옆 SchemaPanel (200-280px, resizable) — 현재 활성 connection 1개의 schema tree만
- 활성 connection 클릭으로 SchemaPanel 컨텐츠 즉시 전환
- 그룹/검색/추가 등 connection 관리 액션은 ConnectionRail 하단/상단 또는 Cmd+클릭 메뉴
- 연결되지 않은 connection은 grayscale로 rail에 표시
- 빈 상태(연결된 connection 없음): SchemaPanel에 안내

**DOD**:
- [ ] ConnectionRail: 활성 connection 아이콘 세로 리스트, 색상 토큰 시각화, 현재 활성 connection 강조
- [ ] SchemaPanel: 현재 활성 connection의 SchemaTree만 렌더링 (단일)
- [ ] connection 토글(rail 아이콘 클릭) → 활성 connection 전환 + SchemaPanel 갱신
- [ ] connection 단일 클릭 = 활성화 (선택), 우클릭 = 컨텍스트 메뉴 (Connect/Disconnect/Edit/Delete)
- [ ] 비활성 connection은 시각적으로 dimmed
- [ ] 빈 상태: connection 0개 → ConnectionRail에 + 버튼만, SchemaPanel에 안내
- [ ] 빈 상태: connection은 있으나 활성화된 게 없음 → "Click a connection to explore" 안내
- [ ] 다중 active connection: 탭바 색상으로 구분 유지 (기존 동작 보존)
- [ ] resize handle 보존
- [ ] 컴포넌트/통합 테스트: 모든 시나리오

### S60-7. e2e 테스트 작성 및 CI 검증

**DOD**:
- [ ] `e2e/keyboard-shortcuts.spec.ts`: Cmd+N, Cmd+S, Cmd+P 핵심 흐름
- [ ] `e2e/inline-editing.spec.ts`: Tab/Enter 셀 이동, commit, discard
- [ ] `e2e/connection-rail.spec.ts`: rail 클릭으로 활성 전환, 빈 상태
- [ ] 기존 e2e spec 회귀 없음
- [ ] CI 푸시 후 결과 확인 → 깨진 spec 수정

## 작업 순서 결정 근거

1. S60-1 → S60-2: 가장 단순 (이벤트 listener 추가). 패턴 정착 + 빠른 win
2. S60-3: QuickOpen 컴포넌트 내부 변경, store 의존
3. S60-4: DataGridTable의 인라인 편집 키보드 — 별도 영역
4. S60-5: 자동완성 — Query 영역
5. S60-6: 사이드바 구조 변경 — 가장 큰 변경, 다른 작업과 독립
6. S60-7: 위 모든 작업의 통합 회귀 검증

## 비-목표 (이 sprint에서 다루지 않음)

- 트리 키보드 네비게이션 (P1, 별도 sprint)
- 셀 단위 active state / 단일 셀 복사 (P1)
- 즐겨찾기 단축어 바인딩 (Phase 5 미구현 항목)
- View "Show as Query" 컨텍스트 메뉴 (P1)
- 폰트/아이콘 사이즈 토큰 정리 (P2)
- ConnectionDialog 미구현 DBMS 비활성화 (P2)
