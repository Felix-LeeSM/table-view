---
title: 코드 주석 원칙
type: convention
updated: 2026-09-07
task: comments, 주석, comment-style, comment-sweep, tsdoc, doc-comment
surface: '**/*.ts, **/*.tsx, **/*.rs, e2e/**'
keywords: 주석, comment, 한줄 주석, 간결, 재진술, restate, TSDoc, doc comment, ///, sprint 서사, 리뷰 라운드 서사, caller count, 메타 주석, 이중 서술, 출처 포인터, 이슈 번호, ADR 인용, file:line 인용, TODO, FIXME, MUST, NEVER, 영어 주석, 구획선, comment style
---

# 코드 주석 원칙

코드 주석을 쓰고 다듬을 때의 행동 계약이다. 간결 · 출처 포인터 · 메타 금지 · 신규
영어의 축은 2026-09-07 사용자 확정이다. 제거/보존 분류의 SOT 는
[god-file](../refactoring/god-file/memory.md)이고, 이 방은 쓰는 법과 다듬기 범위를 갖는다.

## 원칙

1. **간결이 목표** — 최대한 짧게 쓴다. 한 줄 주석은 설명적이어도(재진술이어도)
   유지한다. 지우는 대상은 정보 없는 장황함이다 — 같은 내용의 반복, 두 언어 이중
   서술, 서사.
2. **내용은 코드가 말하지 않는 것** — why(왜 이 구현인가, 왜 다른 방법이 아닌가),
   외부 제약(DBMS 방언, 드라이버 동작, OS 차이), 계약·불변식(호출자 의무, 보장의
   강도), 경고(어기면 무엇이 깨지는가까지). 예: `table-view-core/src/db/traits.rs`
   의 `cancel_query` 계약, `src/stores/dataGridEditStore.ts` 의 NEVER + 이유.
3. **외부 사실엔 검증 가능한 포인터** — `#NNNN`(이슈/PR), `ADR NNNN`, `file:line`
   (의존성 소스는 lock 에 고정된 버전과 함께), 설계 문서 절. 포인터 없는 외부 주장은
   회귀 때 출처가 0 이 된다. 예: `table-view-core/src/db/tls.rs` 의 sqlx/rustls
   소스 인용.
4. **메타·서사 금지** — sprint 번호 서사, 리뷰 라운드 서사, caller count 숫자, 라인 수는
   새로 쓰지 않고, 기존 것은 저장소 전체 스윕으로 정리한다. 메타 부분만 떼고
   load-bearing 본문은 보존한다. 이슈/PR 번호는 회귀 앵커라 남긴다. 분류와
   `scripts/check-round-narrative.sh` 게이트는 god-file 방이 소유한다.
5. **미완·한계 표기** — TODO/FIXME/HACK 마커를 새로 쓰지 않는다. 진행 중인 일은 이슈
   번호와 남은 것 한 문장으로 남긴다(`src/components/datagrid/useDataGridEditPendingState.ts`
   의 `#1616` 주석 형태). 보장의 강도와 막지 못하는 창은 주석에 명시하고
   (`src-tauri/src/commands/rdb/query.rs` 의 "best-effort floor"), 자세한 한계는
   `docs/product/known-limitations-*.md` 로 보낸다.
6. **계약 문서 주석** — 공개 API 는 `///`·`/**` 이다([conventions](../memory.md) Rust
   절이 SOT). 경계값 동작, 에러, 호출자 의무(MUST/NEVER)를 담는다. 예:
   `src-tauri/src/diagnostics.rs` 의 WorkerGuard 계약.
7. **반복 금지** — 같은 지식은 가장 가까운 공통 자리 한 곳에 길게 쓰고, 나머지는 짧게
   쓰고 참조한다. 반복 사본은 drift 한다. 실측 자리: `src/lib/tauri/ddl.ts` 의 동일
   TSDoc 블록, `useDataGridEditPendingState.ts` 의 동일 문장,
   `table-view-core/src/db/oracle.rs` 계열의 Debug 비밀 노출 경고.
8. **언어** — 새 주석은 영어로만 쓴다. 기존 한국어·혼용 주석을 번역하는 스윕은 하지
   않는다. 같은 내용을 두 언어로 이중으로 새로 쓰지 않는다.
9. **형식 관행 유지** — 테스트 파일 헤더(Purpose/Reason), 구획선,
   `eslint-disable` 뒤 이유 주석은 유지한다. 구획선 스타일은 파일 안에서 하나로
   통일한다.

## 다듬기 스윕 계약

스윕은 소스를 고치므로 task 이슈 → clone 사본 → PR 경로를 따른다.

- 범위: 4번(메타 접두사·서사 제거, 본문 보존)과 7번(동일 문장 여러 벌을 한 곳으로
  모으기).
- 비범위: 한 줄 주석 삭제(1번), 기존 한국어 주석 번역(8번).

## 변환 예시

4번(메타 제거)을 기존 주석에 적용하는 형태다. 전체 diff 는 PR #2624 가 앵커다.

- 접두사 제거·본문 보존: `/// Sprint 359 — wire-shape error returned from …` →
  `/// Wire-shape error returned from …`
- 인용 안의 sprint 제거: `(Sprint 235 invariant on …)` → `(invariant on …)`
- caller count 제거: `// Memoized: five call sites below, and each miss …` →
  `// Memoized: each miss …`
- 참조로 치환(7번): `Sprint 271c — see \`dropTable\`.` → `See \`dropTable\`.`

## 관련

- [god-file](../refactoring/god-file/memory.md) — 주석 제거/보존 분류 SOT
- [conventions](../memory.md) — 공개 API `///` 규칙이 있는 코딩 컨벤션 부모 방
