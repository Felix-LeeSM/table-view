---
id: 0048
title: undo 스택 commit 생존 — Cmd+Z 는 복원값을 pending 편집으로 스테이징 (보상 commit 폐기)
status: Accepted
date: 2026-07-05
supersedes: "0022"
superseded_by: null
---

**결정**: undo/redo (#1126) 를 "보상(compensating) commit 자동 실행" 이 아닌 **"undo 스택 commit 생존 + Cmd+Z = pending 재스테이징"** 모델로 확정한다 (2026-07-04, 오너). 4 확정 사항: (1) 보상 commit 자동 실행 방식 폐기 — before-image 로 역 DML 을 즉시 찍는 "Undo last commit" 전용 액션 없음. (2) undo 스택은 commit 을 넘어 생존한다 — `dataGridEditStore.ts` 의 `undoStack` 을 commit 시점에 비우지 않는다. (3) Cmd+Z 는 복원값을 **pending 편집으로 스테이징**한다 — 값을 1→2 로 편집 후 commit 했어도 Cmd+Z 는 grid 에 "2→1 로 되돌리는 pending 편집" 을 얹는다. DB 쓰기는 오직 명시적 commit 에서만 발생하고, commit 하면 반영·안 하면 무효, 기존 preview / confirm / Safe Mode 파이프라인을 그대로 탄다. (4) raw query 에디터의 undo 는 작성한 query **텍스트** 만 되돌린다 — 실행된 query 와 무관 (실행 undo 는 스코프 밖). 이로써 ADR 0022 트레이드오프의 "raw editor commit 후 실수 unrecoverable" / "Cmd+Z 가 commit 후 DML reverse 안 함" 전제가 뒤집힌다.

**이유**: ADR 0022 는 "commit 후 unrecoverable (Cmd+Z 가 commit 후 DML reverse 안 함, 업계 표준 인정)" 을 Accepted 트레이드오프로 동결했다. #1126 이 처음 승인한 보상 commit 방식(#1126 원문 "제안 스코프": commit 시점 before-image 캡처 → 역-DML 을 confirm/preview 로 실행)은 undo 자체를 또 하나의 자율 DB 쓰기로 만들어, (a) commit 과 undo 사이 타 세션 변경을 덮는 동시성 창, (b) auto-increment 소모 / trigger / cascade 같은 비복원 부작용, (c) DDL 제외 경계 를 undo 경로가 스스로 떠안았다. commit-생존 스택 + 재스테이징 모델은 undo 를 **로컬 편집 상태 조작으로만** 한정해 이 위험을 전부 commit 파이프라인 쪽으로 되돌린다 — 복원값의 commit 은 여느 grid 편집 commit 과 **동일 경로**이므로 기존 충돌 / preview / Safe Mode 의미론을 그대로 상속하고, 별도 충돌 처리 결정이 불요해진다 (일관성: 같은 작업 = 같은 진입점, 같은 위험 = 같은 게이트). 사용자에게도 "undo 는 편집칸을 되돌릴 뿐, 저장은 내가 commit 할 때" 라는 단일 mental model 이 선다. 참고: #1126·코드 주석의 "ADR 0022 Phase 5" 는 ADR 본문에 없는 코드 주석 관례(`dataGridEditStore.ts`)이며, 본 ADR 이 undo 의미론의 SOT 다.

**트레이드오프**:
- **+** undo 가 로컬 상태만 만지므로 자율 역-DML 이 사라짐 — 동시성 덮어쓰기 창 / auto-increment·trigger·cascade 비복원 / DDL 예외를 undo 경로가 지지 않는다. 복원값 commit 은 기존 preview·confirm·Safe Mode·충돌 감지를 그대로 통과.
- **+** grid pending-edit 모델과 자연 정합 — `undoStack` 은 `EditSnapshot`(pendingEdits/pendingNewRows/pendingDeletedRowKeys 3-슬라이스)을 이미 편집 핸들러마다 push 한다. 변경 핵심은 commit 후 `clearAllPending` 이 스택까지 비우던 것을 멈추고, commit 으로 바뀐 baseline 에 맞춰 스냅샷을 pending 편집으로 **재스테이징(변환)** 하는 것뿐 — 새 IPC·backend 경로 0.
- **−** commit-후 Cmd+Z 는 "즉시 되돌림" 이 아니라 "되돌리는 편집을 얹음" — 사용자가 한 번 더 commit 해야 DB 에 반영된다. 순간 복원을 기대하면 놀랄 수 있어 툴팁/문구 정합 필요(#1121).
- **−** multi-table (JOIN result grid per-column 편집, #1299): commit 은 사용자가 실제로 touch 한 행에서 WHERE/`_id` 를 만들고, cross-page 편집도 `pendingEdits` 와 같은 key 충돌 도메인을 쓴다. undo 재스테이징도 이 key 도메인 위에서 동작하므로 fan-out(동기 갱신) 은 각 소스 테이블 commit 이 독립 pending 으로 재스테이징된다. positional/alias 매핑이 어긋난 행은 애초에 commit 이 거부하는 계약(alias mis-mapping contract, #1299)이며, undo 는 그 계약을 새로 뚫지 않는다 — 되돌림도 동일 key→소스 매핑을 재사용.
- **−** raw query 에디터 경계: 에디터 undo 는 텍스트 버퍼만, 실행된 쓰기는 grid 로 편입되지 않으면 undo 스택 밖. raw SQL 로 직접 친 DML 의 되돌림은 스코프 밖 — 사용자는 역 SQL 을 직접 작성해야 한다.
- **재개 트리거**: multi-step commit-history undo(1회 이상 과거 commit 로 재스테이징) 는 본 모델의 자연 확장이나 착수 전 별도 스코프. Tracker: issue #1126.

**관련**:
- ADR 0022 — supersedes. commit-후 unrecoverable 트레이드오프를 본 ADR 이 뒤집음.
- issue #1126 — undo/redo 구현 이슈 (2026-07-04 재정의). 열린 구현 질문은 여기 잔류.
- issue #1121 — 툴팁 허위 문구 정정 (실제 동작 = "미커밋 편집 순차 undo + commit 후 재스테이징").
- issue #1299 — JOIN result grid per-column 편집 (multi-table key 충돌 도메인).
- `src/stores/dataGridEditStore.ts` — `undoStack` / `EditSnapshot`, commit 시 `clearAllPending` → 재스테이징 변환 지점.
