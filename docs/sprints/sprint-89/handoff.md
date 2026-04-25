# Sprint 89 → Sprint 90 Handoff

## Sprint 89 Result
- **PASS** (Overall 9/10, 1 attempt)
- 5 AC 모두 PASS, fixture 양방향 round-trip 통과, sprint-88 invariant 회귀 0.

## 후속 sprint 가 활용 가능한 산출물

### 계약 형식
- `format_fk_reference(schema, table, column)` (`src-tauri/src/db/postgres.rs:33`) — Rust 단일 소스. MySQL/SQLite adapter 가 동일 포맷 채택 시 이 함수를 재사용 가능.
- `parseFkReference` (`src/components/datagrid/DataGridTable.tsx:54`) — TS 단일 소스. 이미 named export 되어 import 가능.
- 양쪽이 `tests/fixtures/fk_reference_samples.json` 으로 round-trip 검증.

### 테스트 패턴
- TS round-trip: `?raw` import + `JSON.parse` (parseFkReference.test.ts 89-102 line 참고).
- Rust round-trip: `include_str!` + `serde_json::from_str` (postgres.rs `format_fk_reference_matches_sprint_88_fixture` 참고).
- 통합 테스트 패턴: `fk-navigation.test.tsx` 가 `getAllByRole("button", { name: /Open referenced row.../i })` 로 FK 아이콘 위치, mock `onNavigateToFk` 4-arg 단언.

### 미해결 (다른 sprint 대상)
- MySQL/SQLite FK 수집은 여전히 미정렬 — 별도 sprint (현재 master plan 미포함, 필요 시 추가).
- 식별자 escape 정책 (점/괄호/따옴표 포함 식별자) — `format_fk_reference` docstring 에 가정 명시. 정책 결정은 향후 sprint.
