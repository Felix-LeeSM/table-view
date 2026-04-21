# Phase 7: Elasticsearch 지원

> Search DSL 어댑터 + 인덱스/문서 뷰 — **계획**

## 배경 / 판단 기준

Elasticsearch는 RDB가 아니라 검색 엔진이지만, 실무에서는 "인덱스 = 테이블, 문서 = 행,
필드 = 컬럼" 관점으로 자주 탐색된다. TablePlus 사용자가 로그/메트릭/검색 인덱스를
조회하기 위해 별도 Kibana를 띄울 필요 없이, 동일 UI에서 인덱스 목록을 보고 `_source`를
그리드로 훑을 수 있어야 한다. DSL 전체를 노출하기보다 **"조회 가능한 그리드 + Quick Look"**
경험을 기본값으로 둔다.

## 구현 항목

| Feature | ID | 우선순위 |
|---------|-----|---------|
| ES 연결 폼 (Cloud/Self-hosted) | F1.1 확장 | P0 |
| ElasticsearchAdapter 구현 | — | P0 |
| 인덱스/데이터스트림 사이드바 트리 | F2.1 확장 | P0 |
| 문서 그리드 (`_source` 평탄화) | F3.1 확장 | P0 |
| Quick Look — 전체 `_source` + `_score` + highlights | F3.6 확장 | P0 |
| Query String 바 (Lucene syntax) | — | P0 |
| Query DSL 에디터 (JSON) | F4.1 확장 | P1 |
| 매핑(mapping) 보기 | F2.2 확장 | P1 |
| Aggregation 결과 차트 (count/sum/avg) | — | P1 |
| 문서 업데이트/삭제 | F3.2/F3.3 확장 | P2 |
| 인덱스/alias 관리 DDL | — | P2 |

## F1.1 확장: ES 연결 폼

- [ ] `ConnectionConfig.kind`에 `elasticsearch` 추가
- [ ] 모드 토글: Basic Auth / API Key / Cloud ID
- [ ] Basic Auth: URL (`https://...:9200`) + Username + Password
- [ ] API Key: URL + Base64-encoded key
- [ ] Cloud ID: Elastic Cloud deployment ID + API Key
- [ ] TLS verify 옵션 (dev 환경 off 허용, production 강제 on 경고)
- [ ] Test Connection → `GET /` 호출 후 version/cluster_name 표시

## F-ESAdapter: DbAdapter 구현

- [ ] `src-tauri/src/db/elasticsearch.rs` — `trait DbAdapter` 구현체
- [ ] `elasticsearch` Rust 크레이트 사용
- [ ] `get_tables()` → `cat/indices?format=json` + 데이터스트림 목록
- [ ] `get_schema(index)` → `GET {index}/_mapping` → field tree 변환
- [ ] `query(body)` → `POST {index}/_search` (JSON body 또는 Lucene `q`)
- [ ] `execute(body)` → `_update_by_query` / `_delete_by_query`
- [ ] 멀티 인덱스 쿼리 지원 (`logs-*`)

## F2.1 확장: 사이드바 트리

- [ ] 루트: cluster → indices / data streams / aliases
- [ ] 시스템 인덱스(`.kibana*`, `.internal*`)는 기본 숨김 + 토글
- [ ] 인덱스 노드 하위: Fields(mapping), Settings, Aliases

## F3.1 확장: 문서 그리드

- [ ] 컬럼 inference: mapping의 top-level 필드 + `_id`, `_score`, `_index`
- [ ] Nested/object 필드는 `{...}` placeholder → Quick Look
- [ ] keyword vs text 구분 뱃지 (정렬 가능 여부 힌트)
- [ ] `search_after` 기반 페이지네이션 (scroll/pit 중 PIT 선호)
- [ ] sort 클릭 시 sortable 필드만 허용 — text는 비활성화 + tooltip

## F3.6 확장: Quick Look

- [ ] `_source` JSON pretty + 접기
- [ ] `_score` / `_explanation` 섹션 (Explain 토글 시)
- [ ] highlight 결과가 있으면 상단에 fragment 렌더

## F-QueryBar: Query String / DSL

- [ ] 상단 Query String 바 — Lucene 문법 즉시 실행 (`status:200 AND path:/api/*`)
- [ ] 에디터 탭 모드 토글: Query String / DSL / SQL (`_sql` API 사용)
- [ ] DSL 모드: JSON 에디터 + `POST /{index}/_search` 미리보기
- [ ] Cmd+Return 실행

## F2.2 확장: 매핑 뷰

- [ ] 인덱스 선택 시 Structure 탭 — Fields / Settings / Aliases 서브탭
- [ ] Fields: field path, type, analyzer, doc_values
- [ ] Settings: number_of_shards/replicas, refresh_interval

## F-Aggs: Aggregation 차트

- [ ] `terms` / `date_histogram` / `avg` 결과를 바/라인 차트로
- [ ] P1 범위 — 간이 차트만, 풀 dashboard 기능은 out of scope

## F3.2/F3.3 확장: 업데이트/삭제

- [ ] Quick Look에서 JSON 에디터로 문서 편집 → Preview → `POST {index}/_update/{id}`
- [ ] 단일 문서 삭제 → `DELETE {index}/_doc/{id}`
- [ ] 대량 업데이트는 `_update_by_query` 모달에서만 (오작동 방지)

## Phase 완료 기준

- [ ] 로컬 ES 컨테이너(8.x) 연결 → 인덱스 탐색 → 문서 그리드 렌더
- [ ] Lucene 쿼리 바에서 `foo:bar` 입력 → 결과 그리드 필터링
- [ ] Mapping 뷰에서 필드 타입 확인 → sort/filter에 반영
- [ ] 기존 RDB 테스트 회귀 없음
- [ ] `docker-compose.test.yml`에 elasticsearch 서비스 추가 + `cargo test --test es_integration`
- [ ] 단위 테스트: ElasticsearchAdapter mock — `_search` body 생성, `_cat/indices` 파싱

## 검증

1. `docker compose -f docker-compose.test.yml up -d` (es 포함, single-node + security off)
2. 앱 실행 → ES 연결 생성 → `logs-*` 인덱스 탐색
3. Query String 바에 `level:error` → 결과 그리드 확인
4. Quick Look에서 `_source` + `_score` 정상 표시

## 범위 밖

- Kibana Dashboards 임포트
- Ingest Pipeline 편집
- SIEM / Security 전용 뷰
- Vector Search / ML 기능
- Kafka/Logstash 등 ingest 도구 연동
