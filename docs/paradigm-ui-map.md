# Paradigm UI Map — Elasticsearch + Redis

> 각 paradigm 에서 **사용자가 궁금해하는 정보** 를 **UI 의 어느 slot 에 어떻게** 표현할지 정리한 설계 참조.
>
> 목적: Phase 7·8 구현 전에 "최종 화면이 이렇게 생긴다" 를 말로 고정. 구현 sprint 가 디자인을 매번 다시 유추하지 않도록 한다.

## 1. 공통 원칙

- **질문 → Slot 매핑** 이 설계 출발점. "이런 feature" 가 아니라 "사용자가 이런 질문을 할 때 이 slot 을 본다".
- **Paradigm 일급 개념은 UI 에 그림자를 가진다.** RDB 는 `column type`, Document 는 `{...} sentinel`, ES 는 `@timestamp`+`_score`, Redis 는 `TTL`+`Type`.
- **기존 slot 재사용 > 신규 slot.** Phase 6 에서 구축된 사이드바 / 그리드 / Quick Look / Preview modal 패턴을 최대한 재사용, paradigm 별 꼭 필요한 추가 slot 만 신설.
- **위험 행동은 모두 paradigm 공통 확인 모달** 을 경유. "DROP TABLE" · "deleteMany" · "_update_by_query" · "FLUSHDB" 가 같은 모달 유형.

## 2. UI Slot 레퍼런스 (4 paradigm 비교)

| Slot | RDB (current) | Document (Mongo) | Search (ES, Phase 7) | KV (Redis, Phase 8) |
|------|---------------|------------------|----------------------|---------------------|
| 사이드바 root | database → schema → table | database → collection | cluster → data streams / indices / aliases | DB 0-15 → 콜론 가상 트리 |
| 사이드바 leaf | table | collection | index (+ Fields / Settings / Aliases 서브탭) | key namespace group |
| **상단 바 #1** | — | — | **`@timestamp` time picker** | **`SCAN MATCH` 바** |
| **상단 바 #2** | SQL editor | MQL editor | Lucene Query String + DSL 토글 | RAW command 프롬프트 |
| 그리드 컬럼 | schema column | top-level document field | `_source` top-level + `@timestamp`/`_id`/`_score`/`_index` | Key / Type / TTL / Size / Encoding |
| 컬럼 헤더 아이콘 | SQL type | BSON type | **keyword/text/date/geo/nested/number/ip/boolean/object** | — (row 단위 type 뱃지로 대체) |
| 셀 sentinel | — | `{...}` / `[N items]` | 동일 (Mongo 재사용) | — (key 1 개 = value 1 개) |
| **Quick Look 본체** | row field list | `BsonTreeViewer` (full doc) | **highlight 상단 + `_source` tree + Meta(Explain 토글)** | **type-aware viewer (6 종)** |
| Status bar | row count | doc count | docs count + shards | `DBSIZE` (approx) + SCAN cursor |
| Danger actions | DROP TABLE | deleteMany | `_update_by_query` / `_delete_by_query` dry-run | FLUSHDB / FLUSHALL / KEYS |

**핵심 차이점만 강조**:
- 상단 바 #1 은 RDB/Mongo 에는 없고 ES/Redis 에만 존재. 각 paradigm 의 **일급 탐색 축**.
- Quick Look 이 paradigm 마다 가장 다르게 생김. "행 = 정보 한 단위" 가 paradigm 마다 다른 모양.
- Danger 확인 모달은 모두 공통 패턴 — `DROP TABLE` 이 경우 경고 문구만 paradigm 별.

---

## 3. Elasticsearch

### 3.1 질문 → UI 매핑

| 사용자 질문 | UI 의 답 |
|------------|---------|
| 지난 1시간에 뭐가 있었지 | 상단 time picker `Last 1h` → 그리드 자동 재실행 |
| error 로그만 보고 싶다 | Lucene 바 `level:error` → 그리드 즉시 필터 |
| 이거 왜 매칭됐지 | 행 선택 → Quick Look 상단 highlight fragment |
| 순위가 왜 이래 | Quick Look Meta 섹션 Explain 토글 → `_explanation` tree |
| 이 field 로 정렬이 왜 안 돼 | 헤더 클릭 → "text is not sortable — use `.keyword` subfield" tooltip |
| 필드가 뭐 있지 / analyzer 는 | 사이드바 → 인덱스 → Structure 탭 → Fields 서브탭 |
| domain 별 count | Aggregations 사이드 패널 → `terms("domain")` → 2-column 표 |
| 매핑 충돌 있나 (멀티 인덱스) | 컬럼 헤더 ⚠ 배지 + Fields 탭 "N indices differ" 경고 |

