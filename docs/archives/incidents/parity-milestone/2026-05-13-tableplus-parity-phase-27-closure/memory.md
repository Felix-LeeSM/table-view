---
title: TablePlus parity milestone — Phase 21–27 closure retro
type: memory
updated: 2026-05-13
---

# TablePlus 패리티 7단계 종료 회고 (Phase 21–27)

Sprint 237 종료로 TablePlus 패리티 7단계 (Phase 21–27) 가 모두 마감됐다.
2026-04 후반 ~ 2026-05 중순, 약 3주짜리 cycle 의 핵심 결정과 패턴, 닫힌
사용자 워크플로우, 미달 항목을 한 페이지에 박제한다.

## 사실 (sprint mapping)

| Phase | 영역                                | sprint 범위                         | 종료일         |
| ----- | ----------------------------------- | ----------------------------------- | -------------- |
| 21    | CSV / SQL / JSON Export             | 181                                 | 2026-04-30     |
| 22    | Row 인라인 + Preview/Commit/Discard | 182–184                             | 2026-04-30     |
| 23    | Safe Mode (production guard)        | 185–188                             | 2026-05-01     |
| 24    | Index Write UI                      | 226–229 (Phase 27 plan 안에서 흡수) | 2026-05-08     |
| 25    | Constraint Write UI                 | 229–230                             | 2026-05-08     |
| 26    | Trigger 관리                        | 272–275                             | 2026-05-12     |
| 27    | Table / Column DDL UI               | **226–237**                         | **2026-05-13** |

Sprint 237 가 Phase 27 의 마지막 polish — `ColumnChange::Modify` 에
`using_expression: Option<String>` 추가, PG SQL emitter 의 USING 갈래
fixture 3건, `count_null_rows` Tauri command + 5 backend unit test,
`ColumnsEditor` USING input + 500 ms debounced NULL-rows 사전 표시
warning, vitest 4건 (USING 시각성 토글 / payload 통과 / count > 0 warning
/ count === 0 silent).

## 핵심 결정 (decisions that propagated)

- **`useDdlPreviewExecution` (Sprint 214, freeze)** — Phase 24–27 의 모든
  DDL 모달 / 인라인 에디터가 단일 hook 으로 preview/commit lifecycle 을
  공유. 시그니처는 freeze; 도메인 정리는 closure 안에서. Sprint 237 도
  동일 — `loadPreview(() => alterTable(req(true)), () => async () => {
await alterTable(req(false)); /* reset */ })` 패턴.
- **`sqlSafety` analyzer + `useSafeModeGate.decide`** — production /
  warn / strict 매트릭스가 단일 hook 에서 결정. DDL/DML/Mongo aggregate
  모두 같은 경로로 들어와 ConfirmDestructiveDialog 를 마운트.
- **`expected_database` opt-in 가드 (Sprint 266 → 271c, 2026-05-12 →
  2026-05-13)** — 12 schema introspection + 11 DDL + 3 query command =
  26 IPC handler 가 모두 `expected_database: Option<String>` (`#[serde
(default)]`) 를 받고 `ensure_expected_db(adapter, expected)` 로 검증.
  `None` 은 byte-equivalent, `Some` 만 `current_database` probe.
  Sprint 237 의 `count_null_rows` 도 같은 패턴.
- **ADR 0019 (2026-05-01) — e2e 를 CI 에서 제거, pre-push 만**. host
  docker tauri-driver 가 macOS 미지원이라 CI 의 e2e 가 데드. 패리티
  cycle 동안 회귀 가드는 pre-push 의 e2e + 매 sprint 의 vitest /
  cargo test 가 담당. ADR 0020 으로 host docker 한정 명시.
- **identifier validator 단일화** — `db/postgres/mutations.rs::
validate_identifier` (`[a-zA-Z_][a-zA-Z0-9_]*`, NAMEDATALEN 63 byte)
  가 모든 DDL emitter + Sprint 237 `count_null_rows` 의 SQL injection
  floor. Sprint 237 에서 `pub(crate)` 로 visibility hoist 한 외에는
  rules 가 변하지 않았다.
- **Preview/commit 별도 IPC** — 매 dialog 가 `previewOnly: true` 와
  `previewOnly: false` 를 같은 wrapper 로 호출. Show DDL pane 의 SQL 이
  곧 commit 의 SQL.

## 사용자 워크플로 — 닫힌 surface

- **연결**: production environment 자동 Safe Mode (Sprint 190 FB-1b).
- **스키마 트리**: schema → table → column 우클릭으로 CREATE TABLE /
  RENAME TABLE / DROP TABLE / + Column / Drop Column / Edit pencil (=
  inline MODIFY) / CREATE INDEX / DROP INDEX / ADD CONSTRAINT / DROP
  CONSTRAINT / CREATE TRIGGER / DROP TRIGGER 가 모두 modal 또는 inline
  preview pane 으로 도달.
