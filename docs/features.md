# Table View — 지원 기능 인벤토리

> **기준일**: 2026-05-01 (Phase 5 Sprint 175 종료, Sprint 180 진행 중)
> **검증 방식**: `src-tauri/src/commands/`, `src/components/`, `src/stores/`, `src/hooks/`,
> `src/lib/` 의 실제 소스 코드를 근거로 작성. 로드맵(`docs/PLAN.md`)과
> 일치하지 않는 항목은 "갭" 섹션에 별도 표시.

표기 규칙
- ✅ 완전 구현 (백엔드 + UI + 테스트)
- 🟡 부분 구현 (백엔드만, UI만, 또는 일부 DBMS 한정)
- ❌ 미구현 (필드/스텁만 존재 또는 전혀 없음)

---

## 1. 연결 관리

| 기능 | 상태 | 근거 |
|------|------|------|
| PostgreSQL 연결 | ✅ | `src-tauri/src/db/postgres.rs` |
| MongoDB 연결 | ✅ | `src-tauri/src/db/mongodb.rs` |
| MySQL / SQLite / MSSQL / Oracle | ❌ | `commands/connection.rs` → `AppError::Unsupported` |
| 연결 생성/수정/삭제 | ✅ | `connection.rs:save_connection`, `delete_connection`, `update_connection` |
| 연결 테스트 (test_connection) | ✅ | `connection.rs:test_connection` (PG + Mongo 라우팅) |
| 연결 그룹화 | ✅ | `commands/connection.rs:list_groups`, `save_group`, `move_connection_to_group` |
| 연결 색상/라벨 | ✅ | `src/lib/connectionColor.ts` (`CONNECTION_COLOR_PALETTE`), TabBar 색띠 (`TabBar.tsx:211`) |
| 비밀번호 AES-256-GCM 저장 | ✅ | `src-tauri/src/storage/crypto.rs`, Argon2id KDF |
| 비밀번호 3-state 처리 | ✅ | None=보존 / Some("")=삭제 / Some(s)=교체 (Sprint B) |
| 연결 export (평문 JSON) | ✅ | `connection.rs:484-540` |
| 연결 export (암호화) | ✅ | Sprint 140, 마스터 비밀번호 + AES-256-GCM |
| Keep-alive / 자동 재연결 | ✅ | `connection.rs:keep_alive_loop`, exponential backoff |
| SSL/TLS 연결 | 🟡 | `tls_enabled: Option<bool>` 필드만 존재, 동작 검증 미확인 |
| **SSH 터널링** | ❌ | 필드 없음, 전혀 미구현 |
| MongoDB auth_source / replica_set | ✅ | `mongodb.rs:build_options` |

---

## 2. 스키마 탐색

### RDB (PostgreSQL)
| 기능 | 상태 | 근거 |
|------|------|------|
| 데이터베이스 목록 | ✅ | `commands/rdb/schema.rs:list_schemas` |
| 테이블 목록 | ✅ | `schema.rs:list_tables` |
| 컬럼 정보 (이름/타입/null/default) | ✅ | `schema.rs:get_table_columns` (취소 토큰 지원, Sprint 180) |
| 인덱스 | ✅ | `schema.rs:get_table_indexes` |
| 제약조건 (PK/FK/Check/Unique) | ✅ | `schema.rs:get_table_constraints` |
| 뷰 정의 / 컬럼 | ✅ | `schema.rs:list_views`, `get_view_definition`, `get_view_columns` |
| 함수 소스 조회 (Read) | ✅ | `schema.rs:list_functions`, `get_function_source` |
| 함수 생성/수정/삭제 (Write) | ❌ | 미구현 (Plan F2.7) |
| 트리거 | ❌ | 미구현 |
| 프로시저 | ❌ | 미구현 (PG는 함수로 대체 가능) |
| 행 수 (estimate) | ✅ | `pg_class.reltuples`, SchemaTree에 표시 (Sprint A1+) |

### Document (MongoDB)
| 기능 | 상태 | 근거 |
|------|------|------|
| 데이터베이스 목록 | ✅ | `commands/document/browse.rs:list_mongo_databases` |
| 컬렉션 목록 | ✅ | `browse.rs:list_mongo_collections` |
| 필드 추론 (sample 100) | ✅ | `browse.rs:infer_collection_fields` |
| 인덱스 조회 | 🟡 | 코드 확인 필요 |
| 컬렉션 행 수 | ✅ | `db.command({count})` |

### Frontend
| 기능 | 상태 | 근거 |
|------|------|------|
| 계층적 트리 (Schema/Table/View) | ✅ | `src/components/schema/SchemaTree.tsx` |
| MongoDB 트리 | ✅ | `src/components/schema/DocumentDatabaseTree.tsx` |
| Lazy load (선택 시 컬럼 로드) | ✅ | useEffect 기반 |
| 우클릭 컨텍스트 메뉴 | ✅ | 테이블 액션 노출 |
| 구조 상세 패널 | ✅ | `src/components/structure/StructurePanel.tsx` |

