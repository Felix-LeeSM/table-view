# Phase 6: MongoDB 지원

> Document DB 어댑터 + 컬렉션/문서 뷰 — **계획**

## 배경 / 판단 기준

MongoDB는 row 단위가 아니라 document(BSON) 단위다. "table view"에 자연스럽게 편입시키려면
컬렉션을 테이블처럼, 문서를 행처럼 보여주되 중첩 필드는 **Quick Look(F3.6)** 에 전량 노출해
사용자가 전체 형태를 바로 이해할 수 있어야 한다. Postgres/MySQL 사용자가 MongoDB 커넥션을
추가해도 사이드바·쿼리 탭·결과 그리드의 조작 방식이 동일해야 한다 (= TablePlus 사용자가
끊김 없이 전환 가능한가?).

## 구현 항목

| Feature | ID | 우선순위 |
|---------|-----|---------|
| MongoDB 연결 폼 (URI + 필드 입력) | F1.1 확장 | P0 |
| MongoAdapter 구현 (trait DbAdapter) | — | P0 |
| 데이터베이스/컬렉션 사이드바 트리 | F2.1 확장 | P0 |
| 문서 리스트 그리드 (평탄화된 top-level fields) | F3.1 확장 | P0 |
| Quick Look — 전체 BSON 문서 | F3.6 확장 | P0 |
| 인덱스 목록 보기 | F2.4 확장 | P1 |
| `find()` / aggregation pipeline 쿼리 실행 | F4.1 확장 | P1 |
| 문서 인라인 편집 (top-level 스칼라 필드) | F3.2 확장 | P1 |
| JSON 에디터로 전체 문서 편집 | — | P1 |
| 문서 추가/삭제 | F3.3 확장 | P2 |
| 컬렉션/인덱스 생성·삭제 DDL | — | P2 |

## F1.1 확장: MongoDB 연결 폼

- [ ] `ConnectionConfig.kind`에 `mongodb` 추가 (기존 `postgres`/`mysql`/`sqlite`와 병렬)
- [ ] 연결 폼에 MongoDB 모드 — Host/Port(27017)/User/Password/AuthDB/ReplicaSet 필드
- [ ] `mongodb://...`, `mongodb+srv://...` URI import 지원
- [ ] TLS 옵션 체크박스 (Atlas 연결 기본 필요)
- [ ] Test Connection 시 `ping` 커맨드로 확인

## F-MongoAdapter: DbAdapter 구현

- [ ] `src-tauri/src/db/mongodb.rs` — `trait DbAdapter` 구현체
- [ ] `connect`/`disconnect`: `mongodb::Client` 라이프사이클
- [ ] `get_tables()` → `list_collection_names()` 매핑 (TableInfo::kind = "collection")
- [ ] `get_schema(collection)` → sample 문서 100개를 스캔해 필드 inference (타입·nullability)
- [ ] `query(str)` → JSON-encoded filter 또는 aggregation pipeline 실행
- [ ] `execute(str)` → insert/update/delete 커맨드 실행

## F2.1 확장: 사이드바 트리

- [ ] 루트: databases → collections → (indexes) — 기존 schema/table 계층과 동일 depth
- [ ] 컬렉션 노드 아이콘은 document 스타일(기본 table과 시각적으로 구분)
- [ ] 컬렉션 더블클릭 시 문서 그리드 미리보기 탭 열림 (F4.3 준수)

## F3.1 확장: 문서 그리드

- [ ] 첫 샘플로부터 추출한 top-level 필드를 컬럼으로 표시
- [ ] `_id` 컬럼은 항상 첫 번째 + pin
- [ ] 중첩 객체/배열 셀은 `{...}` / `[n items]` placeholder, 클릭 시 Quick Look
- [ ] 타입 뱃지(ObjectId/ISODate/NumberLong 등) 렌더
- [ ] 페이지네이션: `.skip().limit()` 기반 (기본 300 rows/page)
- [ ] 필터/정렬 아이콘 클릭 시 MQL 프래그먼트로 변환

## F3.6 확장: Quick Look

- [ ] Quick Look 패널에서 전체 문서 JSON pretty-print
- [ ] 중첩 노드 접기/펼치기
- [ ] 필드 경로 복사 (`user.profile.email`)
- [ ] 값 클립보드 복사

## F2.4 확장: 인덱스 목록

- [ ] 컬렉션 노드 하위에 "Indexes" 서브 섹션
- [ ] 각 인덱스: name, keys, unique, partial filter
- [ ] 인덱스 사용 통계(`$indexStats`) P2 스코프

## F4.1 확장: 쿼리 실행

- [ ] 쿼리 에디터 상단 모드 토글 — Find / Aggregate
- [ ] Find 모드: filter JSON + sort/limit/projection 힌트
- [ ] Aggregate 모드: `[...pipeline]` JSON array
- [ ] Cmd+Return 실행, 결과 그리드로 반환
- [ ] 실행 계획(`.explain()`) 사이드 패널

## F3.2 확장: 인라인 편집

- [ ] top-level 스칼라(string/number/bool/date) 셀 더블클릭 편집
- [ ] 객체/배열 셀은 Quick Look에서 JSON 에디터 열림
- [ ] pending 상태 → Code Review → `$set` 쿼리 생성 → Commit

## F3.3 확장: 문서 추가/삭제

- [ ] "Add Document" 버튼 → 빈 JSON 에디터 모달
- [ ] 행 선택 후 Delete → `deleteOne({_id})`
- [ ] bulk delete는 P2

## Phase 완료 기준

- [ ] 로컬 Mongo 컨테이너(6.x/7.x)에 연결 → 컬렉션 탐색 → 문서 그리드 렌더
- [ ] 인라인 편집 → SQL Preview에 해당하는 MQL Preview → Commit → 문서 반영
- [ ] Postgres/MySQL과 동일 단축키(Cmd+N, Cmd+P, Cmd+S)가 Mongo 커넥션에서도 동작
- [ ] 기존 RDB 테스트 회귀 없음 (`cargo test --lib`, `pnpm vitest run`)
- [ ] `docker-compose.test.yml`에 mongo 서비스 추가 + `cargo test --test mongo_integration` 통과
- [ ] 단위 테스트: MongoAdapter mock 기반 — collection 목록, 필드 inference, filter 직렬화

## 검증

1. `docker compose -f docker-compose.test.yml up -d` (mongo 포함)
2. 앱 실행 → MongoDB 연결 생성 → 샘플 컬렉션 탐색
3. 문서 편집 → MQL Preview → Commit → mongo shell로 변경 확인

## 범위 밖

- Change Streams / realtime tail (별도 phase)
- GridFS 파일 관리
- Atlas Search / Vector Search
- 샤딩/레플리카셋 관리 DDL
