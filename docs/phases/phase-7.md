# Phase 7: Elasticsearch 지원

> Search DSL 어댑터 + 로그/검색 운영자 경험 — **계획 v2 (2026-04-24 재설계)**

## 배경 / 판단 기준

ES는 RDB가 아니라 검색 엔진이고, TablePlus식 툴로 ES를 여는 사용자는 대부분 **로그/검색 운영자**다. 질문 패턴이 RDB와 다르게 세 축으로 수렴한다:

1. **"이 시점에 뭐가 있었나"** — time-range + 텍스트 검색 + `_source` 훑기. Kibana Discover의 80%.
2. **"이게 왜 매칭됐나 / 왜 이 순위인가"** — `_score`, `highlight`, `explain`. 검색 품질 디버깅.
3. **"이 field가 뭐로 들어가 있나 / 왜 정렬·필터가 안 되나"** — keyword vs text, analyzer, nested 구조. 매핑 점검.

Phase 7 P0의 성공 기준은 **"Discover 핵심 3"** 으로 고정한다:

- `@timestamp` **time picker** (시간 축)
- field type 아이콘이 붙은 **`_source` 그리드** (매핑 인식)
- highlight 스니펫 + `_explanation` 이 있는 **Quick Look** (검색 품질 디버깅)

"인덱스=테이블, 문서=행" 1:1 매핑은 유지하되 **시간 축과 스코어 축을 일급**으로 취급한다. Kibana 전체(dashboards/SIEM/Vector Search)는 범위 밖 — Lucene 바 + time picker + 정렬·필터 가능 컬럼 헤더로 90%를 덮는다.

## 전제(Phase 6에서 갖춰진 것)

- `DbAdapter`/`SearchAdapter` trait 계층은 Sprint 63에서 선언만 됨 — 이 Phase에서 채움.
- `ActiveAdapter::Search(Box<dyn SearchAdapter>)` enum variant 는 존재.
- 문서 그리드 / `{...}` sentinel / BsonTreeViewer / Quick Look 패턴은 Phase 6 에서 구축 → 재사용.

## 구현 항목

| Feature | ID | 우선순위 | 비고 |
|---------|----|---------|------|
| ES 연결 폼 (Basic / API Key / Cloud ID) | F1.1 확장 | P0 | |
| ElasticsearchAdapter 구현 (`impl SearchAdapter`) | — | P0 | PIT + `search_after` |
| Data stream / Indices / Aliases 사이드바 | F2.1 확장 | P0 | data stream을 별 묶음 |
| **매핑 뷰 + field type 아이콘** | F2.2 확장 | **P0** | "왜 정렬 안되지?" 차단 — P1에서 승격 |
| **`@timestamp` time picker (상단 range bar)** | — | **P0** | Phase 7 고유 P0, Discover 핵심 #1 |
| 문서 그리드 (`_source` 평탄화 + `_score`/`_id`/`_index`) | F3.1 확장 | P0 | Discover 핵심 #2 |
| Lucene Query String 바 + field 자동완성 | — | P0 | `status:200 AND path:/api/*` |
| Quick Look: highlight 상단 + `_source` tree + Explain | F3.6 확장 | P0 | Discover 핵심 #3 |
| Query DSL 에디터 (JSON CodeMirror) | F4.1 확장 | P1 | |
| Aggregation **표** (terms / date_histogram → 2-column grid) | — | P1 | RDB GROUP BY 감각, 차트는 P2 |
| Nested field 컨텍스트 메뉴 (nested query 자동 생성) | — | P1 | |
| 문서 단건 편집·삭제 (`_update` / `_doc` DELETE) | F3.2/F3.3 확장 | P2 | |
| `_update_by_query` / `_delete_by_query` (dry-run 필수) | — | P2 | |
| 인덱스·alias 관리 DDL | — | P2 | |
| Aggregation 차트 (bar/line) | — | P2 | |

## Discover 핵심 3 (Phase 7 P0 정책)

세 경험이 끊기면 Phase 7은 실패로 본다.

### #1. Time picker — 상단 range bar
- 프리셋: Last 15m / 1h / 4h / 12h / 24h / 7d / 30d / Custom (absolute ISO range)
- data stream 또는 `@timestamp` field 감지된 인덱스에서만 활성; 그 외 disabled + tooltip
- 선택 range → 모든 쿼리 body 의 `bool.filter` 에 `range.@timestamp` 주입
- 기본 정렬 `@timestamp desc`, range 변경 시 300ms debounce 재실행

### #2. `_source` 그리드 — field type 인식
- 기본 컬럼: `@timestamp` 첫 고정 / `_id` / top-level source fields / `_score`(쿼리 있을 때만)
- 각 헤더에 field type 아이콘: **keyword / text / date / geo / nested / object / number / ip / boolean** (12종, 나머지는 텍스트 뱃지)
- `text` 컬럼은 sort 클릭 비활성 + tooltip "text field is not sortable — use `.keyword` subfield if present"
- nested/object 는 `{...}` sentinel (Mongo 재사용)
- PIT + `search_after` 페이지네이션 (scroll deprecated)

