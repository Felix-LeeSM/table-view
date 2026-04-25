# Sprint 88 → Sprint 89 Handoff

## Sprint 88 Result
- **PASS** (Overall 8.8/10, 1 attempt)
- 모든 AC-01~05 PASS, Invariants 유지, Scope 준수.

## sprint-89 가 즉시 사용 가능한 산출물

### Fixture (양방향 계약 검증용)
- `tests/fixtures/fk_reference_samples.json` — schema `fk_reference_samples@1`, `samples[].{schema, table, column, expected}` 3쌍. `expected` 는 `"<schema>.<table>(<column>)"` 형식 — sprint-89 가 이 포맷으로 정렬한다.
- TS 로더 예시: `tests/fixtures/fk_reference_samples.test.ts` (readFileSync)
- Rust 로더 예시: `src-tauri/tests/fixture_loading.rs` (include_str! + serde_json)

### Helper
- `src/__tests__/utils/expectNodeStable.ts` — `expectNodeStable(getter)` → `{ initial, assertStillSame(label?) }`. sprint-93(CONN-DIALOG-6) 에서 사용 예정.

### Regression-first 테스트
- `src/components/datagrid/DataGridTable.parseFkReference.test.ts` — 3개 테스트가 production regex 의 inline 복제본으로 "현재 null 반환" 을 증명.
- **sprint-89 액션**: 테스트 파일 내 `// TODO regression(sprint-89)` 주석 3곳 (line 17, 39, 54) 를 찾아서 (a) inline regex 복제 제거, (b) `import { parseFkReference }` 로 교체, (c) 단언을 "null 반환" → "올바른 파싱 결과" 로 뒤집기.

### Catch-audit
- `docs/sprints/sprint-88/catch-audit.md` — 57행 인벤토리. `mixed: 5` 는 sprint-93(#EDIT-6) 등 후속 sprint 가 정리.

### 규칙
- `.claude/rules/test-scenarios.md` 에 catch 블록 검증 규칙 추가됨. 이후 sprint 의 신규 코드는 빈 catch 허용 안 됨.

## Residual Notes
- Generator 가 직접 만든 게 아닌 pre-existing 워크트리 modifications (`memory/lessons/memory.md`, `src/components/connection/ConnectionDialog.tsx`) 은 sprint-88 범위 밖. sprint-89 시작 전 baseline 캡처 권고 (findings F-1).
