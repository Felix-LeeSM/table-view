# Sprint 190 — Contract

Sprint: `sprint-190` (FB-1b — production 환경 자동 SafeMode / Hard auto 정책).
Date: 2026-05-02.
Type: feature (인터리브 sequencing 의 짝수 sprint).

Phase 23 closure 후속. Sprint 188/189 가 만든 `useSafeModeGate` /
`decideSafeModeAction` 기반 위에서, **production 환경 태그가 붙은
연결에서는 사용자의 Safe Mode toolbar 설정과 무관하게 자동으로 strict
동등 게이트를 적용**한다.

## 1차 가정 — Hard auto 의 정의

`docs/PLAN.md:41` 의 "Hard auto 정책" 표현을 다음과 같이 1차 정의한다.
대안 해석은 §Out of Scope 의 followup 으로 명시.

| 항목 | 1차 가정 |
|------|----------|
| 적용 위치 | `src/lib/safeMode.ts` 의 `decideSafeModeAction` (lib-level). store mode 값 자체는 보존. |
| 트리거 조건 | `environment === "production"` AND `analysis.severity === "danger"`. |
| Off 모드 처리 | `mode === "off"` 가 production 에서 무효 — strict 와 동등하게 block. |
| Warn 모드 처리 | 변경 없음. production + warn + danger → confirm (기존 동일). |
| Strict 모드 처리 | 변경 없음. production + strict + danger → block (기존 동일). |
| 비-production 처리 | 변경 없음. local / testing / development / staging / null → allow. |
| Block 메시지 카피 | `mode === "off"` 케이스만 별도 카피 — "Production environment forces Safe Mode" 류. 사용자가 toolbar 토글로 우회할 수 없다는 사실을 명확히 한다. |

이 가정의 합리성:
- store mode 를 자동 promote 하면 사용자가 의도적으로 off 해 둔 글로벌
  설정이 production 연결을 한 번 열었다는 이유로 silent 하게 strict 로
  바뀜 — Surprising 한 side effect. lib-level 결정이 깨끗.
- Sprint 189 의 `decideSafeModeAction` 가 이미 connection environment 를
  parameter 로 받으므로 추가 wiring 0.

## Sprint 안에서 끝낼 단위

- Off 모드 prod-auto 결정 (`AC-190-01`).
- block 메시지 카피 분기 (`AC-190-02`).
- lib + hook + 5 사이트의 회귀 테스트 정정 (`AC-190-03`).
- toolbar SafeModeToggle 의 off-tooltip 카피 갱신 — "No guard..." 가
  거짓이 되므로 (`AC-190-04`).

## Acceptance Criteria

### AC-190-01 — `decideSafeModeAction` Hard auto 적용

1차 단언: `decideSafeModeAction("off", "production", DANGER)` →
`{ action: "block", reason: <prod-auto canonical> }` (기존 `{ action: "allow" }`
와 다름).

신규 lib 테스트: `src/lib/safeMode.test.ts` 의 case `[AC-189-06a-5]`
(production × off + danger → allow) 갱신. 신규 case `[AC-190-01-1]`:
prod-auto block reason text 도 verbatim 단언 (downstream UI copy drift
가드).

### AC-190-02 — Off 모드 block 카피 분기

`mode === "strict"` block 카피와 구분:

| mode | reason text |
|------|-------------|
| strict | `Safe Mode blocked: ${primary} (toggle Safe Mode off in toolbar to override)` |
| off (prod-auto) | `Safe Mode blocked: ${primary} (production environment forces Safe Mode — change connection environment tag to override)` |

이유:
- strict 카피의 "toggle Safe Mode off" 는 prod-auto 에서 거짓
  (toggle 해도 무효).
- 사용자가 우회하려면 connection 의 environment 태그를 변경해야 하므로
  카피로 안내.

### AC-190-03 — 기존 테스트 회귀 정정

