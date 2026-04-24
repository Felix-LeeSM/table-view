# Phase 6 Master Spec (MongoDB 지원)

전체 계획은 `/Users/felix/.claude/plans/zany-hugging-twilight.md` 참조.

## Feature Description
MongoDB를 "컬렉션=테이블, 문서=행, 중첩 필드는 Quick Look에 전량"이라는 정책으로 테이블 뷰에 편입.
TablePlus 사용자가 Postgres/MySQL ↔ MongoDB 전환 시 핵심 워크플로우(탐색/조회/편집)가 끊기지 않는 것이 성공 기준.

Phase 7(Elasticsearch)/Phase 8(Redis)까지 고려한 **paradigm별 독립 trait + enum dispatch** 설계로 기반을 먼저 다진 뒤 MongoDB 구현.

## Sprint Breakdown (Phase 6 플랜 섹션 → 프로젝트 Sprint 번호)
- **A1 = Sprint 63**: Trait 계층 + DTO + ActiveAdapter enum 선언, PostgresAdapter → RdbAdapter 위임 impl (behavior change 0)
- **A2 = Sprint 64**: AppState/command 리팩터 (enum dispatch 경유, behavior change 0)
- **B = Sprint 65**: MongoAdapter 연결 + 테스트 인프라 + ConnectionDialog 조건부 필드
- **C = Sprint 66**: 컬렉션 사이드바 + 문서 그리드 (P0 읽기)
- **D = Sprint 67**: BsonTreeViewer Quick Look
- **E = Sprint 68**: Find/Aggregate 쿼리 모드
- **F = Sprint 69**: 인라인 편집 + MQL Preview + 문서 추가/삭제

## Acceptance Criteria (per sprint)
각 Sprint 섹션은 마스터 플랜의 "Done" 목록을 그대로 따른다.

## Components
Backend: `src-tauri/src/db/{mod,postgres,mongodb}.rs`, `commands/{connection,rdb/*,document/*}.rs`, `lib.rs` AppState, `models/connection.rs`.
Frontend: `types/connection.ts`, `components/{connection,schema,datagrid,shared,query,document}/*`, `stores/{tabStore,schemaStore}.ts`.

## Data Flow
ConnectionConfig → factory → ActiveAdapter enum (Rdb/Document/Search/Kv) → command → paradigm-specific trait method → DTO → IPC → frontend paradigm router.

## Edge Cases
- 권한 제한으로 일부 namespace/database 미노출
- 중첩 문서의 sentinel cell rendering
- Canonical extended JSON의 타입 뱃지 파싱
- 큰 문서(>1MB) Quick Look 성능 (Phase 6에서는 보류)
- `_id`가 ObjectId 이외(문자열/UUID)일 수 있음
