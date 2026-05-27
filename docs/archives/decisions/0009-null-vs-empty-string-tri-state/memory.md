---
id: 0009
title: DataGrid 편집에서 SQL NULL과 빈 문자열을 `string | null` tri-state로 구분
status: Accepted
date: 2026-04-24
supersedes: null
superseded_by: null
---

**결정**: `editValue`와 `pendingEdits`의 값 타입을 `string | null`로 확장해, `null`은 "명시적 SQL NULL 의도", `""`는 "빈 문자열"로 구분한다. NULL은 Cmd/Ctrl+Backspace 단축키 또는 컨텍스트 메뉴 "Set to NULL"로 진입하고 편집 UI에서 muted "NULL" 칩 + 힌트로 렌더된다. SQL 생성은 `v === null ? "NULL" : '...'`로 분기하며, `FilterBar`의 value 필드도 `|| null` 강제 붕괴를 제거해 `""`를 그대로 보낸다.
**이유**: 직전까지 NULL 셀을 열면 `cellToEditString(null) === ""`로 보여 사용자가 NULL과 빈 문자열을 구분할 수 없었고, 저장 시 빈 입력이 항상 `NULL`로 직렬화돼 명시적으로 빈 문자열을 쓰려는 의도가 불가능했다. 별도의 `CellValue` enum보다 `string | null`이 TypeScript에 자연스럽고 Map/state 타입 좁히기가 그대로 쓰인다.
**트레이드오프**: + 기존 로직 대부분 최소 수정, 타입 가드(`=== null`)로 명확한 분기, JSON 직렬화 호환 / - `pendingEdits.get(key)` 반환이 `string | null | undefined`로 3-state가 되어 호출부마다 명시적 분기 필요, `Map<string, string>` 리터럴을 쓰던 테스트 픽스처 전부 `Map<string, string | null>`로 갱신해야 함, NULL 칩 UX를 위한 키보드 핸들러(Cmd+Backspace macOS 기본동작 억제)와 접근성(`aria-label="NULL"`) 추가 비용.