다음 테스트의 기존 단언 (production + off + danger → allow) 이 새 룰로
깨지므로 갱신:

- `src/lib/safeMode.test.ts` `[AC-189-06a-5]`.
- `src/hooks/useSafeModeGate.test.ts` (case 1: mode=off + production →
  allow). 새 단언으로 재작성.
- 5 사이트의 safe-mode 테스트 중 `mode === "off" + production + danger`
  를 단언하는 케이스가 있다면 갱신. 정찰 결과 대부분 strict 또는 warn
  케이스만 단언하므로 영향 적을 것으로 추정 (구현 단계에서 grep).

### AC-190-04 — SafeModeToggle off-tooltip 카피

`SafeModeToggle.tsx:60-69` 의 off-mode tooltip:

```
Safe Mode: Off (click to re-enable production guard)

No guard. Use only for one-off destructive maintenance.
```

→ 갱신:

```
Safe Mode: Off (click to re-enable for non-production)

Production-tagged connections still force Safe Mode automatically.
Use Off only for one-off destructive maintenance on local / testing
/ development / staging.
```

기존 `aria-pressed="false"` / `data-mode="off"` 등 attribute 는 보존.
SafeModeToggle 의 단위 테스트 (`SafeModeToggle.test.tsx`) 가 tooltip
verbatim 을 검증하면 동반 갱신.

## Out of Scope

다음 항목은 본 sprint 에서 손대지 **않는다**. 후속 sprint 에서 검토.

- **Toolbar visual 의 connection-context 인지**. 현재 `SafeModeToggle`
  는 글로벌 mode 만 알고 connection 모름. production 연결에서 toggle
  의 label 을 "Strict (auto)" 로 바꾸려면 active connection state 가
  toolbar 로 흘러들어와야 함 — 별 sprint 단위 (UI 개선).
- **Soft auto 변종** ("production + off → confirm" 으로 부드럽게).
  사용자 피드백 없이 가정으로 결정하지 않음.
- **`mode === "off"` 자체의 의미 재정의**. store 의 cycle (strict →
  warn → off → strict) 는 보존. cycle 자체를 수정하면 toolbar UX
  회귀 위험.
- **Per-connection mode override**. 일부 사용자가 production 인데도
  특정 작업에 off 가 필요할 수 있음 — 본 sprint 는 글로벌 정책만
  적용. per-connection escape hatch 는 별 feedback 후 결정.
- **Telemetry / audit log** of prod-auto block events. 후속.

## 기준 코드 (변경 surface)

- `src/lib/safeMode.ts` — decision matrix 1줄 추가 (off + production +
  danger → block) + 카피 분기 1개.
- `src/lib/safeMode.test.ts` — case 갱신 + 신규 case 1.
- `src/hooks/useSafeModeGate.test.ts` — wiring case 1 갱신.
- `src/components/workspace/SafeModeToggle.tsx` — off-tooltip 카피.
- `src/components/workspace/SafeModeToggle.test.tsx` — tooltip verbatim
  단언이 있다면 동반 갱신.

`useSafeModeGate.ts`, 5 사이트 (`useDataGridEdit`, `EditableQueryResultGrid`,
`ColumnsEditor`, `IndexesEditor`, `ConstraintsEditor`) 는 코드 무변경
(matrix 가 lib 안에 있으므로 자동 적용).

## Dependencies

- Sprint 189 closure: `decideSafeModeAction` extraction + 5 사이트
  마이그레이션 완료. 본 sprint 는 그 위에서 lib 룰 1줄을 추가만 하면
  된다.

## Refs

- `docs/PLAN.md:41` — FB-1b row.
- `docs/refactoring-plan.md:63,80` — sequencing + 묶음 근거.
- `docs/sprints/sprint-189/findings.md` §1 (Phase 23 closure refactor 종료).
- `memory/conventions/refactoring/lib-hook-boundary/memory.md` D-4.
