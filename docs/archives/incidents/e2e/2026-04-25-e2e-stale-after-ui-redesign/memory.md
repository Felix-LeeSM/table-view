---
title: UI 재설계는 e2e 셀렉터·동작 가정을 함께 갈아야 한다
type: lesson
date: 2026-04-25
---

**상황**: 테마 footer가 cycle 토글 → Popover ThemePicker로, 사이드바 모드 토글이 `role="tab"` → ToggleGroup `role="radio"`로 바뀐 뒤에도 e2e 셀렉터·기대 동작이 옛 형태 그대로 남아 CI에서 늦게 터졌다 (`New Query`/`New Query Tab`, `aria-label*="Theme"` 단일 클릭, `[role="tab"][aria-selected="false"]`).
**원인**: e2e는 unit 테스트와 달리 빌드/배포 단계에서만 실행돼 PR 단위 회귀 감지에 둔감하고, 컴포넌트 리네이밍·인터랙션 모델 변경 시 spec을 같이 수정하지 않으면 main에 누적된다.
**재발 방지**: 사용자 가시 컴포넌트(aria-label, role, 클릭 한 번에 일어나던 동작)를 바꾸면 같은 PR에서 `e2e/` grep으로 셀렉터·시나리오를 동시에 갱신하고, 변경 동기 점검을 PR 체크리스트에 포함한다.