---

## 3. 쿼리 에디터

| 기능 | 상태 | 근거 |
|------|------|------|
| SQL 실행 | ✅ | `commands/rdb/query.rs:execute_query` |
| MongoDB find / aggregate | ✅ | `commands/document/query.rs` |
| 다중 statement 실행 | ✅ | `src/lib/sqlUtils.ts:splitSqlStatements`, statement별 결과 탭 |
| 쿼리 취소 | ✅ | `query.rs:cancel_query`, `tokio_util::CancellationToken` |
| 쿼리 결과 페이지네이션 | ✅ | `src/components/query/QueryResultGrid.tsx` |
| 인라인 셀 편집 (RDB) | 🟡 | `EditableQueryResultGrid.tsx` 진행 중 |
| 인라인 셀 편집 (Mongo) | ✅ | `update_document` $set 패턴 |
| CodeMirror 기반 SQL 에디터 | ✅ | `src/components/query/SqlQueryEditor.tsx` |
| MongoDB JSON 에디터 | ✅ | `src/components/query/MongoQueryEditor.tsx` |
| **자동완성 (테이블/컬럼)** | ✅ | `src/hooks/useSqlAutocomplete.ts`, `useMongoAutocomplete.ts` |
| SQL 포맷 (Cmd+I) | ✅ | `src/lib/sqlUtils.ts:formatSql` |
| SQL 미니파이 (Cmd+Shift+I) | ✅ | `sqlUtils.ts:uglifySql` |
| 쿼리 히스토리 (전역 로그) | ✅ | `src/stores/queryHistoryStore.ts`, `GlobalQueryLogPanel.tsx` |
| 쿼리 즐겨찾기 | ✅ | `src/stores/favoritesStore.ts`, `FavoritesPanel.tsx` |
| 쿼리 파라미터 바인딩 (`$1`, `:name`) | ❌ | 미구현 |
| EXPLAIN 전용 시각화 | ❌ | 키워드는 인식하지만 (`sqlTokenize.ts`), plan 트리/그래프 없음 |
| 멀티 캐럿 / 멀티 셀렉션 | 🟡 | CodeMirror 기본 동작에 의존, 명시적 사용자 가이드 없음 |
| Split pane (에디터 분할) | ❌ | UI 미구현 |
| 결과 분할 (Split results into tabs) | 🟡 | 다중 statement → 결과 탭은 분리, 사용자 명시적 분할은 없음 |
| 스트리밍 결과 / async 점진 로드 | ❌ | 단일 batch 반환, 페이지네이션은 query rerun 방식 |

---

## 4. 데이터 그리드

| 기능 | 상태 | 근거 |
|------|------|------|
| 행 표시 / 페이지 이동 | ✅ | `src/components/rdb/DataGrid.tsx`, `DocumentDataGrid.tsx` |
| 정렬 (컬럼 헤더) | ✅ | `query_table_data` order_by 인자 |
| 필터 (컬럼 조건) | ✅ | `src/components/rdb/FilterBar.tsx`, `FilterCondition` 타입 |
| MongoDB BSON 필터 | ✅ | `DocumentFilterBar.tsx` |
| 행 추가 (RDB) | 🟡 | UI 진행 중 |
| 행 추가 (Mongo) | ✅ | `AddDocumentModal.tsx`, `mutate.rs:insert_document` |
| 행 수정 / 삭제 | ✅ | RDB: `EditableQueryResultGrid` 진행 중, Mongo: 완전 |
| 컬럼 리사이즈 | ✅ | ResizablePanel hook 기반 |
| 셀 상세 보기 (JSON inspector) | ✅ | `CellDetailDialog`, `MqlPreviewModal` |
| **CSV/TSV/SQL Export (그리드 기준)** | ❌ | 미구현 |

---

## 5. 윈도우 / 네비게이션

| 기능 | 상태 | 근거 |
|------|------|------|
| 듀얼 윈도우 (Launcher + Workspace) | ✅ | `src/AppRouter.tsx` (Sprint 150–155) |
| 윈도우 라벨 라우팅 | ✅ | `src/lib/window-label.ts` |
| 크로스 윈도우 상태 동기화 | ✅ | 5개 store IPC 브릿지 (connection / tab / schema / queryHistory / favorites) |
| 다중 탭 (테이블 / 쿼리) | ✅ | `src/stores/tabStore.ts` |
| 탭 영속화 (세션) | ✅ | localStorage |
| Preview tab | ✅ | 클릭 시 현재 탭 교체 |
| MRU (최근 연결) | ✅ | `src/stores/mruStore.ts` |
| QuickOpen (Cmd+P) | ✅ | `src/components/shared/QuickOpen.tsx` |
| Shortcut Cheatsheet (`?` / Cmd+/) | ✅ | `src/components/shared/ShortcutCheatsheet.tsx` (Sprint 103) |
| macOS 네이티브 메뉴 | ✅ | `src-tauri/src/lib.rs:install_macos_menu` (2026-05-01) |
| macOS dock 재오픈 (RunEvent::Reopen) | ✅ | `src-tauri/src/lib.rs` (windowless Cmd+N 지원) |

