# Sprint Contract: sprint-374

## Summary

- Goal: Phase 6 ADR-0032 ~ ADR-0042 final commit + 머지. 11 ADR — state-management-strategy-2026-05-15 §6 의 매핑 (line 798–808):
  - ADR-0032 SQLite 인프라 + atomic snapshot bootstrap (Q1/Q9 + SQLite 도입)
  - ADR-0033 Single-instance + in-process cross-window sync (Q3/Q4)
  - ADR-0034 Per-tab connection affinity + native cancel (Q5.x 통합)
  - ADR-0035 Corrupt recovery silent quarantine (Q2)
  - ADR-0036 Telemetry zero collection (Q10) — privacy contract
  - ADR-0037 Auto-update notification-only (Q11)
  - ADR-0038 Theme/SafeMode SOT — SQLite truth + LS FOUC cache (Q12)
  - ADR-0039 Workspace window 정책 (Q13). `open_workspace_window` idempotent
  - ADR-0040 File-key OS keyring (Q22)
  - ADR-0041 SchemaCache cross-window invalidation (Q23)
  - ADR-0042 Query history retention/privacy/export (F.5)
- Audience: state-management-strategy 결정 영속화 — 의사결정 + 트레이드오프 동결.
- Owner: Generator (sprint-374)
- Verification Profile: `docs` (lint + memory palace rule 검증)

## In Scope

- `docs/archives/decisions/0032-sqlite-infrastructure-and-atomic-snapshot/memory.md` — Q1 + Q9 + SQLite 도입.
- `docs/archives/decisions/0033-single-instance-and-cross-window-sync/memory.md` — Q3 + Q4 (in-process emit_all + dedup/self-echo/gap refetch/reset no-refetch).
- `docs/archives/decisions/0034-per-tab-connection-affinity-and-native-cancel/memory.md` — Q5.1~Q5.6 통합.
- `docs/archives/decisions/0035-corrupt-recovery-silent-quarantine/memory.md` — Q2.
- `docs/archives/decisions/0036-telemetry-zero-collection/memory.md` — Q10.
- `docs/archives/decisions/0037-auto-update-notification-only/memory.md` — Q11.
- `docs/archives/decisions/0038-theme-safemode-sqlite-sot-ls-fouc-cache/memory.md` — Q12.
- `docs/archives/decisions/0039-workspace-window-per-connection/memory.md` — Q13.
- `docs/archives/decisions/0040-file-key-os-keyring/memory.md` — Q22 + 3 path migration.
- `docs/archives/decisions/0041-schema-cache-eager-wide-invalidate/memory.md` — Q23.
- `docs/archives/decisions/0042-query-history-privacy/memory.md` — F.5 7항목 (retention / clear / disable / no encryption / redaction / export / telemetry).
- 각 ADR 의 frontmatter: `status: Accepted`, `date: 2026-XX-XX`, `tags`, `superseded_by: -`.
- 본문 < 200 줄 (메모리 팔레스 규칙).
- `docs/archives/decisions/memory.md` 인덱스에 11개 entry 추가.

## Out of Scope

- ADR 본문 사후 수정 (작성 순간 동결 — `CLAUDE.md` 룰).
- ADR-0031 이하 영향.
- 새 결정 도입 (모두 sprint-353~373 의 lock 결정 인용).

## Invariants

- 각 ADR < 200 줄.
- ADR 인덱스 < 200 줄.
- frontmatter `status` 만 갱신 가능.
- 본문 동결.
- 11 ADR `status: Accepted` + 정합 cross-link.
- 매핑 순서 = strategy 문서 §6 (line 798–808) 와 byte-equivalent.

## Acceptance Criteria

- `AC-374-01` 11 ADR 파일 모두 존재 + frontmatter 정합. Test: `scripts/check-adr-frontmatter.sh`.
- `AC-374-02` 각 ADR < 200 줄. Test: `wc -l` 11 파일.
- `AC-374-03` `docs/archives/decisions/memory.md` 인덱스 < 200 줄 + 11 entry. Test.
- `AC-374-04` Cross-link: 각 ADR 본문에 `state-management-strategy-2026-05-15.md` 의 Q번호 / F.번호 인용 + line 번호 인용. Test: grep.
- `AC-374-05` `status: Accepted` 11개. Test: frontmatter parse.
- `AC-374-06` 매핑 일치: ADR title + Q번호가 state-management-strategy line 798–808 과 1:1 매핑. Test: 매핑표 commit + diff.

## Design Bar / Quality Bar

- ADR draft 는 본 sprint 시작 전 sprint-355~373 의 generator 가 작성해도 됨. 본 sprint 는 final commit.
- 본문은 결정 + 이유 + 트레이드오프 + 대안 검토 — `docs/archives/decisions/template.md` 따름.
- 11개 ADR 간 cross-link 명시 (예: ADR-0033 가 ADR-0039 의 `open_workspace_window` 인용).

## Verification Plan

### Required Checks

1. `bash scripts/check-adr-frontmatter.sh docs/archives/decisions/00{32..42}-*/memory.md`
2. `for f in docs/archives/decisions/00{32..42}-*/memory.md; do wc -l "$f"; done`
3. `wc -l docs/archives/decisions/memory.md`
4. `for i in 32 33 34 35 36 37 38 39 40 41 42; do rg "state-management-strategy-2026-05-15" docs/archives/decisions/00$i-*/memory.md; done`
5. `pnpm lint && pnpm tsc --noEmit`

### Required Evidence

- 11 ADR 파일 list + size raw.
- frontmatter status raw.
- Cross-link grep raw.
- 매핑표 (handoff).

## Test Requirements

- Doc lint (사이즈 + frontmatter + grep cross-link).
- 별 unit test 없음.

## Test Script / Repro Script

1. `bash scripts/check-adr-frontmatter.sh docs/archives/decisions/00{32..42}-*/memory.md`
2. `wc -l docs/archives/decisions/00{32..42}-*/memory.md docs/archives/decisions/memory.md`
3. `pnpm lint && pnpm tsc --noEmit`

## Ownership

- Generator: general-purpose Agent (또는 한 ADR 씩 분배 가능).
- Write scope: 11 ADR + 인덱스. 기존 ADR 변경 0.
- Merge order: 모든 sprint (353~373) 이후. 마지막 phase.

## Exit Criteria

- Open P1/P2: 0
- AC 6/6 PASS
- 11 ADR + 인덱스 머지
- 각 < 200 줄, frontmatter 정합
- 매핑이 strategy §6 line 798–808 과 1:1
