---
id: "0018"
title: Sprint 180 — 비동기 작업 1초 임계 + Cancel UX 단일화 + per-adapter cancel 정책
status: Accepted
date: 2026-04-30
supersedes: null
superseded_by: null
---

**결정**: 사용자 인지 가능한 4 비동기 표면(RDB 행 fetch, 쿼리 실행, 스키마 구조 로드, refetch)에 공유 `AsyncProgressOverlay` + `useDelayedFlag(loading, 1000)` 임계 게이트를 적용한다. Cancel UX 는 (a) 호스트가 `fetchIdRef`를 bump 해 in-flight resolve를 stale 처리하고 `loading=false`를 동기적으로 세팅(한 프레임 내 overlay 사라짐), (b) `cancelQuery(queryId)` 백엔드 토큰 호출(best-effort)로 라우팅한다. `QueryHistoryEntry.status`는 `"success" | "error"`에서 `"success" | "error" | "cancelled"`로 widen — 취소된 쿼리는 별도 history 행에 calm muted 톤으로 기록된다. Cancel 버튼은 4 표면 전부 `data-testid="async-cancel"`, 라벨 `"Cancel"`(고정), `<button>` 시맨틱(키보드 접근성 자동)을 공유한다.

백엔드 trait 표면(`RdbAdapter` / `DocumentAdapter`)의 cancellation policy 는 **per-adapter** 로 명시한다:

- **PostgreSQL (`PostgresAdapter`)**: 협조적 중단(cooperative drop). 기존 Sprint 88 `execute_sql` 이 사용한 `tokio::select!` 패턴을 8 trait 메서드(`query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints`, plus `find`/`aggregate`/`infer_collection_fields`/`list_collections` 의 RDB 사촌 격) 전부에 동일하게 적용한다. cancel 토큰이 fire 되면 `tokio::select!` 의 `token.cancelled()` arm 이 이겨 in-flight future 가 즉시 drop 되고 `Operation cancelled` AppError 가 반환된다. **현 시점에서는 `pg_cancel_backend(pid)` 호출은 이루어지지 않는다** — server-side 가 query 를 잠시 더 진행할 수 있으나 클라이언트는 그 결과를 기다리지도 처리하지도 않는다. 향후 sprint 에서 SQL `pg_cancel_backend(pid)` 호출을 cancel arm 에 추가해 server-side abort 까지 보장하는 enhancement 가 가능하다.
- **MongoDB (`MongoAdapter`)**: 드라이버 수준 협조적 중단(abort). bundled mongo driver 가 `Client::kill_operations` 을 노출하지 않으므로 server-side query 를 직접 죽일 수는 없으나, `tokio::select!` 분기에서 `token.cancelled()` arm 이 이기는 즉시 future 가 drop 되고 `cursor::next()` polling 이 멈춘다. 사용자 관점에서는 즉시 "취소됨" 으로 보이고, server 는 결과를 잠시 더 만들지만 클라이언트는 그 결과를 받지도 처리하지도 않는다. 4 trait 메서드(`find`, `aggregate`, `infer_collection_fields`, `list_collections`) 동일 패턴.
- **SQLite (Phase 9, 미구현)**: in-flight query 에 대해 best-effort no-op. SQLite 는 `sqlite3_interrupt(db)` API 가 있으나 드라이버 wrapper 가 노출하지 않거나 노출 비용이 큰 경우가 있다. 토큰을 받지만 실제 중단은 try 만 하고 실패하면 query 완료까지 기다린 뒤 결과를 버린다. 사용자에겐 PG/Mongo 와 동일한 "Cancel → 즉시 overlay 사라짐" 체감, 다만 server-side 가 cooperative 가 아닌 점만 다르다.

8 trait 메서드의 `Option<&CancellationToken>` 시그니처 확장은 본 스프린트에서 완료되었다. cancel 토큰을 받지 않는 레거시 호출 site 는 `None` 을 전달해 pre-180 동작과 100% 동등하게 유지된다.

