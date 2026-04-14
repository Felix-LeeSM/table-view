# Sprint Execution Brief: Sprint 53

## Objective
- BLOB/바이너리 컬럼 아이콘 표시 + hex/text 뷰어 모달
- SQL Uglify (Cmd+Shift+I, 단일 행 압축)
- 선택 영역만 포맷팅 (Cmd+I with selection)

## Task Why
- BLOB 데이터 확인은 DB 관리 도구의 필수 기능
- SQL Uglify는 포맷팅의 역기능으로 편의성 향상
- 선택 영역 포맷은 부분 쿼리 작성 시 유용

## Scope Boundary
- DataGridTable: BLOB 타입 감지, 아이콘 표시, 클릭 핸들러
- BlobViewerDialog: hex dump + text 뷰 모달 (shadcn Dialog)
- sqlUtils.ts: uglifySql 함수 추가
- QueryTab.tsx: Cmd+Shift+I 이벤트, 선택 영역 감지 로직
- **Hard stop**: Schema tree 없음, Rust 변경 없음

## Invariants
- 기존 788개 테스트 통과
- columnOrder/context menu 인터페이스 변경 없음

## Done Criteria
1. `pnpm tsc --noEmit` 통과
2. `pnpm vitest run` 통과
3. BLOB 셀에 아이콘 + "(BLOB)" 텍스트
4. BLOB 클릭 → 모달 (hex/text 탭)
5. Cmd+Shift+I → SQL 압축
6. 선택 상태에서 Cmd+I → 선택 영역만 포맷
