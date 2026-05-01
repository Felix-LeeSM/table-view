# Table View ↔ TablePlus 기능 비교

> **기준일**: 2026-05-01
> **TablePlus 문서 출처**: `docs/table_plus/` (2026-04-06 fetch, 63 docs)
> **Table View 출처**: `docs/features.md` + 소스 코드
>
> TablePlus 공식 문서의 디렉토리 구조(`getting-started`, `gui-tools`,
> `query-editor`, `preferences`, `utilities`)를 그대로 비교 축으로 사용한다.

표기
- ✅ 동등하거나 그 이상
- 🟡 부분 / 일부 DBMS 한정
- ❌ 미구현
- ➖ Table View에 해당 개념 없음 (의도적 미선택 또는 NA)

---

## A. 지원 데이터베이스

| DBMS | TablePlus | Table View |
|------|-----------|------------|
| PostgreSQL | ✅ | ✅ |
| MySQL | ✅ | ❌ (Phase 17 예정) |
| MariaDB | ✅ | ❌ |
| SQLite | ✅ | ❌ (Phase 18 예정) |
| Microsoft SQL Server | ✅ | ❌ |
| Amazon Redshift | ✅ | ❌ |
| Oracle (macOS only) | ✅ | ❌ (Phase 20 예정) |
| CockroachDB | ✅ | 🟡 (PG 프로토콜 호환 가능성, 미검증) |
| Snowflake | ✅ | ❌ |
| Cassandra | ✅ | ❌ |
| Redis | ✅ | ❌ |
| Vertica | ✅ | ❌ |
| **MongoDB (TablePlus는 Beta)** | 🟡 | ✅ (1급 시민, 별도 패러다임) |

**갭**: Table View는 PostgreSQL + MongoDB 두 패러다임에 집중. MySQL/SQLite는
로드맵에 있지만 구현 전.

---

## B. 시작하기 / 설치

| 항목 | TablePlus | Table View |
|------|-----------|------------|
| macOS 네이티브 빌드 | ✅ (10.11+) | ✅ (Tauri 2.0 기반) |
| Windows 빌드 | ✅ (Win7+ / .NET 4.8) | 🟡 (빌드 가능, 검증 부족) |
| Linux 빌드 | ✅ | 🟡 (빌드 가능, 검증 부족) |
| iOS 빌드 | ✅ | ❌ |
| 데이터 텔레메트리 (옵션) | AppCenter (90일 retention) | ❌ (없음) |
| Beta 채널 / 자동 업데이트 | ✅ | ❌ |
| 오프라인 — 자격증명 로컬 저장 | ✅ | ✅ (AES-256-GCM) |

---

## C. GUI Tools

### C-1. Manage Connections (`gui-tools/manage-connections.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| 연결 생성/수정/삭제 | ✅ | ✅ |
| 연결 그룹 | ✅ | ✅ |
| 연결 색상 | ✅ | ✅ (`CONNECTION_COLOR_PALETTE`) |
| 연결 라벨/태그 | ✅ | 🟡 (이름만) |
| Test Connection | ✅ | ✅ |
| **SSH 터널** | ✅ | ❌ |
| SSL 인증서 | ✅ | 🟡 (필드만) |
| iCloud / 클라우드 동기화 | ✅ | ❌ |
| Export / Import (자격증명) | ✅ | ✅ (평문 + 암호화) |

### C-2. The Interface (`gui-tools/the-interface.md`)
| 컴포넌트 | TablePlus | Table View |
|---------|-----------|------------|
| Toolbar | ✅ | 🟡 (간소화) |
| Left Sidebar (스키마 트리) | ✅ | ✅ (`SchemaTree`) |
| Right Sidebar (구조/세부) | ✅ | 🟡 (`StructurePanel` 별도 탭) |
| Multi-tabs | ✅ | ✅ |
| **Workspaces (윈도우 단위)** | ✅ | ✅ (Launcher + Workspace) |
| Console Log | ✅ | ✅ (`GlobalQueryLogPanel`) |
| Quick Look (셀 미리보기) | ✅ | ✅ (`CellDetailDialog`) |
| Menu (네이티브 macOS) | ✅ | ✅ (2026-05-01 도입) |

