---
id: 0042
title: Query history retention / privacy / export — local at-rest 정책
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: `query_history` 의 7 항목 (retention / clear-all / disable /
encryption / redaction / export / telemetry) 을 다음과 같이 lock 한다.
A9 (민감 데이터 가능성) 평가 축 추가 — `query_history.sql = likely`.

1. **Retention (기본 30일)** — `settings.query_history_retention_days`
   (default `30`). SQLite `executed_at < now - retention_days` row 는
   boot 시 vacuum. 사용자 변경 가능 (`7 / 30 / 90 / forever`).
2. **Clear-all** — 사용자가 settings 의 "Clear query history" 클릭 →
   `clear_history()` IPC = (BEGIN → SELECT COUNT → DELETE → COMMIT →
   VACUUM → emit_all `{domain:"history", op:"clear", entityId:null}`).
   응답 `{ deletedCount: N }`. 토스트 "N rows cleared".
3. **Disable history (`query_history_enabled` boolean, default `true`)**
   — `false` 면 frontend 가 `add_history_entry` IPC 호출 안 함. 기존
   row 는 유지 (별도 clear). Key 이름 = 동작 의미.
4. **Encryption at rest = OS file-perm only** — SQLite 파일은 user-only
   read perm. 추가 sqlite-cipher 미도입 (cross-platform 빌드 비용 >
   이득). 디스크 풀-디스크 암호화 가정.
5. **Sql redaction (필수 컬럼)** — `sql_redacted` NOT NULL — 항상 backend
   가 생성. Regex 로 quoted literal `?` 마스킹. Redact 함수 panic /
   예외 시 원문 `sql` fallback (column 채워짐, 검색 path 단일). 검색은
   `sql_redacted` 위 (false negative 적음). 원문은 row detail view 에서만.
6. **Export 분리** — Q1 의 `export_connections_encrypted` envelope 은
   **connections only**. Query history 는 별 메뉴 `Export query history`
   (단순 JSON dump + 사용자 확인 dialog). Envelope 과 history export
   는 별 wire / 별 path — envelope 확장이 아님.
7. **Telemetry — 외부 송신 0** — ADR 0036 의 zero-collection 정책 따름.
   `sql` / `sql_redacted` 모두 외부 서버로 송신 0.

**이유**:

1. **A9 `likely` 분류 = SQL 본문의 PII 위험** — `WHERE email='alice@…'`
   같은 literal 은 일상적. 익명화 사실상 불가능 (Q10 telemetry zero 의
   근거). Retention / redaction / disable / export 의 모든 정책이 그
   위험 가정 위에서.
2. **30일 default = 사용자 가치 vs 위험 균형** — 사용자 가 어제 실행한
   query 다시 찾고 싶은 빈도 높음 (A2/A5). 30일 이면 typical 작업 cycle
   covering. 7d 옵션은 paranoid 사용자, 90d/forever 는 audit 필요 사용자.
3. **Disable toggle = 짧은 escape hatch** — Production query 분석 중
   민감 데이터 입력 직전 toggle off, 후 다시 on. Row 보존이라 기존 history
   접근 가능 (clear-all 과 분리).
4. **sqlite-cipher 미도입의 ROI 판단** — Cross-platform 빌드 비용 (musl
   linux / Windows MSVC / macOS universal2 의 cipher 라이브러리 매트릭스)
   + 사용자 password prompt UX + key 관리 부담 vs 디스크 풀-디스크 암호화
   (이미 OS-level 가정) 의 추가 보호. 후자가 충분 가정.
5. **Sql redaction NOT NULL + fallback 의 안전망** — Redact 함수 panic
   해도 column 은 항상 채워짐 = 검색 path 가 NULL handling 분기 0.
   원문 fallback 은 검색 false negative 가 약간 늘지만 (literal 그대로
   매칭) row 자체는 보존. 원문 노출 surface 는 detail IPC 1곳만.
6. **Export 분리 = envelope contract 보호** — ADR 0021 envelope 의
   "connections only" lock 은 connection 도구의 import/export 워크플로우
   에 최적화 (mnemonic + Argon2id). History 는 사용자가 *분명히* 다른
   목적 (audit log, 외부 분석) — 별 wire 가 명확 + envelope 의 KDF 비용
   재사용 안 함.

**트레이드오프**:

- **+** A9 `likely` 위험을 명시적 contract 로 인식 — retention / redaction
  / disable / export 모두 그 위험 가정 위에서.
- **+** 30일 default 가 사용자 가치 vs 위험 균형 — 옵션으로 사용자 자율
  조정.
- **+** Disable toggle 의 짧은 escape hatch — 민감 query 입력 직전 off
  가능.
- **+** Redact NOT NULL + fallback 으로 검색 path 단일 + row 보존 보장.
- **+** Export 분리로 envelope contract / history export contract 독립
  진화 가능.
- **+** Telemetry zero 와 일관 — `sql` / `sql_redacted` 모두 외부 송신 0.
- **−** Disk 풀-디스크 암호화 안 한 사용자의 위험 — SQLite 파일이
  user-only perm 뿐. 풀 디스크 dump (`.corrupt-XXX` 파일 포함) 시
  history 노출. ADR 0040 의 OS keyring 보호 범위 밖.
- **−** Redact 함수의 false negative — regex 로 quoted literal 만 마스킹.
  Unquoted numeric literal (`WHERE user_id = 12345`) 은 unmasked. 사용자
  PII 가 numeric id 면 노출. 단 검색 path 의 false negative 가 false
  positive 보다 안전 (작은 noise).
- **−** Export 의 사용자 확인 dialog — 한 번 더 클릭 friction. 단 export
  자체가 흔하지 않은 작업 (audit 용) 이라 빈도 낮음.
- **−** sqlite-cipher 미도입의 위험 — laptop 도난 + 풀-디스크 암호화
  미사용 + OS 로그인 깬 시나리오 (Threat 1 의 부분 보호) 에서 history
  노출. ADR 0040 의 keyring 은 `connections.password_enc` 의 master 만
  보호 — history 는 별 layer.

**관련**:

- state-management-strategy-2026-05-15.md §F.5 line 1473–1597 (query history privacy
  contract — 7 항목 모두)
- state-management-strategy-2026-05-15.md §Q7 line 418 (audit log — `query_history.source`
  필드 확장)
- state-management-strategy-2026-05-15.md §Phase 1 line 535–613 (`query_history` schema
  + add_history_entry wire)
- state-management-strategy-2026-05-15.md §Phase 5 line 786–792 (queryHistoryStore
  retire + SQLite 이주)
- state-management-strategy-2026-05-15.md §F.4 line 1365–1368 (history clear event)
- ADR 0021 — Export envelope (connections only — history 별 wire)
- ADR 0032 — SQLite infrastructure (`query_history` table + retention
  vacuum)
- ADR 0033 — Cross-window sync (`history` domain `create`/`clear` event)
- ADR 0036 — Telemetry zero collection (sql 외부 송신 0 의 ADR 근거)
- ADR 0038 — Theme/SafeMode SOT (`settings.query_history_retention_days`
  / `query_history_enabled` 가 같은 settings table)
- ADR 0040 — File-key OS keyring (별 layer — connection password 만 보호,
  history 는 미보호)
