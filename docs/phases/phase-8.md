# Phase 8: Redis 지원

> KV 어댑터 + 키 스페이스 뷰 — **계획 v2 (2026-04-24 재설계)**

## 배경 / 판단 기준

Redis 를 TablePlus-style 툴에서 여는 사람은 대부분 **캐시 / 세션 / 레이트리밋 운영자**다. row/column 개념이 없고 key → value(string/hash/list/set/zset/stream) 구조이지만, 사용자의 질문 패턴이 네 축으로 수렴한다:

1. **"이 키 있나 / 무슨 값이지"** — `GET` / `HGETALL` / `LRANGE`. RDB "row 클릭" 과 동일 빈도.
2. **"키가 몇 개이고 어떤 패턴이 있지"** — `DBSIZE` + `SCAN MATCH user:*`. 관용적 디버깅.
3. **"이 키가 언제 사라지지 / 왜 사라졌지"** — TTL 확인, 만료 임박 감지. **캐시 디버깅 핵심**.
4. **"메모리 어디에 쓰이지 / 이거 고치면 뭐가 망가지지"** — key size, big-key 탐지, 값 편집 preview. 운영 안전.

Phase 8 P0 성공 기준은 **"Redis 운영자 핵심 3"** 으로 고정한다:

- **Pattern 중심 네비** — 상단 `SCAN MATCH` 바 + DB 0-15 selector + 콜론(`:`) 자동 트리
- **Type-aware Quick Look** — string / hash / list / set / zset / stream 각 전용 뷰어
- **TTL + Size 가 일급 컬럼** — 그리드에서 즉시 보이고, TTL 편집은 행동 한 번

**비협상 원칙**: `KEYS *` 금지 — 전부 `SCAN` 으로. 위험 커맨드 (`FLUSHALL`/`FLUSHDB`/`SHUTDOWN`/`DEBUG`/`CONFIG SET`) 는 2단계 확인 후 실행. 실무 악몽 방지가 UX 디자인에 우선한다.

## 전제(Phase 6에서 갖춰진 것)

- `DbAdapter`/`KvAdapter` trait 계층 Sprint 63 에서 선언만 됨 — 이 Phase 에서 채움.
- `ActiveAdapter::Kv(Box<dyn KvAdapter>)` variant 존재.
- Sidebar / grid / Quick Look / context menu / Preview modal 패턴은 Phase 6 에서 구축 → 재사용.

## 구현 항목

| Feature | ID | 우선순위 | 비고 |
|---------|----|---------|------|
| Redis 연결 폼 (Standalone / Sentinel / Cluster) | F1.1 확장 | P0 | |
| RedisAdapter 구현 (`impl KvAdapter`) | — | P0 | `redis-rs` async |
| DB(0-15) selector + 콜론 자동 트리 사이드바 | F2.1 확장 | P0 | |
| **SCAN MATCH 패턴 검색 바** | — | **P0** | `KEYS *` 금지 — SCAN 강제 |
| 키 그리드 (Key / Type / TTL / Size / Encoding) | F3.1 확장 | P0 | Discover 핵심 #2 와 같은 "일급 컬럼" 정책 |
| **Type-aware Quick Look (6 종)** | F3.6 확장 | **P0** | string/hash/list/set/zset/stream |
| **TTL 편집 (인라인 + 행동 한 번)** | — | **P0** | expire / persist / expireat |
| **위험 커맨드 가드** | — | **P0** | 2단계 확인 + 비활성 프리셋 |
| Value 편집 (string / hash field / list index / zset score) | F3.2 확장 | P1 | type 별 편집 경로 |
| 키 관리 (Add / Delete / Rename / Copy / Dump) | F3.3 확장 | P1 | Rename 크로스 DB 경고 |
| RAW command 프롬프트 | F4.1 확장 | P1 | 자동완성 + 위험 가드 |
| Big-key 경고 (size > 10MB) | — | P1 | 그리드 행 뱃지 + Quick Look 지연 로딩 |
| Stream 탐색 (XRANGE 최근 N) | — | P2 | |
| PUB/SUB 모니터링 (실시간) | — | P2 | 이력 저장 안 함 |
| Cluster slot / node 뷰 | — | P2 | |
| RedisJSON 모듈 감지 + 전용 뷰어 | — | P2 | |

