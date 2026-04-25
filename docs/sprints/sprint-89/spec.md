# Sprint 89: FK 계약 정렬 (#FK-1)

**Source**: `docs/ui-evaluation-results.md` #FK-1
**Depends on**: sprint-88
**Verification Profile**: mixed

## Goal

백엔드 PostgreSQL FK 수집 쿼리와 프론트 `parseFkReference` 의 문자열 포맷을 `"schema.table(column)"` 형태로 정렬하고, 양쪽을 sprint 88 의 공유 fixture 로 검증해 영구히 분기하지 않게 한다. FK 아이콘이 셀에 호버하지 않아도 흐릿하게 보이도록 발견성을 개선한다.

## Acceptance Criteria

1. PostgreSQL adapter 가 FK 참조 문자열을 `"<schema>.<table>(<column>)"` 형태로 생성한다. 포맷 생성 로직은 SQL 인라인이 아닌 Rust 순수 함수로 추출돼 단위 테스트 가능하다.
2. `parseFkReference` 가 export 되어 단위 테스트 가능하고, sprint 88 의 `fk_reference_samples.json` 의 모든 샘플에 대해 양방향(직렬화→파싱→원본 복원) 일치를 양쪽 CI 에서 단언한다.
3. FK 컬럼 + non-null 셀에서 링크 아이콘이 호버 없이도 최소 가시 상태(예: `opacity-40` 이상)로 보이고, 호버 시 더 선명해진다. 비-FK 컬럼 또는 NULL 셀에서는 아이콘이 렌더되지 않는다.
4. FK 아이콘 클릭 시 `onNavigateToFk(schema, table, column, cellValue)` 가 정확한 인자로 호출됨이 통합 테스트로 단언된다.
5. 회귀 방지: sprint 88 에 작성된 "현재 포맷은 null 을 반환" 테스트가 수정 후 자연스럽게 새 단언으로 갱신되며, 백엔드 포맷 함수와 프론트 파서가 동일 fixture 를 통과한다.

## Components to Create/Modify

- `src-tauri/src/db/postgres.rs`: FK 수집 쿼리의 문자열 연결 로직(`ccu.table_name || '.' || ccu.column_name`)을 schema 포함 형식으로 교체하고, 직렬화를 순수 Rust 함수로 추출.
- `src-tauri/src/db/postgres.rs` (#[cfg(test)] 모듈): `format_fk_reference` 단위 테스트 + fixture 기반 round-trip 테스트.
- `src/components/datagrid/DataGridTable.tsx`: `parseFkReference` 를 export 하고 FK 아이콘의 가시성 클래스를 호버 의존에서 상시 흐릿 → 호버 선명으로 완화.
- `src/components/datagrid/DataGridTable.parseFkReference.test.ts` (신규): 파서 단위 테스트, fixture 소비.
- `src/components/datagrid/DataGridTable.fk-navigation.test.tsx` (신규): 셀 렌더 + 클릭 통합 테스트.

## Edge Cases

- FK 참조 문자열에 점/괄호/따옴표 포함된 식별자 — 파서/생성기 양쪽 escape 정책 일치.
