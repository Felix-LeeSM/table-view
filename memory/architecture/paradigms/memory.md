---
title: Paradigm UI Map (RDB / Document / Search / KV)
type: memory
updated: 2026-04-30
---

# Paradigm UI Map — RDB / Document / Search / KV

> Phase 7(Elasticsearch) · Phase 8(Redis) 사전 설계 spec.
> 흡수 출처: 구 `docs/paradigm-ui-map.md` (2026-04-24, 292줄). 본 압축본은 핵심 결정·slot 비교·일급 개념 대조만 보존. ASCII mock(그리드/Quick Look 시각 예시)은 손실됨 — 필요 시 git history에서 복원 (`git show <hash>:docs/paradigm-ui-map.md`).

## 1. 공통 원칙

- **질문 → Slot 매핑이 설계 출발점**: "이런 feature"가 아니라 "사용자가 이런 질문을 할 때 이 slot을 본다".
- **Paradigm 일급 개념은 UI에 그림자**: RDB=`column type`, Document=`{...} sentinel`, ES=`@timestamp`+`_score`, Redis=`TTL`+`Type`.
- **기존 slot 재사용 > 신규 slot**. Phase 6 사이드바/그리드/Quick Look/Preview modal 패턴 재사용.
- **위험 행동은 paradigm 공통 확인 모달**: DROP TABLE / deleteMany / `_update_by_query` / FLUSHDB가 같은 모달 유형. 입력 문구는 **"DROP"** 으로 전 paradigm 통일 (근육 기억 재사용).

## 2. UI Slot 4-paradigm 비교

| Slot | RDB | Document | Search (ES) | KV (Redis) |
|------|-----|----------|-------------|-----------|
| 사이드바 root | database → schema → table | database → collection | cluster → data streams/indices/aliases | DB 0-15 → 콜론 가상 트리 |
| 사이드바 leaf | table | collection | index (+Fields/Settings/Aliases) | key namespace group |
| **상단 바 #1** | — | — | **`@timestamp` time picker** | **`SCAN MATCH` 바** |
| **상단 바 #2** | SQL editor | MQL editor | Lucene + DSL 토글 | RAW command 프롬프트 |
| 그리드 컬럼 | schema column | top-level field | `_source` top + `@timestamp`/`_id`/`_score`/`_index` | Key/Type/TTL/Size/Encoding |
| 컬럼 헤더 아이콘 | SQL type | BSON type | keyword/text/date/geo/nested/number/ip/boolean/object | row 단위 type 뱃지 |
| 셀 sentinel | — | `{...}` / `[N items]` | 동일 (Mongo 재사용) | — |
| **Quick Look 본체** | row field list | `BsonTreeViewer` (full doc) | Highlight + `_source` tree + Meta(Explain) | type-aware viewer (6종) |
| Status bar | row count | doc count | docs count + shards | `DBSIZE` (approx) + SCAN cursor |
| Danger | DROP TABLE | deleteMany | `_update_by_query`/`_delete_by_query` dry-run | FLUSHDB/FLUSHALL/KEYS |

핵심 차이:
- 상단 바 #1은 ES/Redis에만 존재 — 각 paradigm의 일급 탐색 축.
- Quick Look이 paradigm마다 가장 다르게 생김 — "행=정보 한 단위"가 다름.

## 3. Paradigm 일급 개념 대조

| 개념 | RDB | Document | Search (ES) | KV (Redis) |
|------|-----|----------|-------------|-----------|
| "테이블" 등가 | table | collection | index/data stream | DB 0-15 (또는 key prefix) |
| row identity | PK | `_id` | `_index`+`_id` | key 자체 |
| schema/type | strict column types | inferred + free-form | mapping (static+runtime) | **per-key** value type |
| **시간 축** | timestamp column (암묵) | `_id` 유추 | **`@timestamp` 일급** | TTL/expire |
| **스코어 축** | — | — | **`_score`+explain** | — |
| 검색 표현 | SQL WHERE | MQL filter | Lucene + DSL | SCAN MATCH glob |
| 페이지네이션 | OFFSET/LIMIT | skip/limit | PIT + search_after | SCAN cursor |
| namespace | schema(PG)/database(MySQL)/main(SQLite) | database | cluster→index | DB(0-15)→콜론 virtual |

## 4. Elasticsearch 핵심

질문 → UI:
- "지난 1시간에 뭐 있었지" → 상단 time picker `Last 1h`
- "error만" → Lucene 바 `level:error`
- "이거 왜 매칭됐지" → Quick Look 상단 highlight fragment
- "순위가 왜 이래" → Quick Look Meta → Explain 토글 (`_explanation` tree)
- "이 field 정렬이 왜 안 돼" → 헤더 클릭 → tooltip "use `.keyword` subfield"
- "필드/analyzer 뭐지" → Sidebar → 인덱스 → Structure → Fields 서브탭
- "domain 별 count" → Aggregations 사이드 패널 → terms

Quick Look 3단: **Highlight / `_source` tree / Meta (Explain 토글)**.