## Redis 핵심 3 (Phase 8 P0 정책)

### #1. Pattern 중심 네비
- **DB 0-15 selector** — 상단 좌측 드롭다운. Cluster 모드 시 비활성 + tooltip "Cluster uses slot 0 only".
- **SCAN MATCH 바** — 상단 중앙. `user:*`, `session:*:token` 등 glob 패턴. Enter 즉시 실행.
- **Cursor 표시 + "Load more"** — SCAN 이 incremental 함을 UI 로 노출. 한 번에 페이지(100) 만 가져옴.
- **콜론 자동 트리** — `user:1:profile`, `user:1:session` → 사이드바에 `user / 1 / {profile, session}` 가상 폴더. depth 는 설정(기본 3).
- **`DBSIZE`** 는 status bar 에만 숫자로 표시; `KEYS *` 버튼 존재하지 않음.

### #2. Type-aware Quick Look
각 Redis value type 별 전용 뷰어. 그리드에서 행 선택 시 즉시 렌더.

- **string**: text 자동 감지. JSON 이면 pretty-print + tree (BsonTreeViewer 재사용). plain text 는 monospace. 값 크기 뱃지(`1.2 KB`).
- **hash**: 2-column 그리드 (field / value). field 컬럼 정렬·검색 가능. 행 더블클릭 → `HSET` 편집.
- **list**: (index / value) 표. 페이지네이션(기본 100). `LPUSH`/`RPUSH`/`LSET` 버튼.
- **set**: (member) 1-column 표. `SADD` / `SREM` 추가·삭제.
- **zset**: (member / score) 2-column 표. score 기준 정렬, score 편집 → `ZADD`.
- **stream**: (entry id / fields...) 표. `XRANGE - + COUNT 100` 기본, "Load older" / "Load newer".

공통: 값 복사(plain / JSON / Redis command), TTL 섹션(상대/절대 시간), Size + Encoding, 우클릭 Delete/Rename/TTL.

### #3. TTL + Size 일급 컬럼
- **TTL**: "-1 (persist)" / "23h 5m" / "2s (expiring)" / "expired". 5초 이내 만료 임박은 빨간 뱃지.
- **Size**: `OBJECT ENCODING` + serialized size (`MEMORY USAGE`). 10MB 초과는 big-key 경고 뱃지.
- **Encoding**: 고급 사용자 전용 컬럼 — 기본 숨김, 설정에서 노출(`intset` / `ziplist` / `quicklist` / `hashtable` / `skiplist`).
- **TTL 인라인 편집** — TTL 셀 더블클릭 → "+30s / +5m / +1h / persist / custom" 프리셋 popover. 확정 시 `EXPIRE` / `PERSIST` / `EXPIREAT`.

## F1.1 확장: Redis 연결 폼

- `ConnectionConfig.kind = "redis"` variant
- 모드 토글: **Standalone** / **Sentinel** / **Cluster**
  - Standalone: Host / Port(6379) / Username(ACL, optional) / Password / DB(0)
  - Sentinel: master name + sentinels 배열(host/port 리스트) + auth
  - Cluster: seed nodes 리스트 + auth
- TLS 옵션 (`rediss://`)
- `redis://...` / `rediss://...` URI import
- Test Connection → `PING` → `INFO server` 의 `redis_version` / `redis_mode` / `tcp_port` 노출

## F-RedisAdapter: KvAdapter 구현

- `src-tauri/src/db/redis.rs`
- `redis-rs` (async, tokio) 또는 `fred`
- "schema" 개념 없음 — `list_keys(db, pattern, cursor)` 가 "테이블 리스트" 역할 (SCAN cursor 기반, 페이지 단위).
- `get_key_meta(db, key)` → type / ttl / size / encoding (SCAN 후 개별 조회는 `TYPE`/`TTL`/`OBJECT ENCODING`/`MEMORY USAGE` 파이프라인).
- Type 별 조회:
  - string: `GET`
  - hash: `HGETALL` (큰 hash 는 `HSCAN`)
  - list: `LRANGE 0 99` + `LLEN`
  - set: `SMEMBERS` (큰 set 은 `SSCAN`)
  - zset: `ZRANGE WITHSCORES`
  - stream: `XRANGE - + COUNT N`