### 3.2 그리드 anatomy (mock)

```
┌ Time picker [Last 1h ▼]    [Lucene: level:error______] [Run]   [1,240 docs · 3 shards]
│
│  @timestamp 📅       _id    level 🔤   message 📝                        _score #
│  2026-04-24 10:30    abc    error      Payment failed for user 42        1.35
│  2026-04-24 10:28    def    error      Timeout on external API           1.21
│  2026-04-24 10:21    ghi    warn       Slow query 532ms                  1.04
│
│  · text 컬럼 📝 클릭 → tooltip "text is not sortable"
│  · _score 는 쿼리가 있을 때만 노출
│  · nested/object 셀은 {...} sentinel
```

### 3.3 Quick Look anatomy

```
┌ Highlight ──────────────────────────────────────
│ message:  "Payment failed for user 42 because <em>error</em> on gateway"
│
├ _source ────────────────────────────────────────
│ ▼ { ... }
│    @timestamp:  "2026-04-24T10:30:00Z"
│    level:       "error"
│    message:     "Payment failed ..."
│    user_id:     42
│    context:    ▼ { session: "abc", gateway: "stripe" }
│
├ Meta ───────────────────────────────────────────
│ _index:     logs-2026.04.24
│ _id:        abc123
│ _score:     1.35
│ _routing:   —
│ [ ] Show explanation
```

### 3.4 매핑 뷰 (Structure 탭 → Fields)

```
  Field path           Type           Analyzer    Doc values   Subfields
  @timestamp           date  📅       —           ✓            —
  level                keyword 🔤     —           ✓            —
  message              text  📝       standard    —            message.keyword 🔤
  user_id              long  #        —           ✓            —
  context              object 🗂      —           —            (expand ▶)
  context.session      keyword 🔤     —           ✓            —
  tags                 nested 📦      —           —            tags.name, tags.value
```

이 뷰가 Phase 7 의 숨은 핵심 — "왜 정렬 안 되지?" 의 답을 여기서 사용자가 스스로 찾는다.

### 3.5 엣지 상황 표현

| 상황 | UI 표현 |
|------|--------|
| `@timestamp` 없음 | Time picker 비활성 + tooltip "No @timestamp field detected" |
| PIT 만료 | "Session expired — refreshing..." 토스트 + 자동 재오픈 |
| mapping conflict (멀티 인덱스) | 컬럼 헤더 ⚠ 배지 + Fields 탭 "3 indices differ" 경고 |
| nested field 를 Lucene 바로 검색 시 | tooltip "Nested fields need `nested` query — right-click cell → Filter (nested)" |
| 대용량 `_source` (>1MB) | Quick Look 에 `Load {size} MB?` 확인 버튼 |

---

## 4. Redis

### 4.1 질문 → UI 매핑

| 사용자 질문 | UI 의 답 |
|------------|---------|
| `user:42` 관련 키 다 어디 있지 | SCAN 바 `user:42:*` → 그리드 + 콜론 트리 |
| 이 세션 언제 만료돼 | 그리드 TTL 컬럼 `23h 5m` 상대 시간 |
| 캐시가 왜 날아가지 | TTL 만료 임박 빨간 뱃지 + Quick Look 에 `EXPIREAT` 절대 시간 |
| hash 필드 편집 | 행 선택 → Quick Look 2-column 그리드 → 필드 더블클릭 |
| big key 찾기 | Size 컬럼 정렬 + >10MB 뱃지 |
| DB 크기 | status bar `DBSIZE: ~12,840` (approx) |
| FLUSHDB 실수하지 않게 | RAW 프롬프트 입력 → 2 단계 모달 "Type DROP to confirm — will delete {n} keys" |

### 4.2 그리드 anatomy (mock)