### #3. Quick Look — 검색 품질 디버깅
- **상단**: highlight fragments (검색 시 `<em>...</em>` → Tailwind 배경색). field path 레이블. fragment 없으면 섹션 숨김.
- **중간**: `_source` JSON tree — `BsonTreeViewer` 재사용.
- **하단**: Meta (`_index`, `_id`, `_score`, `_routing`). Explain 토글 ON 시 `_explanation` 재귀 tree.
- 값 복사: plain / JSON / field path.

## F1.1 확장: ES 연결 폼

- `ConnectionConfig.kind = "elasticsearch"` variant (Phase 9 의 variant 구조 가정)
- 모드 토글: Basic Auth / API Key / Cloud ID
  - Basic: URL (`https://...:9200`) + Username + Password
  - API Key: URL + Base64 key
  - Cloud ID: Cloud deployment ID + API Key
- TLS verify 옵션 (dev off 허용, production 강제 on 경고)
- `http(s)://...` URI import
- Test Connection → `GET /` → cluster_name / version / `@timestamp` 감지 여부 노출

## F-ESAdapter: SearchAdapter 구현

- `src-tauri/src/db/elasticsearch.rs`
- `elasticsearch-rs` (공식) 또는 `reqwest` 직접
- 필수 메서드:
  - `list_indices()` → `_cat/indices?format=json` + `_data_stream` + `_alias`
  - `get_mapping(index)` → `_mapping` → field tree (type/analyzer/subfields/runtime)
  - `search(index, body, time_range?)` → `POST {index}/_search`, `time_range` 가 있으면 `bool.filter.range.@timestamp` 자동 주입
  - `search_page(pit_id, body)` → `search_after` 페이지네이션
  - `explain(index, id, body)` → `POST {index}/_explain/{id}`
  - `update_doc(index, id, patch)` / `delete_doc(index, id)`
- 큰 `_source` (>1MB) lazy loading — Quick Look 열 때만 fetch
- PIT TTL 만료 시 재오픈 로직
- 멀티 인덱스 쿼리 (`logs-*`) — mapping conflict 시 첫 매핑 기준 + warning badge

## F2.1: 사이드바

- 루트: cluster → **Data streams** / **Indices** / **Aliases** 세 묶음
- data stream 은 backing index(`.ds-...`) 숨김, 쓰기/읽기 포인트 표시
- 시스템 인덱스(`.kibana*`, `.internal*`, `.security-*`) 기본 숨김 + 토글
- 인덱스 노드 하위: **Fields** / **Settings** / **Aliases** 서브탭
- date-based index(`logs-2026.04.*`) 는 패턴 그룹화 힌트

## F2.2: 매핑 뷰 (P0 승격)

**Phase 7 의 숨은 핵심.** keyword vs text 를 이해 못 하면 사용자가 "왜 정렬 안 되지" 로 막힌다.

- Structure 탭 → Fields / Settings / Aliases 서브탭
- **Fields**: field path(nested 는 들여쓰기) / type 뱃지+아이콘 / text 의 `.keyword` subfield 노출 / analyzer 이름 / doc_values / runtime field 표시
- **Settings**: shards / replicas / refresh_interval / ILM policy / docs count / store size
- **Aliases**: 이 인덱스가 소속된 alias 목록

## F-TimePicker: `@timestamp` range bar

- 컴포넌트 `<TimeRangePicker>` — tab 단위 state (`TableTab.esTimeRange?`)
- 프리셋 + Custom(absolute)
- `@timestamp` 미감지 인덱스는 bar 자체 비활성
- range 변경 → debounce 300ms → 쿼리 재실행
- Cluster-level 뷰(인덱스 목록)는 bar 숨김

## F-QueryBar: Lucene 바 + DSL (P0 / P1)

- **P0**: 상단 Lucene 바 — `status:200 AND path:/api/*` — Enter 즉시 실행 — mapping 기반 field 자동완성
- **P1**: DSL 에디터 (JSON CodeMirror) — 탭 토글로 전환, `POST /{index}/_search` 미리보기
- Cmd+Return 실행 (Phase 6 의 existing shortcut)
- Lucene 문법이 nested 를 커버하지 않는 한계는 nested 필드 검색 시 tooltip 으로 고지 → 우클릭 "Filter (nested)" 경로 안내

## F-Nested: nested query 자동 생성 (P1)

- 그리드 cell 우클릭 → "Filter by this value (nested query)"
- nested query DSL 자동 생성: `{"nested": {"path": "...", "query": {...}}}`
- 상단 Lucene 바에는 주입 불가 — DSL 모드로 자동 전환

## F-Aggs: Aggregation 표 (P1)

RDB GROUP BY 감각으로 재포지션 — 차트가 아니라 **표 우선**.

- 쿼리 탭의 "Aggregations" 사이드 패널
- `terms` → 2-column 그리드 (key / doc_count + optional sub-metric)
- `date_histogram` → buckets 표 (bucket start / doc_count)
- 중첩 aggregation 은 tree 구조
- P2: bar/line 차트 토글

## F3.2/F3.3: 편집 (P2)

