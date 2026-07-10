---
id: 0050
title: redo (Cmd+Shift+Z) 의미론 — 완전 대칭 + baseline 정규화 (ADR 0048 보완)
status: Accepted
date: 2026-07-10
supersedes: null
superseded_by: null
---

**결정**: #1126 redo(Cmd+Shift+Z) 의미론을 **"완전 대칭 + baseline 정규화"** 모델로 확정한다 (2026-07-10, 오너). 본 ADR 은 ADR 0048(undo 스택 commit 생존 + 재스테이징)의 **보완이며 supersede 가 아니다** — 0048 의 undo 결정은 그대로 유효하고, 본 ADR 은 그 대칭축인 redo 를 규정한다. 4 확정 사항: (1) redo 스택도 undo 스택과 동일하게 **commit 을 넘어 생존**한다 (0048 의 undo 모델과 대칭 — commit 시점에 비우지 않음). (2) redo 가 만드는 pending 편집도 undo 재스테이징과 동일 규칙을 따른다 — **재스테이징 값이 현재 baseline 과 같으면 pending 을 얹지 않고 소멸**한다 (no-op pending 원천 차단, 0행 UPDATE 무경고 문제와의 충돌 방지). (3) 새 편집 발생 시 redo 스택을 클리어한다 (표준 undo/redo 관례). (4) DB 쓰기는 여전히 오직 명시적 commit 에서만 — redo 도 로컬 편집 상태 조작에만 한정한다 (ADR 0048 원칙 상속). 즉 redo 는 undo 를 축으로 뒤집은 거울상이며, undo 가 가진 "로컬 상태만 만진다 · commit 이 유일한 저장" 계약을 그대로 물려받는다.

**이유**: mental model 을 하나로 통일한다 — "undo/redo 는 스테이징만 움직인다, 저장은 commit". undo 만 commit 을 넘어 생존하고 redo 는 commit 에서 증발하면, 사용자는 같은 스택 축인데 수명이 비대칭인 두 규칙을 각각 기억해야 한다. undo/redo 수명 대칭은 일관성 원칙(같은 작업 = 같은 진입점 / 같은 위험 = 같은 게이트)에 부합하고, redo 재스테이징이 baseline 과 같으면 소멸하는 규칙은 no-op pending 을 원천 차단해 "0행 UPDATE 인데 경고 없음" 문제와의 충돌을 막는다. **기각 대안 — "commit 시 redo 스택 클리어"**: 구현은 최소지만 commit 이전 편집의 재적용이 불가능해지고(undo 로 되돌린 편집을 redo 로 복원할 수 없음), undo 스택은 살고 redo 스택만 죽는 **수명 비대칭**을 남긴다 — 통일된 mental model 을 깨므로 기각.

**트레이드오프**:
- **+** undo/redo 수명·경로가 완전 대칭 — redo 도 로컬 편집 상태만 조작하고, redo 로 재적용된 편집의 commit 은 여느 grid 편집 commit 과 동일 경로(preview·confirm·Safe Mode·충돌 감지)를 그대로 탄다. 별도 redo 전용 쓰기 경로·충돌 처리 결정이 불요.
- **+** baseline 정규화로 no-op pending 원천 차단 — 재스테이징 값이 현재 baseline 과 같으면 pending 을 얹지 않으므로 "값 변화 0 인데 UPDATE dirty 표시" / "0행 UPDATE 무경고" 와의 충돌이 발생하지 않는다. 이는 0048 undo 재스테이징의 baseline 대조 규칙을 redo 축에 그대로 확장한 것.
- **−** commit-후 redo 도 "즉시 반영"이 아니라 "재적용 편집을 얹음" — 사용자가 한 번 더 commit 해야 DB 에 반영된다(0048 undo 와 동일 지연). 툴팁/문구 정합 필요(#1121).
- **시나리오**:
  - ① commit 후 Cmd+Z → 되돌리는 pending 이 얹히고, 이어 Cmd+Shift+Z → 그 pending 이 제거된다(재적용). redo 로 얹힌 값이 baseline 과 같으면 pending 없이 소멸(③).
  - ② commit 이전 편집의 redo 재적용 가능 — redo 스택이 commit 을 넘어 생존하므로, 과거 commit 전에 undo 로 밀어낸 편집을 이후에도 redo 로 재적용할 수 있다.
  - ③ 재스테이징 값 == 현재 baseline → pending 을 얹지 않고 소멸(no-op 차단).
- **재개 트리거**: redo 스택 자료구조·핸들러는 아직 미구현(undo 만 구현됨) — 본 ADR 의 대칭 계약에 맞춰 `redoStack` 을 `undoStack` 대칭으로 추가하는 것이 구현 범위. Tracker: issue #1126.

**관련**:
- ADR 0048 — undo 스택 commit 생존 + Cmd+Z 재스테이징. 본 ADR 은 그 **보완(대칭축 redo 규정)이며 supersede 아님**. 0048 본문 동결 유지.
- issue #1126 — undo/redo 구현 tracker. undo/redo 의미론 결정은 0048+0050 로 모두 해소, 잔여는 redo 스택 구현.
- issue #1121 — 툴팁 문구 정합(redo 도 "재적용 편집을 얹고, commit 시 반영").
- `src/stores/dataGridEditStore.ts` — `undoStack` / `EditSnapshot` 상태 슬라이스. redo 는 여기에 대칭 `redoStack` 을 추가할 지점.
- `src/components/datagrid/dataGridEditFsm.ts` — `UNDO_STACK_MAX=50`, `buildRestageSnapshot`(commit 후 재스테이징 스냅샷 빌드, baseline 대조). redo 재적용도 이 baseline 정규화 로직을 재사용.