### C-3. Working with Tables (`gui-tools/working-with-table.md`)
| 작업 | TablePlus | Table View |
|------|-----------|------------|
| Table — 생성/이름변경/삭제 | ✅ | 🟡 (Mongo: ✅, RDB: 직접 SQL) |
| Column — 추가/수정/삭제 | ✅ | 🟡 (직접 DDL) |
| Constraint — PK/FK/Check 편집 | ✅ | ❌ (Read만) |
| Index — 생성/삭제 | ✅ | ❌ (Read만) |
| Trigger — 관리 | ✅ | ❌ |
| Row — 추가/수정/삭제 | ✅ | 🟡 (RDB 진행 중, Mongo 완전) |

### C-4. Database Objects (`gui-tools/database-objects.md`)
| 객체 | TablePlus | Table View |
|------|-----------|------------|
| View — 정의 / 컬럼 조회 | ✅ | ✅ |
| View — CREATE/DROP UI | ✅ | ❌ |
| Function — 소스 조회 | ✅ | ✅ |
| Function — CREATE/EDIT UI | ✅ | ❌ |
| Procedure | ✅ | ❌ |

### C-5. Code Review & Safe Mode (`gui-tools/code-review-and-safemode.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| Code Preview (DDL 미리보기) | ✅ | ❌ |
| Commit Changes (변경 묶음 적용) | ✅ | 🟡 (인라인 편집은 즉시 적용) |
| Discard Changes | ✅ | ❌ |
| Safe Mode (Production 차단) | ✅ | ❌ (색상 표시만) |

**갭이 큰 영역** — TablePlus의 차별 기능 중 하나.

### C-6. Filter (`gui-tools/filter.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| 컬럼 조건 필터 | ✅ | ✅ (`FilterBar`, `DocumentFilterBar`) |
| AND/OR 조합 | ✅ | 🟡 (확인 필요) |
| 저장된 필터 | ✅ | ❌ |

### C-7. Backup & Restore (`gui-tools/backup-and-restore.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| pg_dump / mysqldump 통합 | ✅ | ❌ |
| 스케줄 백업 | ✅ | ❌ |
| Restore from file | ✅ | ❌ |

### C-8. Import & Export (`gui-tools/import-and-export.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| CSV / JSON / XML import | ✅ | ❌ |
| CSV / JSON / SQL export (그리드 → 파일) | ✅ | ❌ |
| INSERT INTO 생성 | ✅ | ❌ |

**큰 갭** — 데이터 import/export는 전혀 미구현.

### C-9. User Management (`gui-tools/user-management.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| 사용자/롤 목록 | ✅ | ❌ |
| 권한 부여/회수 | ✅ | ❌ |
| 비밀번호 변경 | ✅ | ❌ |

### C-10. Metrics Board (`gui-tools/metrics-board.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| 활성 세션 / 락 모니터 | ✅ | ❌ |
| 실행 중 쿼리 | ✅ | 🟡 (앱 자신의 쿼리만 cancel 가능) |

### C-11. Open Anything (`gui-tools/open-anything.md`)
| 기능 | TablePlus | Table View |
|------|-----------|------------|
| 전역 검색 (테이블/뷰/쿼리) | ✅ (`Cmd+Shift+P`) | 🟡 (`QuickOpen` Cmd+P, 범위 확인 필요) |

---

## D. Query Editor

| 기능 | TablePlus | Table View |
|------|-----------|------------|
| 자동완성 (테이블/컬럼/키워드) | ✅ | ✅ (`useSqlAutocomplete`, `useMongoAutocomplete`) |
| 쿼리 히스토리 | ✅ | ✅ (`queryHistoryStore`, 전역) |
| 즐겨찾기 (Favorites) | ✅ | ✅ (`favoritesStore`) |
| Keyword Binding (스니펫) | ✅ | ❌ |
| 쿼리 파라미터 (`:name`) | ✅ | ❌ |
| 멀티 캐럿 / 블록 선택 | ✅ | 🟡 (CodeMirror 기본) |
| 쿼리 포맷 / 미니파이 | ✅ | ✅ (Cmd+I / Cmd+Shift+I) |
| 에디터 분할 (Split Panes) | ✅ | ❌ |
| 결과 분할 (Split Results) | ✅ | 🟡 (다중 statement 자동 분리만) |
| 스트리밍 결과 / async 점진 로드 | ✅ | ❌ (단일 batch + 페이지네이션) |
| 결과 그리드 정렬/필터 | ✅ | ✅ |
| 쿼리 취소 | ✅ | ✅ (Cmd+.) |
| 에디터 폰트/테마 커스터마이즈 | ✅ | 🟡 (라이트/다크만) |

---

## E. Preferences

