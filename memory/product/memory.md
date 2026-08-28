---
title: Product 머지 기준
type: product-rule
updated: 2026-08-28
task: ux-review, persistence-reset, merge-gate, safe-mode-severity, collapse-default, telemetry-local-only
keywords: reset-to-default, 영속 상태, Reset to defaults, Safe Mode severity, danger, warn, sqlSafety.ts, required_confirmation_key, RedisCommandEffect::Destructive, KV_CONFIRM_COMMANDS, kvDestructiveTier.test.ts, 첫번째만 펼침, 텔레메트리, ADR 0036, 머지 보류
---

# Product 머지 기준

현재 제품 동작에 직접 영향을 주는 UX merge gate. PR 머지 전 체크한다. 코드 convention
(Rust/TS) 과 직교.

## Ownership / SOT

- 이 파일은 반복 적용되는 product merge rule 만 소유한다.
- 현재 제품 상태와 support claim 은 [docs/product](../../docs/product/README.md)
  가 소유한다.
- 미래 목표와 sequencing 은 [docs/ROADMAP.md](../../docs/ROADMAP.md) 가 소유한다.
- 과거 UX audit 는 historical evidence 로만 본다. active rule 로 복제하지 않는다.

## 1. 영속 상태는 reset-to-default UI 필수

영속되는 모든 사용자 상태 (settings / per-table prefs / collapse 상태 등) 는 사용자가 직관적 위치에서 default 로 되돌릴 affordance 가 같이 머지되어야 함. **Reset UI 없는 영속 상태 = PR 머지 보류.**

### 위치 룰

| 영속 단위                                               | Reset 위치                            |
| ------------------------------------------------------- | ------------------------------------- |
| Tiny UI 가구 (collapse / width)                         | 더블클릭 또는 우클릭 메뉴 "Reset"     |
| Per-entity prefs (table column widths / hidden columns) | 그 entity 의 헤더 우클릭 메뉴         |
| Global settings (theme / safe mode / retention 등)      | 설정 패널 안 "Reset to defaults" 버튼 |
| Workspace layout (sidebar expand 상태 등)               | sidebar 헤더 메뉴                     |

### Why

사용자 2026-05-16 state-management grill Q21 명시 요구. 영속 가치만 보고 reset path 누락하면 사용자가 "한 번 잘못 조절하면 영원히 그 상태" 라고 느끼게 됨 (LS / SQLite 직접 편집 외 escape hatch 없음).

### How to apply

새 영속 상태 추가 PR 마다 reset affordance 위치 명시. 미커버 항목 발견 시 그 PR 에서 같이 추가. 별도 PR 미루지 마 — "추가하겠다" 약속만 남으면 잊힘.

State-management reset gate 는
[engineering/state-management](../engineering/architecture/state-management/memory.md)
와 함께 적용한다.

## 2. Safe Mode severity 배정 원칙

