# Phase 22: Row 인라인 편집 RDB 완성 + Preview/Commit/Discard 게이트

> **상태: 계획** — TablePlus 패리티 7단계 중 2단계. **본 Phase 가 #3~#7
> 의 공통 인프라**다.

## 배경

데이터 클라이언트의 본질 가치는 "결과 셀을 더블클릭 → 편집 → 저장" 의
직관적 흐름. Mongo 측은 `update_document` $set 패턴으로 완성됐지만, RDB
측 `EditableQueryResultGrid` 는 진행 중. 본 Phase 에서 RDB 인라인 편집을
마무리하면서, 동시에 **모든 mutation 을 "Preview SQL → Commit / Discard"
게이트로 통과시키는 패턴**을 도입한다. 이 게이트는 Phase 23 (Safe Mode) 의
부착점이고 Phase 24~27 의 모든 DDL UI 가 그 위에 얹힌다.

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#2,
TablePlus `gui-tools/code-review-and-safemode/{commit-changes,discard-changes}.md`.

## 범위

- **PG `UPDATE … WHERE <pk> = …` 생성기** — `EditableQueryResultGrid` 의
  변경 셀 → SQL 변환. PK 부재 시 안전 가드 (편집 자체 차단 + 사유 표시).
- **Pending changes 트레이** — 그리드 하단 또는 사이드 패널에 누적된 변경
  목록. 각 항목: 컬럼·이전값·새값·생성된 SQL.
- **Preview SQL 다이얼로그** — Commit 클릭 시 모든 pending mutation 의
  SQL 을 한 화면에 묶어 노출. 사용자 확인 → 트랜잭션으로 실행.
- **Commit All / Discard All** 버튼 — 트레이 헤더에 두 액션. Discard 는
  로컬 상태만 되돌림 (DB 호출 없음).
- **Mongo 재배치** — 현재 즉시-적용 패턴인 Mongo 측도 동일 게이트 위로
  옮김. 단일 코드 경로.
- **Row 추가 / 삭제** — 동일 게이트로 통일. 추가는 `INSERT`, 삭제는
  `DELETE WHERE pk = …`.

## Out of Scope

- **Multi-row bulk edit** (한 컬럼 전체 일괄 변경) — 별도 sprint.
- **트랜잭션 격리 수준 선택 UI** — 기본 read committed.
- **편집 충돌 검출** (다른 세션의 변경 감지) — 현재는 마지막-쓰기-승리.
- **Safe Mode 의 production 가드** — Phase 23 에서 게이트 위에 얹음.

## 작업 단위 (sprint 추정)

- **Sprint 182** — `EditableQueryResultGrid` PG UPDATE 생성기 + PK 가드 +
  pending changes 트레이.
- **Sprint 183** — Preview SQL 다이얼로그 + Commit / Discard 액션 +
  트랜잭션 실행. Mongo 측 재배치.
- **Sprint 184** — Row 추가 / 삭제 통합, 게이트 일관성 회귀 테스트, 성능
  smoke (100+ pending changes).

## Exit Criteria

- 세 mutation 경로 (update / insert / delete) 가 동일 게이트 통과.
- PK 부재 시나리오 가드 + 명시적 사유 노출.
- TablePlus 의 "Commit Changes" / "Discard Changes" 와 동등한 UX.
- 후속 Phase 23~27 이 본 게이트의 props/이벤트만 사용해 mutation 을
  추가할 수 있음 (인터페이스 안정).