```
┌ DB [0 ▼]    [SCAN: user:42:*_______] [Run]      [DBSIZE: ~12,840 · cursor 0]
│
│  Key                    Type          TTL         Size     [Encoding]
│  user:42:profile        string 🧵     -1          1.2 KB   embstr
│  user:42:session        hash   🗃     23h 5m      5.1 KB   ziplist
│  user:42:queue          list   📜     5s ⚠       2 MB     quicklist
│  user:42:friends        set    🧩     -1          320 B    intset
│  user:42:scores         zset   📊     12m         2.4 KB   skiplist
│  user:42:events         stream 🌀     -1          45 MB ⚠ stream
│
│  · Type 뱃지 색상: string/hash/list/set/zset/stream 각 다름
│  · TTL "5s ⚠" → 만료 임박 빨간색
│  · Size >10MB → ⚠ big-key 뱃지 (값 지연 로드)
│  · Encoding 컬럼은 기본 숨김 (설정에서 노출)
```

### 4.3 Type-aware Quick Look (6 종)

**string** (text 자동 감지, JSON 이면 tree)
```
┌ Value (auto: JSON) ─────────────────────────────
│ ▼ { "name": "Alice", "email": "a@x.com" }
│
├ TTL:  23h 5m  (expires 2026-04-25 10:30)
│       [+30s] [+5m] [+1h] [persist] [custom...]
├ Size: 1.2 KB   Encoding: embstr
└ [Edit] [Copy plain] [Copy JSON] [Delete]
```

**hash** (field / value 2-column)
```
┌ field            value
│ token            abc...
│ issued_at        2026-04-24T10:00:00Z
│ device           mobile
│
│ ├ 더블클릭 → HSET 편집
│ ├ + 버튼 → 필드 추가
│ └ 행 우클릭 → HDEL
```

**list** (index / value)
```
┌ index | value
│ 0     | {"job":"send_email", ...}
│ 1     | {"job":"resize_image", ...}
│ ...
│ [Load more — LLEN: 1,240]
```

**set** (member)
```
┌ member
│ friend:12
│ friend:34
│ [+ SADD] [− SREM]
```

**zset** (member / score)
```
┌ member           score
│ user:1           98.5
│ user:7           92.1
│ · score 편집 → ZADD XX
```

**stream** (entry_id / fields)
```
┌ entry_id            | field1    | field2
│ 1712345678-0        | send      | user:42
│ 1712345675-0        | cancel    | user:13
│ [Load older — XRANGE - + COUNT 100]
```

### 4.4 콜론 자동 트리 (사이드바)

```
DB 0
├ user/
│  ├ 42/
│  │  ├ profile
│  │  ├ session
│  │  └ queue
│  ├ 43/
│  │  └ ...
├ session/
│  └ ...
└ (flat keys without colons)
```

depth 기본 3, 설정에서 조정. 트리는 **virtual** — Redis 에는 실제 namespace 개념이 없음을 `namespace` 뱃지로 고지.

### 4.5 엣지 상황 표현

| 상황 | UI 표현 |
|------|--------|
| Cluster 모드 | DB selector 비활성 + tooltip "Cluster uses slot 0 only" |
| SCAN 미완료 | 하단 `cursor: 1024 — Load more` 버튼 |
| TTL 편집 race (이미 만료) | "key no longer exists — refresh" 토스트 |
| `FLUSHDB` / `FLUSHALL` / `SHUTDOWN` / `DEBUG` / `CONFIG SET` | 2단계 모달: command echo → "Type DROP to confirm" input |
| `KEYS *` 입력 | RAW 프롬프트 제출 거부 + tooltip "Use SCAN pattern bar instead" |
| Big-key Quick Look (>10MB) | `Load 42 MB?` 확인 버튼, 기본은 meta 만 로드 |
| Sentinel failover 중 | spinner + "Sentinel reconfiguring..." |

---

## 5. 공유 패턴 / 재사용 표

Phase 6 에서 만든 슬롯을 Phase 7·8 이 얼마나 재사용하는지.

