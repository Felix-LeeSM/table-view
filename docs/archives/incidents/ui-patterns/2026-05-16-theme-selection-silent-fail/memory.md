---
title: ThemePicker preview 는 동작하지만 click 으로 선택이 적용 안 되는 silent failure
type: lesson
date: 2026-05-16
---

**상황**: Wave 9.5 회귀 3 cascade fix (commit b598e29) 직후 사용자 보고 — 테마 카드 hover 미리보기는 동작하지만 클릭으로 선택해도 적용이 안 됨.

**원인**: ThemePicker.test 가 `setTheme` 을 mock 으로 stub 해 "click → `persist_setting` IPC → store mutate → useEffect 의 `applyTheme()` → DOM `data-theme` 변경" path 의 끝-끝 invariant 를 검증 안 함; preview path 는 hover 시 `applyTheme()` 를 store 우회로 직접 호출이라 동작하지만 click path 는 IPC reject / unawaited promise / store subscriber 실패 같은 silent failure 를 unit 단언이 통과시킨다.

**재발 방지**: ThemePicker test 는 click 후 store state (`themeId` 가 클릭한 id 로 변경) + DOM (`document.documentElement.getAttribute("data-theme") === id`) 둘 다 user-facing invariant 로 단언; backend `persist_setting("theme", JSON)` 의 SQLite 저장 path 는 별도 Rust MockRuntime test 로 lock (jsdom 영역 밖 — feedback_test_scenarios_user_journey 규칙 적용).
