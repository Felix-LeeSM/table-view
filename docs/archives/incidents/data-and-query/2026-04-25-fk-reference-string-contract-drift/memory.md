---
title: FK 참조 점프 — 뼈대 완성돼 있으나 프론트/백엔드 문자열 포맷 불일치로 한 번도 작동 안 함
type: lesson
date: 2026-04-25
---

**상황**: FK 참조 점프 기능이 Rust 모델(`is_foreign_key`, `fk_reference`), PostgreSQL 수집 쿼리, 프론트 `parseFkReference` 파서, `DataGridTable` 아이콘 렌더, `DataGrid.handleNavigateToFk` 새 탭 생성까지 전 구간 구현돼 있었음. 그러나 백엔드는 `ccu.table_name || '.' || ccu.column_name` → `"users.id"` 형식을 생성(`postgres.rs:704`)하고, 프론트 파서는 `^(.+)\.(.+)\((.+)\)$` → `"schema.table(column)"` 형식을 기대(`DataGridTable.tsx:39`)하여 파서가 항상 null 반환 → FK 아이콘이 단 한 번도 렌더되지 않음. UI/UX 평가 세션에서 사용자가 "이런 기능 가능한가?" 질문으로 발견.
**원인**: 프론트/백엔드 경계를 문자열로 오가는 포맷이 타입 시스템의 보호를 받지 못하는데, 양쪽 어디에도 포맷 일치를 검증하는 테스트·공유 fixture가 없었음. `parseFkReference` 자체에 단위 테스트가 없어 어떤 입력에서 null을 반환하는지 증명된 적 없고, Rust 쪽 포맷도 SQL `||` 인라인 연결이라 순수 함수로 추출되지 않아 테스트 대상이 될 수 없었음. 두 번의 독립적 버그가 아니라 "계약이 테스트되지 않음" 한 가지 구조적 결함이 기능 전체를 사일런트로 무력화.
**재발 방지**: 프론트/백엔드가 문자열로 주고받는 모든 경계(FK 참조, 에러 코드, 타임스탬프/BigInt/ObjectId 직렬화, `ExecutedQuery` 메타 등)는 `tests/fixtures/*.json` 공유 샘플 세트를 두고 양쪽 CI에서 동일 입력으로 파싱/생성을 assert — 포맷이 분기하면 즉시 실패. 테스트 불가 형태(SQL 인라인 연결, 익명 클로저 내부 로직 등)는 수정 PR에서 **순수 함수 추출 의무화**. 코드 리뷰 체크리스트에 "이 로직을 단위 테스트할 수 있는가?" 조항 추가.
