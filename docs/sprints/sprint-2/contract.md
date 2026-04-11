# Sprint Contract: sprint-2

## Summary
- Goal: Query Tab + CodeMirror SQL 에디터 + 결과 그리드 프론트엔드 구현
- Verification Profile: `mixed`

## In Scope
- tabStore에 "query" 탭 타입 추가 (discriminated union: TableTab | QueryTab)
- QueryEditor 컴포넌트 (CodeMirror 6: 구문 하이라이팅, 줄번호, 자동 들여쓰기, Cmd+Return 실행)
- QueryResultGrid 컴포넌트 (동적 컬럼, 실행시간 표시)
- QueryTab 컴포넌트 (에디터 + 결과 수직 분할)
- src/types/query.ts (QueryResult, QueryState, QueryColumn 타입)
- src/lib/tauri.ts에 executeQuery, cancelQuery IPC 추가
- MainArea에서 query 탭 라우팅
- TabBar에 Code2 아이콘 + "+" 새 쿼리 탭 버튼
- Sidebar에 "New Query" 버튼

## Out of Scope
- 다중 탭 상태 보존 (Sprint 3)
- Cmd+T/Cmd+. 단축키 (Sprint 3)
- 자동완성 (Sprint 4)
- 리사이즈 가능한 분할 (Sprint 4)

## Acceptance Criteria
- AC-01: "+" 버튼 또는 사이드바에서 쿼리 탭 열림 → CodeMirror 에디터 표시
- AC-02: 구문 하이라이팅, 줄번호, 자동 들여쓰기 동작
- AC-03: Cmd+Return으로 SQL 실행 → 결과 그리드에 표시 (SELECT)
- AC-04: DML 결과에 "N rows affected", DDL 결과에 "Query executed successfully" 메시지 표시
- AC-05: 에러 발생 시 빨간색 에러 메시지 표시, 실행 시간 표시
- AC-06: 기존 테이블 탭 기능 영향 없음, pnpm test 통과

## Verification Plan
1. pnpm test — 프론트엔드 테스트 통과
2. pnpm build — 빌드 성공
3. cargo check — 백엔드 변경 없으므로 기존과 동일