- **Column MODIFY**: 타입 변경 시 USING cast 표현식 입력 가능 (Sprint
  237 AC-237-02/03). nullable → NOT NULL 토글 시 500 ms 후
  `count_null_rows` 가 사전 표시 — `N rows have NULL — adding NOT NULL
will fail` (Sprint 237 AC-237-04).
- **DDL trigger / preview / commit 일관성**: `useDdlPreviewExecution` +
  `sqlSafety` + `useSafeModeGate` 패턴이 6 영역 동일. `;`-split → 매
  statement 분석 → strict/warn/safe 분기.
- **DbMismatch 사전 차단**: 어떤 DDL 도 backend pool 이 swap 된 상태
  에서 잘못된 db 에 실행되지 않는다 (Sprint 271c).

## 패리티 미달 — 보류 / out-of-scope

- **Phase 17–20 (MySQL / MariaDB / SQLite / Oracle)** — Phase 21–27
  종료 시 재평가 트리거 발동 (2026-05-13). RDB 도형은 PG 전용 — 다른
  dialect 의 비용 대비 가치 재산정 필요.
- **Column reorder** — PG 가 `ALTER COLUMN POSITION` 을 native 지원
  하지 않아 recreate 가 필요. Phase 27 의 명시적 out-of-scope.
- **Column rename** — Sprint 237 에서 out-of-scope 으로 deferred.
  follow-up sprint 후보.
- **PARTITION / MATERIALIZED VIEW / TABLESPACE / TEMP TABLE** — Phase
  27 out-of-scope (`docs/archives/phases/completed/phase-27.md` § Out of Scope).
- **MongoDB collection schema validation** — 별 paradigm. Mongo 측은
  bulk-write (Sprint 198) 까지로 패리티 cycle 마감.
- **USING 표현식 syntax check** — free-text passthrough, PG 의 verbatim
  error 가 source of truth. AST parse / client-side syntax assist 는
  의도적으로 도입 안 함.
- **Type-change cast simulation / default validity check** — Sprint
  237 의 NULL-rows 가드 외 다른 pre-execution 충돌 표시는 out.

## 다음 cycle 후보 (Phase 17–20 재평가 입력값)

- 사용자 요구 강도 (현재 production 사용자 = PG only?).
- adapter trait 의 method × 4 dialect = ~4× 비용. trait default 가 이미
  PG 외 어댑터에 `Unsupported` 를 surface 하고 있어 incremental 진입은
  가능 (e.g. SQLite 만 먼저 — 단일 파일 / 트랜잭션 단순).
- MySQL / MariaDB 는 `ALTER TABLE` semantics + COMMENT 가 PG 와 다름
  (`CHANGE COLUMN`, table-level `COMMENT='...'`). DDL emitter 분기 비용
  estimate 필요.
- Oracle 은 driver / license 분리 + dialect 차이가 가장 큼. 후순위.

## 회고적 교훈

- **단일 hook 의 freeze 가 6 surface 의 일관성을 가져왔다.**
  `useDdlPreviewExecution` 시그니처를 sprint 214 에서 freeze 한 결정이
  Sprint 226–237 의 모든 새 DDL surface 의 lifecycle 을 자동으로
  통일시켰다. 도메인 cleanup 은 closure 안에서.
- **`expected_database` 의 opt-in 도입이 26 IPC 의 mismatch 가드를
  byte-equivalent 하게 닫았다.** Sprint 266 의 single-path probe 가
  Sprint 271 의 풀 cycle 마이그레이션의 청사진이 됐다.
- **identifier validator 의 단일화가 SQL injection 의 단일 floor
  였다.** Sprint 237 의 `count_null_rows` 도 raw-SQL 갈래 (parameter
  binding 불가) 인데도 동일 validator + `quote_identifier` 두 단계로
  safety contract 를 유지했다.
- **Closure marker 의 가치** — Phase 종료 시 ADR 새로 만들지 않고
  retro 1편 + PLAN status flip + roadmap row 갱신 3종 만으로 마일스톤
  fingerprint 충분. ADR 의 동결 본문에는 trade-off 가 있는 결정만
  담는다.

## 관련

- ADR 0019, 0020 — e2e 정책.
- ADR 0022 — destructive confirm dialog (Phase 23 → Sprint 245–247).
- ADR 0012 — launcher/workspace split (Phase 12).
- [docs/PLAN.md](../../../../PLAN.md) Phase 27 row.
- [docs/archives/roadmaps/memory-roadmap/memory.md](../../../roadmaps/memory-roadmap/memory.md) 패리티
  마일스톤 row.
- 영역별 phase spec: `docs/phases/phase-{21..27}.md`.