- Write:
  - `SET` / `HSET` / `LSET` / `SADD` / `SREM` / `ZADD` / `XADD` / `DEL` / `RENAME` / `EXPIRE` / `PERSIST`
- RAW command passthrough — 단 위험 목록 가드.
- 큰 value (`MEMORY USAGE` > 10MB) lazy — 그리드에는 size 뱃지만, Quick Look 열 때 실 데이터 로드 + "Load {size} MB?" 확인.

## F2.1: 사이드바 트리

- 루트: 연결 → **DB 0-15** (Standalone/Sentinel) 또는 **Cluster** 단일 노드
- DB 하위: 콜론 자동 가상 폴더 (depth 기본 3, 설정 가능)
- 폴더 아이콘은 RDB schema 와 다르게 `namespace` 뱃지 — 실제 Redis 개념 아님을 UI 로 고지
- 우클릭: "Expand all" / "Copy prefix" / "Delete all matching"(위험 가드)

## F-Scan: SCAN 바

- 상단 input — placeholder `pattern (e.g. user:*)`
- Enter → SCAN 시작 (cursor = 0, COUNT 100)
- 결과 그리드 하단에 "cursor: {n} — Load more" 버튼
- 사용자가 `*` 만 입력 → 경고 tooltip "Matching all keys may be slow on large DBs. Prefer a prefix."
- Cmd+K 로 focus

## F-Risk: 위험 커맨드 가드

- 목록: `FLUSHALL`, `FLUSHDB`, `KEYS`, `SHUTDOWN`, `DEBUG`, `CONFIG SET`, `CLUSTER RESET`, `REPLICAOF NO ONE`, `SCRIPT FLUSH`
- 접근 경로 2 가지: RAW command 프롬프트, 우클릭 컨텍스트
- 실행 전 모달: command echo + 영향 범위 ("FLUSHDB — {DBSIZE} keys will be deleted") + "DROP" 입력 확인 (생산 DB 보호)
- RAW 프롬프트에서 입력하면 자동완성이 아예 suggest 하지 않음; 타이핑은 가능하되 제출 시 가드.

## F3.2 / F3.3: Value 편집 + 키 관리 (P1)

- **string**: Quick Look 인라인 편집 → Preview modal (old vs new, byte delta) → `SET`
- **hash**: 필드 셀 더블클릭 → inline → Preview (changed fields 표) → `HSET` / `HDEL` 묶음
- **list**: index 셀 편집 → `LSET`
- **set**: 추가/제거 UI → `SADD`/`SREM`
- **zset**: score 편집 → `ZADD XX`
- **Add Key**: 모달 → type 선택 → 초기값 입력 → Preview command → 실행
- **Rename**: DB 내부 → `RENAME`; 크로스 DB → `DUMP` + `RESTORE` 경고 + atomic 아님 고지
- **Copy**: Cmd+C on row → key 이름만 복사; Cmd+Shift+C → value + command 형태 복사

## F4.1: RAW command 프롬프트 (P1)

- 쿼리 탭의 single-line input (multi-line 지원)
- mongo editor 와 같은 CodeMirror 사용 (monospace)
- 자동완성: 자주 쓰는 200 커맨드 + 현재 DB 의 키 prefix
- 결과: type 별 표로 자동 렌더링
- 위험 커맨드는 자동완성에서 제외 + 제출 시 F-Risk 가드 통과 필수

## 위험 & 트레이드오프