---

## 6. 키보드 단축키

`src/components/shared/ShortcutCheatsheet.tsx` 의 `SHORTCUT_GROUPS` 가 단일 진실원.

| 그룹 | 액션 | 키 |
|------|------|-----|
| Tabs | 탭 닫기 | `Cmd+W` |
| Tabs | 새 쿼리 탭 | `Cmd+T` |
| Tabs | 마지막 닫힌 탭 복원 | `Cmd+Shift+T` |
| Tabs | N번째 탭 이동 | `Cmd+1` … `Cmd+9` |
| Editing | 변경 커밋 | `Cmd+S` |
| Editing | SQL 포맷 | `Cmd+I` |
| Editing | SQL 미니파이 | `Cmd+Shift+I` |
| Navigation | Quick open | `Cmd+P` |
| Navigation | 새로고침 | `Cmd+R`, `F5` |
| Navigation | 쿼리 취소 | `Cmd+.` |
| Panels | Home/Workspace 토글 | `Cmd+,` |
| Panels | 즐겨찾기 토글 | `Cmd+Shift+F` |
| Panels | 전역 쿼리 로그 토글 | `Cmd+Shift+C` |
| Misc | 새 연결 | `Cmd+N` |
| Misc | Cheatsheet 열기 | `?`, `Cmd+/` |

**커스터마이즈 불가** — 키맵을 사용자가 변경하는 UI는 없음.

---

## 7. 테마 / 환경설정

| 기능 | 상태 | 근거 |
|------|------|------|
| 라이트 / 다크 토글 | ✅ | `src/stores/themeStore.ts`, Tailwind `dark:` |
| 폰트 / 크기 커스터마이즈 | ❌ | UI 없음 (고정 monospace) |
| 컬러 팔레트 커스터마이즈 | ❌ | Tailwind 정의 팔레트 고정 |
| CSV 기본값 (구분자/인코딩) | ❌ | CSV 자체가 미구현 |
| 키맵 커스터마이즈 | ❌ | 미구현 |
| Crash report opt-in / 데이터 보존 | ❌ | 텔레메트리 자체 없음 |

---

## 8. 보안

| 기능 | 상태 | 근거 |
|------|------|------|
| 비밀번호 AES-256-GCM 암호화 저장 | ✅ | `storage/crypto.rs` |
| 평문 비밀번호 IPC 미노출 | ✅ | `list_connections` → `has_password: bool` 만 반환 |
| 마스터 비밀번호 기반 export | ✅ | Sprint 140 |
| Code review / Safe mode (DDL 사전 검토) | ❌ | 미구현 |
| Production 연결 색상 경고 | 🟡 | 색상 자체는 있으나 "프로덕션 차단" 같은 가드는 없음 |

---

## 9. 기타

| 기능 | 상태 | 근거 |
|------|------|------|
| 메트릭 보드 (DB 활동 모니터) | ❌ | 미구현 |
| 사용자/권한 관리 UI | ❌ | 미구현 |
| ERD 다이어그램 | ❌ | 미구현 |
| Backup / Restore (`pg_dump` 등) | ❌ | 미구현 |
| Data Import (CSV → 테이블) | ❌ | 미구현 |
| 플러그인 시스템 | ❌ | 미구현 |
| LLM 어시스턴트 (자연어 → SQL) | ❌ | 미구현 |
| 라이선스 매니저 | ❌ | 오픈 (배포 정책 미정) |
| 다중 OS 지원 | 🟡 | macOS 우선 (네이티브 메뉴/dock-reopen은 macOS 한정), Windows/Linux 빌드 가능하나 검증 부족 |

---

## 10. 로드맵 vs 실제 코드 갭

| 영역 | `docs/PLAN.md` | 실제 |
|------|----------------|------|
| F1.5 connection color UI | 미완료 표시 | **이미 구현됨** (Sprint 28+) |
| F2.7 Functions CRUD | 계획 | Read만 구현 |
| F4.8 결과 분할 | 계획 | 다중 statement 탭만 |
| F5.6 패널 관리 시스템 | 계획 | 기본 탭/사이드바만 |
| Phase 17–20 MySQL/SQLite/Oracle | 예정 | `Unsupported` 반환 |
| SSH 터널 | 일부 문서 언급 | 필드 없음, 미구현 |

---

## 11. 핵심 요약 — 한 줄

**"PostgreSQL + MongoDB 듀얼 패러다임을 듀얼 윈도우(Launcher/Workspace)에서
다루는 데스크톱 클라이언트. 연결·스키마·쿼리·결과 그리드의 핵심 워크플로는
완성됐고, 데이터 import/export · 트리거 · 함수 write · SSH 터널 · ERD ·
플러그인 등 TablePlus의 후방 기능들은 미구현 상태."**