**이유**:
1. **Doherty Threshold (1s)**: <1s에 응답이 돌아오면 진행 인디케이터를 보여주지 않는 편이 perceived performance 가 더 좋다. 기존 inline overlay는 마운트 즉시 paint 되어 sub-second fetch에서 flash flicker를 발생시킴.
2. **Goal-Gradient + Locus of Control**: 1s 이상 걸리는 작업은 Cancel을 노출해 "정지 가능"한 자율성을 사용자에게 돌려준다. Cancel을 누르면 `loading=false`가 즉시 적용되어 사용자가 즉각적인 피드백을 받는다(백엔드 cancel은 best-effort).
3. **Law of Similarity**: 4 표면이 같은 component, 같은 testid, 같은 키보드 동선을 공유하면 "어디서 어떻게 멈추는가"의 학습 비용이 0이 된다.
4. **Sprint 176 가드 보존**: pointer-event hardening(mouseDown/click/dblClick/contextMenu × `preventDefault + stopPropagation`)을 공유 컴포넌트 내부에 흡수해, 호스트별 중복 구현을 제거하면서 RISK-009 invariant를 동일하게 유지.
5. **Per-adapter 정책 명시화**: 현 단계의 cancel 은 PG/Mongo 동일하게 client-side cooperative drop (`tokio::select!` 가 future 를 drop) — server-side abort 는 후속 enhancement. ADR 이 (a) 현 시점의 정확한 시멘틱과 (b) 미래의 server-side abort 경로(PG `pg_cancel_backend`, Mongo `killOp`, SQLite `sqlite3_interrupt`)를 모두 못박아, 다음 sprint 가 어떤 paradigm 부터 server-side abort 를 추가하더라도 trait 시그니처/frontend Cancel UX 는 변동 없이 진화 가능.

**트레이드오프**:
+ 4 표면 동일 UX → 사용자 학습/근육 기억 단일화. Cancel testid + accessible name 의 단일 소스가 e2e/unit 테스트도 단순화.
+ Threshold 게이트로 sub-second fetch 의 overlay flash 제거. fast network/local DB 환경에서 체감 품질 개선.
+ Per-adapter cancel 정책을 ADR 에 명시 → server-side kill 이 가능한 PG 와 client-side drop 만 가능한 Mongo 가 동일 trait 시그니처로 통합되며, SQLite 등 미래 paradigm 도 동일 시그니처로 진입(no-op 라도) 할 수 있어 frontend Cancel UX 는 paradigm 변동에 영향을 받지 않는다.
- 1s 미만이지만 0.5–1.0s 사이의 쿼리는 spinner 가 전혀 보이지 않아 "응답 중인지" 알 수 없는 grey-zone 발생. 향후 250–999ms 구간에 가벼운 cursor/progress hint 추가 검토.
- PG/Mongo/SQLite 모두 현 시점 cancel 은 **client-side cooperative drop** — `tokio::select!` 가 in-flight future 를 dropping 함으로써 클라이언트는 즉시 "취소됨"으로 인지하지만 server 는 query 를 잠시 더 진행할 수 있다. 어느 paradigm 도 현재는 server-side abort (PG `pg_cancel_backend`, Mongo `killOp`, SQLite `sqlite3_interrupt`) 를 호출하지 않는다 — 추후 enhancement 로 분리.
- `QueryHistoryStatus` widen 은 strict superset 이므로 기존 `"success" | "error"` exhaustive switch 가 컴파일은 통과하지만 미처리 `"cancelled"` case 가 silent 로 fall-through 할 수 있다. 본 스프린트는 QueryLog/GlobalQueryLogPanel 두 시각화 표면을 명시적으로 처리했고, 향후 status 를 사용하는 새 코드는 exhaustive 처리 의무.

**측정 결과**: 본 결정은 perceived UX + 백엔드 trait contract 둘 모두에 관한 것으로,
(a) 4 표면 모두 `data-testid="async-cancel"` + accessible name `"Cancel"` 일치 (`AsyncProgressOverlay.test.tsx` + 4 표면 별 invoke 테스트로 검증),
(b) `useDelayedFlag` 가 sub-second toggle 에 false 를 유지(rapid on/off, re-arm cycle 케이스 통과),
(c) Cancel→retry cycle 에서 stale resolve 가 새 데이터 위에 덮이지 않음(`fetchIdRef` 가 4 표면 모두에서 작동, DataGridTable + DocumentDataGrid retry 테스트로 검증),
(d) 8 trait 메서드 cancel-token cooperation: `db::tests::test_*_honors_cancel_token` 8 개가 fake adapter 에서 pre-cancel 토큰을 wire 하고 `tokio::select!` 분기가 `Operation cancelled` 로 단락하는 것을 검증.