- **`KEYS` 금지 원칙의 엄격성**: 사용자가 불편을 느낄 수 있으나, 생산 DB 를 막기 위해 비협상. RAW 프롬프트에서도 금지. 원하는 사용자는 설정(`allowUnsafeCommands: true`) 에서 해제 — 기본 false.
- **Cluster 모드의 DB selector**: 0 만 존재 — UI 가 이 사실을 명확히 고지. 실수로 "DB 5 에 저장했는데 안 보여" 를 차단.
- **SCAN cursor 의 불완전성**: SCAN 은 중복 반환 가능, 누락 가능(rehashing 중). 결과 카운트는 "approx" 로 표기.
- **Big-key 에서의 HGETALL**: 큰 hash 는 `HSCAN` 로 페이지네이션. 그리드 단에서 "large — paginating" 표기.
- **Sentinel 장애 조치**: Sentinel 이 failover 하는 동안 adapter 가 재연결. UI 는 spinner + "Sentinel is reconfiguring..." 메시지.
- **TTL race**: TTL 편집 시 이미 만료 — `EXPIRE` 가 0 을 반환. UI 는 "key no longer exists — refresh" 토스트.
- **RedisJSON 모듈**: `MODULE LIST` 로 감지 — 없으면 JSON 문자열 뷰어로 fallback.

## 검증

각 스프린트 공통:
- `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --lib` + Redis integration test (`cargo test --test redis_integration`)
- `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`

Phase 전체 — **"Redis 핵심 3 + 위험 가드"** 수동 smoke:
1. `docker compose -f docker-compose.test.yml up -d redis` (7.x, password 있음)
2. seed: `SET user:1:profile '{"name":"a"}'`, `HSET user:1:session token abc ttl 300`, `LPUSH queue:jobs ...`, 다양한 type 키 주입
3. 앱 → Redis 연결 → DB 0 선택
4. **#1 Pattern 네비**: `user:*` SCAN → 콜론 트리 자동 생성
5. **#2 Type-aware Quick Look**: string/hash/list/set/zset 각 선택 → 전용 뷰어
6. **#3 TTL + Size**: TTL 인라인 편집(`+5m`) → `TTL key` 로 반영 확인. Big-key(10MB) 뱃지 확인.
7. **위험 가드**: RAW 프롬프트에 `FLUSHDB` → "DROP" 확인 모달. `KEYS *` → 실행 거부 tooltip.
8. 기존 RDB/Mongo/ES 회귀 0
9. 단위 테스트: SCAN cursor 처리, 타입별 디코딩, TTL 파싱, 위험 커맨드 가드, 콜론 트리 빌더.

## 스프린트 분해(초안)

Phase 6 규모 참고 — 10 sprint 전후 예상.

1. **R-A** — `ConnectionConfig::kind = "redis"` variant (Standalone/Sentinel/Cluster), `test_connection`, docker-compose redis + fixture + integration 테스트 인프라. `KvAdapter` 의 `ping` / `list_databases`(0-15) 만 구현.
2. **R-B** — `list_keys(db, pattern, cursor)` + SCAN 바 UI. 콜론 자동 트리 빌더.
3. **R-C** — 키 그리드 (Key / Type / TTL / Size). `get_key_meta` 파이프라인. 기본 정렬·필터.
4. **R-D** — Type-aware Quick Look 3종 (string / hash / list). **Redis 핵심 #2 첫 마일스톤**.
5. **R-E** — Type-aware Quick Look 3종 (set / zset / stream). **Redis 핵심 #2 완결**.
6. **R-F** — TTL 인라인 편집 + Size 뱃지 + Big-key lazy loading. **Redis 핵심 #3 완결**.
7. **R-G** — 위험 커맨드 가드 + 2단계 확인 모달 + 기본 커맨드 블랙리스트.
8. **R-H** — Value 편집 (type 별 경로) + Preview modal.
9. **R-I** — 키 관리 (Add / Delete / Rename / Copy) + RAW command 프롬프트.
10. **R-J** — Cluster 모드 지원 (slot/node 뷰 placeholder) + Sentinel failover 안정화.

Phase 8 전체: 10 sprint 예상. Phase 7 과 독립.

## 범위 밖

- Redis Enterprise / Redis Stack 모듈 전용 UI (Search / Graph / TimeSeries)
- PUB/SUB 이력 저장 (실시간 모니터만 P2 허용)
- Lua 스크립트 에디터 / 디버거
- AOF / RDB 관리
- ACL 사용자 관리 (viewer 만, 편집은 범위 밖)
- Cluster reshard / failover 트리거
- Cross-cluster replication