| 영역 | TablePlus | Table View |
|------|-----------|------------|
| Application (자동 업데이트, 시작 동작) | ✅ | ❌ |
| Connections (기본 SSL/SSH/timeout) | ✅ | ❌ |
| CSV File (구분자/인코딩/quote) | ✅ | ➖ (CSV 미구현) |
| SQL Editor (자동완성/포맷/탭 너비) | ✅ | ❌ |
| Table Data (페이지 크기/정렬) | ✅ | ❌ |
| Fonts & Colors | ✅ | ❌ |
| **Keymap (단축키 재바인딩)** | ✅ | ❌ |
| Crash & Security | ✅ | ➖ (텔레메트리 없음) |

**큰 갭** — Table View에는 Preferences UI 자체가 없음. 라이트/다크 테마 토글만 존재.

---

## F. Utilities

| 도구 | TablePlus | Table View |
|------|-----------|------------|
| **Plugin 시스템** | ✅ (LLM, JSON, UUID 등) | ❌ |
| LLM Plugin (자연어 → SQL) | ✅ | ❌ |
| DBngin (로컬 DB 매니저 통합) | ✅ | ➖ (별도 도구) |
| Licensing | ✅ | ➖ (배포 정책 미정) |
| **Shortcut Keys 문서** | ✅ | ✅ (`ShortcutCheatsheet` Cmd+/, ?) |
| Troubleshooting 가이드 | ✅ | 🟡 (`docs/RISKS.md` + sprint 회고) |

---

## G. Table View 가 더 나은 영역

| 항목 | 차별점 |
|------|--------|
| **MongoDB 1급 시민** | TablePlus는 Beta, 별도 그리드/필터 UI 없음. Table View는 RDB와 동등 수준 |
| **듀얼 윈도우 명시 분리** | TablePlus의 Workspace는 윈도우보단 탭 그룹. Table View는 Launcher / Workspace를 OS-level 윈도우로 분리 → cross-window state bridge |
| **자격증명 암호화 강도** | AES-256-GCM + Argon2id KDF (Sprint 140) |
| **쿼리 취소 토큰** | tokio CancellationToken 기반, schema/query 전체에 일관 적용 |
| **오픈 / 텔레메트리 0** | 사용자 행동 추적 자체 없음 |

---

## H. 갭 요약 — 우선순위 매트릭스

> **방향 (2026-05-01 결정)**: 신규 DBMS 추가는 보류. 현재 보유한
> PostgreSQL + MongoDB 위에서 TablePlus 워크플로 패리티를 먼저 맞춘다.
> MySQL/SQLite/Oracle 등 어댑터 작업은 패리티 달성 이후 재검토.

| 우선순위 | 항목 | 영향도 | 난이도 | 비고 |
|----------|------|--------|--------|------|
| **P0** | Row 인라인 편집 RDB 완성 | 큼 (데일리) | 중 | `EditableQueryResultGrid` 진행 중. Mongo 패턴을 PG로 |
| **P0** | CSV / SQL Export (그리드 → 파일) | 큼 | 낮 | 결과 row 이미 보유. 한 버튼으로 끝남 |
| **P0** | Index UI — 생성/삭제 | 큼 | 중 | Read는 이미 있음. PG 한정으로 시작 |
| **P0** | Constraint UI — PK/FK/Check 편집 | 큼 | 중 | 동상. Read 끝, Write만 추가 |
| **P1** | Table / Column DDL UI | 큼 | 큼 | TablePlus 차별, 사용자가 선택한 영역 |
| **P1** | Code Review / Safe Mode | 차별 기능 | 중 | 프로덕션 색 + `WHERE`-less DML 가드 |
| **P1** | Commit Changes / Discard 버튼 | 차별 기능 | 중 | 인라인 편집 묶음 → 한 번에 적용 |
| **P1** | SSH 터널 | 큼 (프로덕션 접근) | 중 | `russh` crate 도입 |
| **P1** | Trigger 관리 (PG) | 중 | 중 | Schema 트리에 노드 추가 |
| **P2** | View / Function CREATE/EDIT UI | 중 | 중 | Read 끝, 편집기만 추가 |
| **P2** | Backup & Restore (pg_dump 통합) | 운영자 시나리오 | 중 | `Command::new("pg_dump")` |
| **P2** | Preferences UI (키맵 재바인딩 우선) | 사용자 정착 | 중 | |
| **P2** | 쿼리 파라미터 (`:name` / `$1`) | 쿼리 재사용 | 낮 | |
| **P2** | 데이터 Import (CSV → 테이블) | 데일리 | 중 | export 끝나고 |
| **P2** | 스트리밍 결과 / async 점진 로드 | 대용량 | 중 | 현재 batch + 페이지네이션만 |
| **P3** | User / Permission 관리 (PG) | 운영자 한정 | 큼 | |
| **P3** | Metrics Board (활성 세션/락) | 운영자 한정 | 큼 | `pg_stat_activity` 폴링 |
| **P3** | Keyword Binding / 스니펫 | 차별 기능 | 낮 | |
| **P3** | 플러그인 시스템 / LLM | 차별 기능 | 매우 큼 | |
| **보류** | MySQL / SQLite / Oracle 어댑터 | — | — | 현 DBMS 패리티 후 재검토 |

