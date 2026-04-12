## Sprint Execution Brief

### Objective
Structure 패널의 Indexes/Constraints 탭에 CRUD UI 추가: 인덱스 생성/삭제, 제약조건 추가/삭제 + SQL 미리보기

### Task Why
Sprint 22에서 백엔드 IPC(createIndex, dropIndex, addConstraint, dropConstraint)가 이미 구현됨. Sprint 23에서 Columns 탭 편집 UI의 패턴(pending changes → SQL preview → execute)이 확립됨. 이 패턴을 Indexes/Constraints 탭에 적용.

### Scope Boundary
- StructurePanel.tsx 내의 Indexes/Constraints 탭 UI만 수정
- Columns 탭 코드는 변경하지 않음
- 백엔드(Rust) 코드는 변경하지 않음 (이미 구현됨)
- IPC 래퍼(src/lib/tauri.ts)는 변경하지 않음

### Invariants
- 기존 450 테스트 통과
- Columns 탭 편집 기능 회귀 없음
- 다크/라이트 테마 지원

### Done Criteria
1. Indexes 탭에 Create Index 버튼 + 폼 모달 동작
2. 인덱스 행 hover 삭제 아이콘 + 삭제 확인 동작
3. Constraints 탭에 Add Constraint 버튼 + 폼 모달 동작 (type별 동적 필드)
4. 제약조건 행 hover 삭제 아이콘 + 삭제 확인 동작
5. 모든 SQL 미리보기는 preview_only로 확인 후 실행
6. 450+ 테스트 통과, tsc/lint clean

### Verification Plan
- Profile: mixed
- Required checks:
  1. pnpm vitest run
  2. pnpm tsc --noEmit
  3. pnpm lint
- Required evidence:
  - 변경된 파일 목록과 목적
  - 테스트 결과

### Evidence To Return
- Changed files with purpose
- Test results
- Acceptance criteria coverage
