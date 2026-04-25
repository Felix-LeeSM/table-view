# Sprint 116: ⚠️ 실사용 검증 추적 문서 (§8)

**Source**: `docs/ui-evaluation-results.md` §8
**Depends on**: —
**Verification Profile**: static

## Goal

§8 의 ⚠️ 항목 중 코드로 해결 불가한 것은 검증 체크리스트로 추적 문서화해, 실측 검증(FPS, VoiceOver 등) 이 잊히지 않도록 한다.

## Acceptance Criteria

1. `docs/ui-evaluation-followup.md` (신규) 가 §8 의 9개 ⚠️ 항목별로 (a) 검증 절차, (b) 담당, (c) 종결 조건을 나열한다.
2. 각 항목은 "active / verified / deferred" 상태를 가진다.
3. 문서가 `docs/RISKS.md` 또는 master index 에서 참조된다.
4. 새 ⚠️ 항목 추가 절차가 문서 끝에 기재된다.

## Components to Create/Modify

- `docs/ui-evaluation-followup.md` (신규): ⚠️ 추적 체크리스트.