매핑 뷰 (Phase 7 숨은 핵심): Field path / Type 아이콘 / Analyzer / Doc values / Subfields. "왜 정렬 안 되지?"의 답을 사용자가 스스로 찾는다.

엣지: `@timestamp` 없음 → time picker 비활성 + tooltip / PIT 만료 → 자동 재오픈 / mapping conflict → 컬럼 헤더 ⚠ + Fields 탭 "N indices differ" / 대용량 `_source`(>1MB) → `Load N MB?` 확인.

## 5. Redis 핵심

질문 → UI:
- "user:42 키 어디" → SCAN `user:42:*` + 콜론 트리
- "이 세션 언제 만료" → TTL 컬럼 상대 시간
- "캐시 왜 날아가" → TTL 만료 임박 빨간 뱃지 + Quick Look `EXPIREAT` 절대 시간
- "hash 필드 편집" → Quick Look 2-column 그리드 → 더블클릭
- "big key" → Size 정렬 + >10MB ⚠ 뱃지
- "FLUSHDB 실수 방지" → 2단계 모달 `Type DROP to confirm — will delete N keys`

Type-aware Quick Look 6종:
- **string**: 자동 JSON 감지, JSON이면 tree, TTL 프리셋(+30s/+5m/+1h/persist)
- **hash**: field/value 2-column, 더블클릭=HSET, +버튼=필드 추가, 우클릭=HDEL
- **list**: index/value, `[Load more — LLEN: N]`
- **set**: member 단일 컬럼, `[+SADD] [-SREM]`
- **zset**: member/score, score 편집=ZADD XX
- **stream**: entry_id/fields, `[Load older — XRANGE - + COUNT 100]`

콜론 자동 트리 (사이드바): depth 기본 3, **virtual** — Redis에 namespace 개념 없음을 `namespace` 뱃지로 고지.

엣지: Cluster 모드 → DB selector 비활성 / SCAN 미완료 → cursor `Load more` / `KEYS *` 입력 → RAW 거부 + tooltip / Big-key Quick Look(>10MB) → 기본 meta만 로드 / Sentinel failover → spinner.

## 6. 공유 패턴 (Phase 6 → Phase 7·8 재사용)

| 패턴 | 원천 | ES | Redis |
|------|------|-----|-------|
| `{...}`/`[N]` sentinel | Phase 6 Mongo | ✓ (nested/object) | — |
| `BsonTreeViewer` | Sprint 70 | ✓ (`_source`, `_explanation`) | ✓ (JSON string) |
| QueryPreview modal | Phase 5 DROP | — (DSL readonly P0) | ✓ (command preview) |
| Quick Look 3단 | Phase 5 | ✓ | ✓ |
| 위험 확인 모달 | Phase 5 DROP | ✓ (`_update_by_query` dry-run) | ✓ (FLUSHDB) |
| 컬럼 헤더 type 아이콘 | Phase 6 | ✓ | row 단위 type 뱃지로 변형 |
| 쿼리 바 + Cmd+Return | Phase 5 | ✓ (Lucene+DSL) | ✓ (RAW) |
| `paradigm` routing | Sprint 64-65 | `search` | `kv` |

## 7. 결정된 의사결정 (Frozen)

- ES time picker는 **tab 단위 state** — 여러 탭 동시 다른 range 조사.
- ES 매핑 뷰는 **P0** — keyword vs text 혼란이 RDB 출신의 1차 막힘.
- ES aggregation은 **표 우선**, 차트는 P2 — Kibana 축소판 유혹 차단.
- Redis `KEYS *`는 **UI에서 절대 제공 안 함** — RAW 입력 시도도 가드.
- Redis SCAN cursor는 **UI 노출** — 증분식 본질 숨기지 않음.
- Redis 콜론 트리는 **virtual임을 `namespace` 뱃지로 고지**.
- Big-key/대용량 `_source`는 **기본 지연 로드** — 2GB 키 클릭 시 freeze 방지.
- 위험 확인 입력 문구 **"DROP"** 으로 전 paradigm 통일.

## 8. 남은 디자인 결정

| 결정 | 담당 sprint | 잠정 |
|------|------------|------|
| Time picker relative tick 주기 | ES-D | 15s tick, focus 시 갱신 |
| Lucene 자동완성 (Tab vs Enter) | ES-E | Tab=선택, Enter=실행 |
| TTL 편집 popover 프리셋 | R-F | +30s/+5m/+1h/+1d/persist/custom |
| 콜론 트리 depth 설정 위치 | R-B | 연결별 settings |
| RAW command 결과 자동 렌더 규칙 | R-I | `*reply`=list, `$reply`=string, `%reply`=hash |
| 위험 커맨드 화이트리스트 | R-G | 연결별 settings, 기본 off |

## 관련 방

- [architecture](../memory.md) — 시스템 구조 인덱스
- [roadmap](../../roadmap/memory.md) — Phase 7·8 시점 확인
- [conventions](../../conventions/memory.md) — Rust/TS 컨벤션