| 패턴 | 원천 | ES 재사용 | Redis 재사용 |
|------|------|----------|-------------|
| `{...}` / `[N]` sentinel cell | Phase 6 Mongo | ✓ (nested/object) | — (값 단일형) |
| `BsonTreeViewer` | Phase 6 Sprint 70 | ✓ (`_source`, `_explanation`) | ✓ (JSON string) |
| QueryPreview modal | Phase 5 DROP TABLE | — (DSL 은 readonly P0) | ✓ (command preview) |
| Quick Look 3 단 레이아웃 | Phase 5 | ✓ (Highlight / _source / Meta) | ✓ (Value / TTL-Size / Actions) |
| 위험 행동 확인 모달 | Phase 5 DROP TABLE | ✓ (`_update_by_query` dry-run) | ✓ (FLUSHDB/KEYS) |
| 컬럼 헤더 type 아이콘 | Phase 6 Document 필드 type | ✓ (keyword/text/date/...) | 변형 — row 단위 type 뱃지 |
| 쿼리 바 + Cmd+Return | Phase 5 | ✓ (Lucene + DSL) | ✓ (RAW command) |
| `paradigm` routing | Phase 6 Sprint 64-65 | ✓ (`search`) | ✓ (`kv`) |
| `cm-mql-operator` 같은 공유 class | Phase 6 Sprint 83·85 | (N/A) | (N/A — RAW command 은 다른 syntax) |

## 6. Paradigm 간 일급 개념 대조

| 개념 | RDB | Document | Search (ES) | KV (Redis) |
|------|-----|----------|-------------|------------|
| "테이블" 등가 | table | collection | index / data stream | DB 0-15 (혹은 key prefix) |
| "row identity" | PK | `_id` | `_index` + `_id` | key 자체 |
| schema / type | strict column types | inferred + free-form | mapping (static + runtime) | **per-key** value type |
| **시간 축** | timestamp column (암묵적) | `_id` 유추 | **`@timestamp` 일급** | TTL / expire |
| **스코어 축** | — | — | **`_score` + explain** | — |
| 검색 표현 | SQL WHERE | MQL filter | Lucene + DSL | SCAN MATCH glob |
| 페이지네이션 | OFFSET/LIMIT | skip/limit | PIT + search_after | SCAN cursor |
| 위험 행동 | DROP TABLE | deleteMany | `_delete_by_query` | FLUSHDB / KEYS |
| namespace 계층 | schema (PG) / database (MySQL) / main (SQLite) | database | cluster → index | DB (0-15) → 콜론 virtual |

## 7. 설계 의사결정 (결정된 것)

- **ES 의 time picker 는 tab 단위 state** — 여러 탭을 동시에 열고 서로 다른 range 로 조사 가능.
- **ES 의 매핑 뷰는 P0** — keyword vs text 혼란이 RDB 출신 사용자의 1차 막힘 지점.
- **ES aggregation 은 표 우선**, 차트는 P2 — "Kibana 축소판" 유혹 차단.
- **Redis 의 `KEYS *` 는 UI 에서 절대 제공하지 않음** — RAW 프롬프트 입력 시도도 가드.
- **Redis 의 SCAN cursor 는 UI 에 노출** — 증분식 탐색의 본질을 숨기지 않음.
- **Redis 의 콜론 트리는 virtual 임을 `namespace` 뱃지로 고지** — 실제 개념 오해 방지.
- **Big-key / 대용량 `_source` 는 기본 지연 로드** — 실수로 2GB 키를 클릭했을 때 UI freeze 방지.
- **위험 확인 입력 문구는 "DROP"** 으로 전 paradigm 통일 — 근육 기억 재사용.

## 8. 남은 디자인 결정

| 결정 | 담당 sprint | 잠정 |
|------|------------|-----|
| Time picker 의 relative 표기 (Last 1h 의 tick 주기) | ES-D | 15s tick, 사용자 focus 시 갱신 |
| Lucene 바의 자동완성 키 (Tab vs Enter) | ES-E | Tab = 선택, Enter = 실행 |
| TTL 편집 popover 의 기본 프리셋 | R-F | +30s / +5m / +1h / +1d / persist / custom |
| 콜론 트리 depth 설정 UI 위치 | R-B | 연결별 settings → "Key grouping depth" |
| RAW command 의 결과 자동 렌더링 규칙 | R-I | `*reply` 는 list 그리드, `$reply` 는 string viewer, `%reply` 는 hash, ... |
| 위험 커맨드 화이트리스트 설정 | R-G | 연결별 settings → "Allow unsafe commands" toggle, 기본 off |

---

**문서 버전**: 2026-04-24 초안. Phase 7·8 sprint 착수 시 각 sprint 의 execution-brief 가 이 문서를 직접 참조하며, 최종 UI 결정이 여기와 다를 경우 이 문서를 업데이트한다.
