# Phase 28 + Phase 29 자율 의사결정 로그

> **목적**: 2026-05-14 사용자 directive — "mongodb 관련 변경사항 모두
> 구현하고, 그 다음에 rdbms와 함께 하기로 했던 것들까지 모두 구현해.
> 우선 널 믿을테니 필요한 의사 결정이 있다면 네가 혼자 해보고, 문서로
> 어떤 결정을 어떤 근거로 내렸는 지 적어줘. 단, 모든 의사 결정은 어떤
> 문제를 해결하기 위함인 지를 명시하도록 하고, 그 관점에서 최선의 의사
> 결정을 내려야 해."
>
> 본 문서는 Phase 28 Slice A1-M + Phase 29 U1-U5 진행 중 assistant 가
> 자율적으로 내린 결정을 **(1) 어떤 문제 (2) 결정 (3) 근거 (4) 대안과
> trade-off** 형식으로 누적한다. grill 에서 이미 lock 된 결정은
> `memory/roadmap/phase-28-mongo-full-support/memory.md` 가 source —
> 본 문서는 그 결정 안에서 발생한 implementation-level micro-decision 만
> 기록한다.
>
> 메모리 팔레스 ADR 과 차이: 본 문서는 sprint scope 안 implementation
> trade-off 의 동결 로그 (sprint context 가 없으면 의미가 사라짐). 시스템
> 전반에 영향을 주는 결정은 `memory/decisions/` 에 ADR 로 별도 기록.

## 형식

```
### D-NN: <짧은 결정명> (Sprint XXX, YYYY-MM-DD)

**문제**: 무엇을 해결해야 했는가. (사용자 / 시스템 / 다른 sprint 관점)
**결정**: 무엇을 골랐는가.
**근거**: 왜 이게 최선인가. 다른 결정은 어떤 cost 가 있었는가.
**대안**: 검토했지만 채택하지 않은 선택지 + 채택하지 않은 이유.
**영향**: 어떤 후속 sprint / 모듈이 이 결정에 의존하는가.
```

---

## Phase 28 Slice A2 (Sprint 308 — 2026-05-14)

### D-01: `BulkWriteResult` 의 wire shape 을 snake_case 로 유지 (camelCase 로 바꾸지 않음)

**문제**: A2 에서 `BulkWriteOp` 는 `#[serde(tag = "op", rename_all =
"camelCase")]` 로 camelCase wire (사용자의 `bulkWrite([{ op: "updateOne",
...}])` 입력과 동일 shape 매칭하기 위함). 그렇다면 `BulkWriteResult` 의
필드 (`inserted_count` 등) 도 camelCase 로 바꿔서 wire 일관성 확보해야
하는가?

**결정**: `BulkWriteResult` 는 Rust 측 snake_case 그대로 wire 직렬화한다
(`inserted_count`, `matched_count`, `modified_count`, `deleted_count`,
`upserted_ids`). TS 측 타입도 동일 snake_case key.

**근거**: 기존 `DocumentQueryResult`, `RdbQueryResult` 등 wire 결과 타입이
모두 snake_case (Rust 의 `#[derive(Serialize)]` default). 결과 타입만
camelCase 로 바꾸면 (1) 기존 result-shape consumer 가 분기 처리 필요,
(2) Rust 측 코드 패턴이 불일치, (3) `BulkWriteOp` 와 다르게 사용자가 직접
입력하지 않는 server-out 결과는 camelCase 의 발생가치가 없다. 입력
(`BulkWriteOp`) 만 사용자 mongosh 시그니처와 정합을 맞추고, 출력은
프로젝트 내 wire convention 을 따른다.

**대안**: 모든 신규 타입을 camelCase 로 통일 — 거부. 기존 wire convention
을 깬다.

**영향**: A6 의 `WriteSummaryPanel` 이 `result.inserted_count` 등 snake_case
access. evaluator 가 contract 와의 불일치를 flag 할 수 있음 — handoff
의 assumption 으로 명시.

---

### D-02: `bulk_write([])` empty input short-circuit

**문제**: 사용자가 `db.coll.bulkWrite([])` 를 입력 (또는 dispatch path 가
빈 배열로 도달) 했을 때 driver 가 거부할 수도 있고, 빈 결과를 반환할
수도 있음. 어느 behaviour 를 wire 로 보장하는가?

**결정**: backend `bulk_write_impl` 이 입력이 empty 면 `Ok(BulkWriteResult::default())`
를 즉시 반환 (driver 호출 skip). `insert_many_impl` 도 동일 — empty 면
`Ok(vec![])`.

**근거**: (1) mongo driver (특히 8.0+) 가 빈 배열에 대해 에러를 반환하면
사용자에게 노이즈가 됨 — "0건의 작업을 수행" 이라는 명백한 의도가
에러로 surface 되면 UX 가 깨진다. (2) wire 의 결정성 보장: empty 입력은
항상 empty 출력. (3) Sprint A6 의 `WriteSummaryPanel` 이 빈 결과를
"0건 변경" 으로 자연스럽게 렌더 가능.

**대안**: driver 에 그대로 위임 — 거부. driver 버전마다 행동 분기 위험.

**영향**: 통합 테스트가 empty 케이스 cover 해야 함 — Generator handoff 의
test 목록 확인 필요.

---

### D-03: read-path 4 method 만 cancel-token 인자, write-path 2 method 는 미보유

**문제**: A2 의 6 신규 method 중 어디까지 `cancel: Option<&CancellationToken>`
를 시그니처에 노출하는가?

**결정**: read (`find_one`, `count_documents`, `estimated_document_count`,
`distinct`) 4 method 만 cancel 인자 보유. write (`insert_many`,
`bulk_write`) 2 method 는 미보유.

**근거**: mongo driver 가 in-flight write 의 cooperative abort 를 지원하지
않음. cancel 인자를 노출하면 사용자 / 호출자가 "이 작업은 cancel 가능"
이라 잘못 가정. 명시적으로 인자를 없애 contract 를 표현한다 — type
system 자체가 invariant 의 일부. trait doc 에 이유 명시.

**대안**: 모든 method 가 cancel 인자 받고 write 는 무시 — 거부. type
은 "cancel 가능" 을 약속하는데 런타임은 무시하면 caller 가 잘못된
기대를 갖는다.

**영향**: A5 dispatch 가 write method 호출 시 cancel token 을 넘기지 않음
을 인지. 통합 테스트가 cancel scenario 를 read method 에만 작성.

---

## (다음 sprint 진행하면서 이어붙임)