- Quick Look JSON 에디터 → Preview → `POST {index}/_update/{id}`
- 단일 삭제 → `DELETE {index}/_doc/{id}`
- 대량 mutate 는 `_update_by_query` / `_delete_by_query` 모달 + **dry-run 필수** (`count: true` 로 영향 문서 수 먼저 표시)

## 위험 & 트레이드오프

- **SearchAdapter trait 범위**: "search + mapping + mutate" 3 축으로 좁힌다. cluster health / ILM / reindex 는 adapter 확장 메서드 (Phase 7 범위 밖 / 별 sprint).
- **Time picker 상태 위치**: tab 단위가 자연스러움 — `TableTab` 확장. Cluster-level 뷰는 비활성.
- **Kibana 경계**: aggregation 차트 / 시각화는 P2 로 잘라 "Kibana 대체 아님" 명확화. Phase 7 = "Discover + 매핑 점검기".
- **Field type 아이콘 유지보수**: ES type 20+ 종 — 자주 쓰는 12 종만 아이콘, 나머지 텍스트 뱃지 fallback.
- **PIT TTL**: 페이지 오래 열면 만료 → 재오픈 로직 + 사용자 silent retry.
- **멀티 인덱스 mapping conflict**: `logs-*` 에서 동일 field 가 인덱스마다 다른 type. 첫 매핑 기준 + warning 배지 + Fields 뷰에서 conflict 상세.
- **Security**: secret 저장은 기존 `password_store` 재사용, API Key 는 별도 필드 카테고리.
- **Lucene nested 한계**: 사용자가 nested field 를 Lucene 바로 검색하면 잘못된 결과 — tooltip + 우클릭 nested 메뉴로 유도.

## 검증

각 스프린트 공통:
- `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --lib` + ES integration test (`cargo test --test es_integration`)
- `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`

Phase 전체 — **"Discover 핵심 3"** 수동 smoke:
1. `docker compose -f docker-compose.test.yml up -d elasticsearch` (8.x single-node, security off)
2. seed: `logs-*` data stream 에 샘플 로그 주입 (`level`, `message`, `@timestamp`)
3. 앱 → ES 연결 → `logs-*` 선택
4. **#1 Time picker**: "Last 1h" → 그리드 필터링 확인, disabled 케이스(키-값 인덱스) 확인
5. **#2 `_source` 그리드**: `@timestamp desc` 기본 정렬, keyword/text 아이콘, text sort 비활성 tooltip, `.keyword` subfield 힌트
6. **#3 Quick Look**: Lucene `message:error` → 행 선택 → highlight fragment 상단, Explain 토글 → `_explanation` tree
7. Mapping 뷰 → field type / analyzer / subfields
8. 기존 RDB/Mongo 회귀 0
9. 단위 테스트: search body 생성(range 주입), `_cat/indices` 파싱, mapping → field tree, nested query 생성, PIT 재오픈

## 스프린트 분해(초안)

Phase 6 규모 참고 — 10 sprint 전후 예상.

1. **ES-A** — `ConnectionConfig::kind = "elasticsearch"` variant, Basic/API Key/Cloud ID 3 모드, `test_connection`, docker-compose ES + fixture + integration 테스트 인프라. `SearchAdapter` 의 `ping` / `list_indices` 구현.
2. **ES-B** — `get_mapping`, Data stream/Indices/Aliases 분류, Structure 탭(Fields/Settings/Aliases). **매핑 뷰 P0**.
3. **ES-C** — `_source` 그리드 + 컬럼 inference + field type 아이콘 + text sort 비활성. `search_after` 페이지네이션.
4. **ES-D** — `<TimeRangePicker>` 컴포넌트, `@timestamp` 감지, range 주입, tab state. **Discover #1 완결**.
5. **ES-E** — Lucene Query String 바 + field 자동완성, Cmd+Return. **검색 가능 상태**.
6. **ES-F** — Quick Look: highlight 상단, Explain 토글, `_explanation` tree, `_source` BsonTreeViewer 재사용. **Discover 핵심 3 완결**.
7. **ES-G** — DSL 에디터(JSON CodeMirror) + Aggregation 표(terms/date_histogram).
8. **ES-H** — Nested 컨텍스트 메뉴 + nested query 자동 생성 + Lucene 한계 tooltip.
9. **ES-I** — 문서 단건 편집(`_update`) + 삭제(`_doc` DELETE) + Quick Look JSON 편집 경로.
10. **ES-J** — `_update_by_query` / `_delete_by_query` dry-run 모달 + 인덱스·alias 관리 DDL.

Phase 7 전체: 10 sprint 예상. Phase 8(Redis) 와 독립 — Phase 6 완료 후 어느 쪽부터 착수해도 무방.

## 범위 밖

- Kibana Dashboards 임포트 / 시각화 빌더
- Ingest Pipeline 편집
- SIEM / Security 전용 뷰
- Vector Search / ML (kNN, inference)
- Cross-cluster search / Snapshot·Restore / ILM policy 편집
- SQL API (`_sql`) — 별도 sprint 후보
- Kafka/Logstash 등 ingest 도구 연동
