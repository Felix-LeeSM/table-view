---
id: 0041
title: SchemaCache cross-window invalidation — in-process event + wide + eager
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: DDL 후 `schemaStore` (RDB) + `documentStore` (Mongo) 의 cache
invalidation 은 **(a) in-process event** + **wide** + **eager** 정책을
따른다.

1. **Trigger** — DDL IPC (`CREATE`/`ALTER`/`DROP` table/view/function/
   trigger/index/column, MongoDB collection 조작) 응답 직후 backend 가
   `emit_all({domain:"schemaCache", op:"invalidate", entityId: connection_id,
   version, snapshotVersion, originWindow})` 발신.
2. **Wide invalidation** — 받은 window 는 `schemaStore.clearForConnection
   (connection_id)` — 6 cache (schemas/tables/views/functions/triggers/
   columns) 모두 drop. `documentStore` 도 같은 connection 의 databases/
   collections/fields drop.
3. **Eager refetch** — 현재 sidebar 가 그 connection 을 mount 중이면
   invalidate 직후 `refreshSchema(connection_id)` 자동 호출. Mount 중
   아니면 lazy (다음 mount 시 빈 cache 라 자동 fetch).
4. **Self-echo skip** — DDL 한 window 는 IPC 응답 핸들러에서 이미
   `clearForConnection` 호출. Event 도착 시 `originWindow ===
   currentWindowLabel` 이면 skip (이중 invalidation 방지).
5. **Connection scope** — 다른 connection 의 schemaCache 영향 없음.
   `entityId = connection_id` 라 wildcard match 안 함.

**이유**:

1. **Wide vs narrow ROI 비교** — Narrow invalidation (e.g. table 단위
   drop) 은 (a) DDL 종류별 invalidation scope 매핑 (CREATE INDEX 가
   columns metadata 도 건드림? function 신설이 trigger 목록도 갱신?)
   가 paradigm 별 다 다름. (b) 잘못 좁히면 stale cache 노출 위험. Wide
   drop 은 6 cache 전체라 단순 + 정확. 다음 mount 의 fetch 비용 (대형
   schema 수백 ms) 이 ROI 의 단점이지만 사용자 가치는 정확성이 더 높음.
2. **Eager refetch 가 사용자 가치 (A2 / A5) 일치** — Sidebar 가 mount
   중인데 invalidate 만 하고 fetch 안 하면 사용자가 즉시 "내 새 테이블
   어디?" 의 의문. Eager refetch (mount 중인 경우만) 가 사용자 expectation
   만족. Mount 안 된 경우는 lazy (다음 mount 시 빈 cache → 자동 fetch)
   가 자원 효율.
3. **In-process event = single-instance 의 자연 follow-up** — Q3/Q4
   (ADR 0033) 의 `emit_all` 인프라 위에서 schemaCache 도 단순한 domain
   하나로 처리. ~~File watcher~~ / ~~cross-process broadcast~~ 불필요.
4. **Self-echo skip 의 이중 invalidation 방지** — DDL 한 window 가 IPC
   응답에서 이미 처리 (optimistic mutate). Event 도착 시 같은 처리 반복
   하면 (a) version 충돌, (b) eager refetch 가 두 번 호출되어 race.
   `originWindow` 비교로 skip.
5. **Narrow invalidation 추후 ROI 확인 후 도입** — 본 ADR 의 wide 정책은
   *현재 단순성 우선*. 사용자가 "100k table 의 schema 에서 한 column
   추가했는데 sidebar 전체 refetch = 3초 friction" 의 신고 빈도가 높으면
   별 ADR 로 narrow 정책 검토 (out of scope).

**트레이드오프**:

- **+** 정확성 — 6 cache 모두 drop 으로 stale 위험 0.
- **+** 단순 invalidation 코드 — DDL 종류별 scope 매핑 0.
- **+** 사용자 expectation 매칭 — sidebar 새 객체 즉시 노출.
- **+** Self-echo skip 으로 DDL 한 window 의 IPC 응답이 single mutate.
- **+** 다른 connection schemaCache 영향 0 — `entityId = connection_id`
  매칭.
- **−** 대형 schema (수천 table) 의 refetch 비용 — 한 column 추가에도
  full schema fetch. ROI 신고 시 narrow 정책 별 ADR.
- **−** `schemaCache` 의 lazy-vs-eager 분기 — sidebar mount 중인지
  확인 로직 (mounted ref / subscription count) 추가. 단 ADR 0027 의
  workspaceStore 가 이미 sidebar mount 상태 추적 (selectedNode /
  expanded slot 의 nonzero 여부).
- **−** Eager refetch 가 in-flight 다른 fetch 와 race 가능 — 사용자가
  DB 전환 + 다른 window DDL 동시 발생. 단 `refreshSchema` 자체가
  abortable + version gate 로 stale 응답 무시 (race-safe).
- **−** Event payload 에 schema diff 안 들어감 — wide drop 이라 received
  side 가 무엇이 바뀌었는지 모름. 단 single-source refetch 원칙 (F.4)
  에서는 의도된 단순화 — diff 필요한 use case 가 없음.

**관련**:

- state-management-strategy-2026-05-15.md §Q23 line 434 (in-process event + wide +
  eager)
- state-management-strategy-2026-05-15.md §F.4 line 1465–1471 (schemaCache 도메인
  정책 — wide / eager / self-echo / connection scope)
- state-management-strategy-2026-05-15.md §Phase 2 line 754–760 (Q23 invalidation 이
  Phase 3 cross-window broadcast 의존)
- state-management-strategy-2026-05-15.md §Phase 3 AC line 1644 (Q23 event delivery
  검증 — workspace A DDL → launcher event 50ms 안)
- ADR 0027 — Per-workspace state store (sidebar mount 상태 추적)
- ADR 0032 — SQLite infrastructure (schemaCache 자체는 SQLite 미저장
  — backend in-memory cache + frontend store)
- ADR 0033 — Single-instance + cross-window sync (`emit_all` event
  domain="schemaCache" 의 의존)
- ADR 0039 — Workspace window per-connection (DDL 한 window 와 event
  수신 window 의 originWindow 비교)
