# Phase 8: Redis 지원

> KV 어댑터 + 키 스페이스 뷰 — **계획**

## 배경 / 판단 기준

Redis는 row/column 개념이 없고 key → value(string/hash/list/set/zset/stream) 구조다.
TablePlus식 "table view"에 자연스럽게 녹이려면 **키 자체를 행으로, type/TTL/size를 컬럼으로,
value는 Quick Look에 전량 노출**해야 한다. 운영에서 가장 자주 쓰는 동작 — 키 검색, TTL 확인,
값 조회/수정 — 을 그리드 + 단축키로 끊김 없이 해내는 것이 성공 기준이다.

## 구현 항목

| Feature | ID | 우선순위 |
|---------|-----|---------|
| Redis 연결 폼 (Standalone/Sentinel/Cluster) | F1.1 확장 | P0 |
| RedisAdapter 구현 | — | P0 |
| DB(0-15) + key pattern 사이드바 | F2.1 확장 | P0 |
| 키 그리드 (key, type, ttl, size) | F3.1 확장 | P0 |
| Quick Look — 타입별 value 뷰어 | F3.6 확장 | P0 |
| 키 패턴 검색 (`SCAN MATCH`) | — | P0 |
| Value 편집 (string/hash field/list index) | F3.2 확장 | P1 |
| 키 추가/삭제/rename/expire 조정 | F3.3 확장 | P1 |
| 명령 프롬프트 (RAW Redis command) | F4.1 확장 | P1 |
| PUB/SUB 모니터링 | — | P2 |
| Streams 탐색 (XRANGE) | — | P2 |
| Cluster slot / node 뷰 | — | P2 |

## F1.1 확장: Redis 연결 폼

- [ ] `ConnectionConfig.kind`에 `redis` 추가
- [ ] 모드 토글: Standalone / Sentinel / Cluster
- [ ] Standalone: Host/Port(6379)/Username(ACL)/Password/DB(0)
- [ ] Sentinel: master name + sentinels 배열 + auth
- [ ] Cluster: seed nodes 리스트
- [ ] TLS 옵션
- [ ] `redis://...`, `rediss://...` URI import
- [ ] Test Connection → `PING` → `INFO server` 버전 표시

## F-RedisAdapter: DbAdapter 구현

- [ ] `src-tauri/src/db/redis.rs` — `trait DbAdapter` 구현체
- [ ] `redis` Rust 크레이트 사용 (async)
- [ ] "schema" 개념 없음 → `get_tables()` → 선택된 DB의 키 목록(SCAN 기반 페이지)
- [ ] `get_schema(key)` → 단일 키의 type/encoding/ttl/size
- [ ] `query(cmd)` → raw 커맨드 실행 (`GET foo`, `HGETALL user:1`)
- [ ] `execute(cmd)` → write 커맨드
- [ ] 큰 value(> 1MB) lazy loading

## F2.1 확장: 사이드바 트리

- [ ] 루트: 연결 → databases (0-15) → key-pattern folders
- [ ] 사용자가 콜론 구분자(`:`)로 키를 가상 폴더 트리화 (`user:1:profile` → user / 1 / profile)
- [ ] 폴더 depth 기본 3, 설정에서 조정
- [ ] Cluster 모드: DB selector 비활성화, 대신 slot/node 표시

## F3.1 확장: 키 그리드

- [ ] 컬럼: Key / Type / TTL / Size / Encoding
- [ ] Type 뱃지 색상(string/hash/list/set/zset/stream/JSON)
- [ ] TTL은 `-1 (persist)` / `2d 3h` / 만료 임박 경고 색
- [ ] SCAN 기반 페이지네이션 — cursor 표시, "Load more" 버튼
- [ ] 패턴 검색 상단 바 (`user:*`) — SCAN MATCH로 실행
- [ ] 대량 키 삭제 방지: KEYS * 대신 SCAN 항상 사용

## F3.6 확장: Quick Look (타입별 뷰어)

- [ ] string: text/JSON 자동 감지 + pretty print
- [ ] hash: field→value 2-column 그리드
- [ ] list: 인덱스 + value 테이블, 페이지네이션
- [ ] set/zset: member(+score) 테이블
- [ ] stream: 최근 N entries, XRANGE 기반
- [ ] JSON(RedisJSON) 모듈 감지 시 전용 뷰어
- [ ] 값 복사(plain/JSON)

## F-Search: 패턴 검색

- [ ] 상단 검색 바 `user:*` — Enter 시 SCAN 시작
- [ ] "키 개수 예상"은 DBSIZE 표시만 (KEYS 금지)
- [ ] Cmd+K 단축키

## F3.2 확장: Value 편집

- [ ] string: Quick Look에서 인라인 편집 → Preview → `SET` 실행
- [ ] hash: 필드별 셀 편집 → `HSET`
- [ ] list: 인덱스 셀 편집 → `LSET`
- [ ] set: member 추가/제거 → `SADD` / `SREM`
- [ ] zset: score 편집 → `ZADD`
- [ ] TTL 조정 UI — expire/persist/expireat

## F3.3 확장: 키 관리

- [ ] "Add Key" 모달 — 타입 선택 → 초기값 입력
- [ ] 우클릭 메뉴: Delete / Rename / Copy / Change TTL / Dump
- [ ] Rename → `RENAME` (DB 내부) / 크로스 DB는 DUMP+RESTORE 경고

## F4.1 확장: 명령 프롬프트

- [ ] 쿼리 탭에서 raw command 실행 (에디터 대신 single-line)
- [ ] 자동완성: 자주 쓰는 커맨드 목록
- [ ] 응답 결과는 타입별 그리드 or 텍스트
- [ ] 위험 커맨드(FLUSHALL/FLUSHDB/KEYS) 실행 전 확인 모달

## Phase 완료 기준

- [ ] 로컬 Redis 컨테이너(7.x) 연결 → DB 0 키 목록 렌더
- [ ] 패턴 검색 `user:*` → 그리드 필터링
- [ ] hash 키 선택 → Quick Look에서 field 편집 → Preview → Commit → `HGET`으로 확인
- [ ] TTL 조정 UI로 expire 설정 → 시간 경과 후 키 만료 확인
- [ ] 기존 RDB 테스트 회귀 없음
- [ ] `docker-compose.test.yml`에 redis 서비스 추가 + `cargo test --test redis_integration`
- [ ] 단위 테스트: RedisAdapter — SCAN 커서 처리, 타입별 디코딩, 위험 커맨드 가드

## 검증

1. `docker compose -f docker-compose.test.yml up -d` (redis 포함)
2. 앱 실행 → Redis 연결 생성 → `SET foo bar` 등 샘플 데이터 주입
3. 키 그리드에서 foo 선택 → Quick Look에서 값 확인 → 편집 → Commit
4. 위험 커맨드(FLUSHDB) 입력 → 확인 모달 → 취소 플로우 확인

## 범위 밖

- Redis Enterprise / Redis Stack 전용 모듈(Search/Graph/TimeSeries) 전용 UI
- PUB/SUB 이력 저장 (메모리 내 실시간 모니터만 허용 범위)
- Lua 스크립트 에디터 + 디버거
- AOF/RDB 관리
- ACL 사용자 관리