---

## I. 작업 순서 (Impact 큰 순)

### 1️⃣ CSV / SQL Export — 단판승, 1 sprint
**Why first**: 진입 비용 최저 (결과 row를 이미 보유), 의존 없음, 사용자
마찰 즉시 제거. "왜 이게 없지?" 라는 1순위 질문을 한 sprint로 닫는다.
**범위**: 결과 그리드 우상단 "Export…" 버튼 → CSV / TSV / SQL INSERT 세
포맷, Tauri `save` dialog, 대용량은 스트리밍 write.
**의존**: 없음.

### 2️⃣ Row 인라인 편집 RDB 완성 + Preview/Commit/Discard 게이트 — 2~3 sprint
**Why second**: 데이터 클라이언트의 본질 가치. 이미 진행 중인
`EditableQueryResultGrid` 를 마무리하면서, **모든 mutation을 게이트로
통과시키는 패턴을 동시에 도입**한다. 이 게이트가 후속 #3~#7의 공통 인프라.
**범위**:
- PG `UPDATE … WHERE <pk> = …` 생성기 (PK 부재 시 안전 가드)
- "Pending changes" 트레이 + "Preview SQL" 다이얼로그
- "Commit All / Discard All" 버튼
- Mongo 쪽도 동일 게이트로 재배치
**의존**: 없음. Safe Mode는 #3에서 확장.

### 3️⃣ Safe Mode (프로덕션 가드) — 1 sprint
**Why third**: #2의 게이트 위에 색상 + 룰 한 겹만 더하면 끝. TablePlus
차별 기능을 가장 적은 추가 비용으로 흡수.
**범위**:
- 프로덕션 색 연결 → `WHERE`-less `DELETE`/`UPDATE` 자동 차단
- DDL 실행 전 명시적 confirm
- 게이트 다이얼로그에 색띠 표시
**의존**: #2 (게이트 인프라).

### 4️⃣ Index Write UI — 1 sprint
**Why fourth**: Read는 이미 있고 게이트 패턴도 검증됐으니 가장 작은 cycle로
DDL UI 패턴을 굳힌다. 다음 #5/#6의 템플릿 역할.
**범위**: Structure 패널 → "+ Index" / "− Index" 버튼 + `create_index` /
`drop_index` Tauri command + Preview SQL.
**의존**: #2, #3.

### 5️⃣ Constraint Write UI — 1 sprint
**범위**: PK / FK / Check / Unique 추가/삭제. #4와 동일 패턴.
**의존**: #4.

### 6️⃣ Trigger 관리 (PG) — 1 sprint
**범위**: Schema 트리에 Trigger 노드 + Read/Write. 동일 패턴 확장.
**의존**: #5.

### 7️⃣ Table / Column DDL UI — 2~3 sprint
**Why last**: 가장 큰 수술. 위 모든 인프라(게이트 / Safe Mode / DDL 패턴)를
활용해 테이블 자체의 생성·이름변경·삭제, 컬럼 추가·수정·삭제 UI를 닫는다.
이 시점에서 TablePlus의 `gui-tools/working-with-table/` 영역이 사실상
패리티 달성.
**범위**: Table CRUD 모달 + Column 편집기 (타입/null/default/check) +
인플레이스 rename + Drop with cascade preview.
**의존**: #2 ~ #6.

### 8️⃣+ 후속 (별 cluster)
- View / Function CREATE/EDIT UI — 게이트 패턴 위에 편집기만
- 쿼리 파라미터 (`:name` / `$1`)
- Preferences UI (키맵 재바인딩 우선)
- Backup & Restore (`pg_dump` 통합)
- Data Import (CSV → 테이블)
- 스트리밍 결과 / async 점진 로드
- User/Permission · Metrics Board · 플러그인 / LLM (모두 P3)