새 구문/명령/패러다임에 severity tier 를 배정하는 PR 은 다음 축을 따른다 (2026-07-02 결정, issue #1120):

- **danger 는 비가역 데이터 파괴 전용.** confirm 다이얼로그의 무게를 유지한다 — 파괴가 아닌 위험(권한 변경 GRANT/REVOKE 등)은 전 방언/패러다임 **warn 통일**.
- **parity 축은 구문 형태가 아니라 "영향 범위 × 손실성".** 같은 "upsert" 라도: 행 단위·지정 컬럼(INSERT ON CONFLICT) = info / 테이블·컬렉션 단위 덮어쓰기($merge, $out, WHERE-less DML) = danger. 행 단위·전체 리셋도 이 축상 danger 다 — `REPLACE …` 는 `src/lib/sql/sqlSafetyClassifier.ts` 의 `^REPLACE\b` 분기가 `dml-replace` / `danger` 로 내고 `src/lib/sql/sqlSafety.test.ts` 의 `[AC-1115-01]`~`[AC-1115-06]` 이 그 tier 와 false-positive 가드를 잠근다 (#1115 전에는 그 분기가 없어 default `{kind:"other", severity:"info"}` 로 무경고 allow 였다). frontend 의 그 `^REPLACE\b` 도 backend `src-tauri/sql-parser-core/src/safety.rs` 의 `starts_with_keyword(upper, "REPLACE")` 도 선행 키워드로만 잡으므로 SQLite 의 `INSERT OR REPLACE` 어형은 어느 쪽에도 안 걸려 무경고 info 였다 — #2272 가 양쪽에 전용 분기를 세워 같은 tier 로 닫았고, #2288 이 그 분기를 동사에서 떼어 `OR REPLACE` 절 자체를 보게 했다. SQLite 는 이 절을 쓰기 동사 둘(`INSERT`·`UPDATE`)에 붙이고, `UPDATE OR REPLACE … WHERE …` 는 **WHERE 가 안 고른 행**을 지우므로 「WHERE 로 영향 범위가 묶였다」는 warn 근거가 그 자리에서 무너진다 — 즉 tier 를 매기는 전제를 무효로 만드는 수식어다(분기 하나가 빠진 것이 아니다). 지금 분기는 frontend `src/lib/sql/sqlSafetyClassifier.ts` 의 `^(INSERT|UPDATE)\s+OR\s+REPLACE\b`, backend `src-tauri/sql-parser-core/src/safety.rs` 의 앞 낱말 대조(`INSERT`|`UPDATE` / `OR` / `REPLACE`)이고, `tests/fixtures/classifier-parity.json` 의 `sqlite_insert_or_replace` · `sqlite_update_or_replace_where` 가 그 frontend·backend 분기를 한 파일로 잠근다. 동사 집합은 SQLite 가 이 절을 허용하는 둘로 닫는다 — 아무 동사나 받으면 `CREATE OR REPLACE VIEW`(설계상 info)를 삼킨다. 나머지 conflict algorithm(`ROLLBACK`·`ABORT`·`FAIL`·`IGNORE`)은 충돌 행을 안 지우므로 두 동사 모두 이 축 밖이고 tier 를 안 올린다.
- Redis 등 backend allowlist 가 실제 안전 경계인 패러다임은 frontend 분류기를 full 동기화하지 않고, 집합 둘만 mirror 해서 SQL 과 동일한 confirm 다이얼로그로 라우팅한다. 하나는 backend 가 확인 값을 요구하는 집합이고, 다른 하나는 backend 가 `RedisCommandEffect::Destructive` 로 분류하는 verb 전부다. 뒤의 집합은 #2513 이 더했다.
  - **명시적 예외**: KV 경로에는 warn→confirm 표면이 따로 없어서 `danger` tier 를 confirm 다이얼로그로 보내는 레버로 재사용한다. KEYS(전수 스캔)와 PERSIST(TTL 제거)는 파괴적이지 않고 DEL 도 단일 키만 지우므로 영향×손실 축에서는 warn 인데, 셋 다 그 축이 아니라 backend confirm 집합을 mirror 한다는 이유로 `danger` 를 받는다. #2513 이 더한 HDEL·LREM·SREM·ZREM·XDEL·XTRIM 은 실제로 데이터를 잃지만, 이들도 축 판정이 아니라 backend 의 `Destructive` 분류를 mirror 하기 때문에 같은 tier 를 받는다. 따라서 KV 명령은 impact×손실성 parity 표에 넣지 않고 `src/components/query/QueryTab/kvQueryExecution.test.ts` 와 `src/components/query/QueryTab/kvDestructiveTier.test.ts` 로 고정한다. 뒤의 파일은 verb 마다 콘솔 경로와 구조 편집기 경로가 같은 tier 를 내는지와 같은 명령 문자열을 만드는지를 단언한다.
- 새 tier 배정은 이 축으로 정당화하고 parity 표 테스트(`src/lib/crossParadigmSeverityParity.test.ts`)에 반영한다.

### Why

사용자 원칙 "같은 위험 = 같은 경고" (일관된 UX). tier 가 방언·패러다임별로 다르면 사용자 멘탈 모델이 깨지고, danger 남발은 confirm 피로로 보호 효과를 죽인다.

## 3. 접힘 가능 항목 다수 = 첫번째만 펼침

접힐 수 있는 섹션/노드가 여러 개 나열되는 UI 의 **신규 시드 기본값**은 가장 첫번째
항목만 펼치고 나머지는 전부 접는다 (2026-07-03 사용자 확정). 사용자가 바꾼 펼침
상태는 보존 — 원칙은 첫 방문 시드에만 적용되고, 영속된 상태가 있으면 그것이 이긴다.

적용 예: 사이드바 스키마 트리 (#1217 — 첫 스키마만 펼침), 다중 섹션 패널 일반.

### Why

대량 항목에서 전부 펼치면 조망이 사라진다 ("스키마/테이블 많을 때 보기 어렵다"
2026-07-03 피드백의 일반화). 전부 접으면 첫 진입 시 빈 화면 — 첫번째만 펼쳐 내용
힌트를 준다.

### How to apply

접힘 가능 목록을 새로 만들거나 시드 로직을 만지는 PR 에서 기본값을 이 원칙에 맞춘다.
§1 에 따라 collapse 상태가 영속되면 reset affordance 도 함께.

## 4. 진단/로그 출력은 로컬 전용 (ADR 0036 재확인)

로그·진단 번들은 기계를 떠나지 않는다. **원격 crash reporter / 텔레메트리 도입 PR = 머지 보류** (ADR 0036 zero external collection 재확인, 2026-07-16 사용자 재확정).

로컬 진단만 허용: 파일 로그 + `panic::set_hook` + Reveal Logs 버튼 (#1564~1566). 사용자가 버그 리포트에 **수동 첨부**한다.

### Why

1. ROADMAP 전략제약 "credentials/history/settings/app state 는 명시적 export 없인 로컬에 남긴다" 직접 충족 + "주장하는 보호 = 실제 보호" 일관성.
2. **로그 번들 = 크레덴셜 벡터**: wave 28 감사가 로그/히스토리 내 평문 자격증명 유출 확인 (#1550 Oracle REPLACE, #1551 MSSQL HASHED, #1553 error_message). redaction 미완 상태의 원격 업로드 = 크레덴셜 exfiltration.

### How to apply

원격 진단을 정말 도입하려면 조건부 게이트 3개를 **먼저** 통과: (1) opt-in only (기본 off + 명시 동의 UX), (2) sql_redact 3건(#1550/1551/1553) 선행 머지, (3) `security-handoff`→grill threat-model 후 **ADR 0036 superseding 새 ADR**. 이 셋 없이 원격 송신 코드 = 머지 보류.

## 관련

- [engineering/conventions](../engineering/conventions/memory.md) — TS/React 코드 룰
- [workflow/delivery](../workflow/delivery/memory.md) — 머지 직전 checkpoint
- [docs/product](../../docs/product/README.md) — 현재 제품 상태
- [docs/ROADMAP.md](../../docs/ROADMAP.md) — 미래 목표 / sequencing
- [docs/archives/audits/ux-laws-mapping-2026-04-30.md](../../docs/archives/audits/ux-laws-mapping-2026-04-30.md) — historical UX audit snapshot
