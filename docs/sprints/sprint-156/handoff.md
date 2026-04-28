# Sprint 156 Handoff

## Result: PASS

## Changed Files

| File | Purpose |
|------|---------|
| `src/__tests__/connection-activation.diagnostic.test.tsx` | Connection activation lifecycle 진단 (8 tests) |
| `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` | SchemaTree preview entry point 진단 (9 tests) |
| `src/components/schema/DocumentDatabaseTree.test.tsx` | MongoDB preview 엣지 케이스 보강 (+3 tests) |

## Checks Run

- `pnpm vitest run`: **pass** (154 files, 2313 tests)
- `pnpm tsc --noEmit`: **pass**
- `pnpm lint`: **pass**

## Key Findings

### 모든 진단 테스트 GREEN — 버그는 런타임 이슈

사용자 보고된 두 버그 모두 jsdom 환경에서 재현되지 않음. 원인은 실제 Tauri 런타임과의 상호작용에서 발생.

### 발견된 실제 코드 이슈

1. **handleActivate에 debounce/가드 없음**: 빠른 연속 더블클릭 시 `showWindow("workspace")`가 중복 호출됨. 실제 런타임에서 WebviewWindow 생성 경쟁 가능.
2. **addTab이 subView를 무시**: 같은 테이블의 Data 탭(`subView: "records"`)과 Structure 탭(`subView: "structure"`)이 동일 탭으로 취급됨. "View Structure" 클릭 시 기존 Data 탭이 활성화될 뿐 새 탭이 열리지 않음.

## Sprint 157/158 Fix Scope

**Sprint 157 (activation fix)**:
- `src/pages/HomePage.tsx` handleActivate에 activating 가드(ref) 추가
- 중복 showWindow 호출 방지

**Sprint 158 (preview fix)**:
- `src/stores/tabStore.ts` addTab의 exact match에 subView 포함
- Data/Structure 탭이 별개로 열리도록 수정
