---
id: 0035
title: Corrupt 영속 recovery — silent quarantine + fresh start
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: SQLite 영속 파일이 corrupt (PRAGMA `integrity_check` 실패 /
open error / migration 실패) 일 때, 사용자에게 toast/dialog 없이 silent
quarantine 하고 fresh start 한다.

1. **Detection** — Boot 시 `PRAGMA integrity_check` 실행. `ok` 외 응답
   → corrupt. Open 자체가 SQLite error 던지면 corrupt. Migration runner
   가 `0001_initial.sql` 외 미적용 marker 만나면 corrupt.
2. **Quarantine** — Corrupt 파일을 `.corrupt-{unix_timestamp}` 또는
   `.bak` suffix 로 rename. 사용자 디스크에서 파일은 *보존* — 향후 디버깅
   / data recovery tool 의존 가능.
3. **Fresh start** — 새 빈 SQLite 파일로 재초기화 (migration runner
   재실행). Frontend 는 empty snapshot 받음 — first-run 과 동일한
   "Add Connection" CTA (Q8) 노출.
4. **No user toast** — 디버깅 시 dev console 에 1줄 log 만 (`[storage]
   corrupt detected, quarantined to .corrupt-XXX`). 사용자 UI 알림 0.

**이유**:

1. **사용자 가치 / 짜증 (A8) 균형** — corrupt 는 (a) 빈번 (b) 사용자가
   해결할 수 있는 일이 아님. Toast 띄우면 사용자가 "internal error" 만
   확인하고 다시 클릭해야 함 = noise. Silent recovery + empty state 가
   사용자가 즉시 다음 작업 (add connection) 진행 가능.
2. **데이터 보존 (디버깅용)** — Quarantine 의 rename 이 *delete* 가
   아닌 이유: 사용자가 "내 connection list 사라졌어요" 라고 신고하면
   support 가 `.corrupt-XXX` 파일을 검사해 root cause 분석 가능. Disk
   full 위험은 Phase 6 의 cron / W4 cleanup 으로 30d 후 정리 (file-LS
   migration 의 `.legacy.json` 과 동일 라이프사이클).
3. **First-run 패리티 (Q8)** — 새 사용자 boot 와 corrupt recovery 의
   UX 가 동일 (빈 화면 + "Add Connection" CTA). 분기 0, 사용자 인지
   부담 최소.
4. **No toast 의 명시적 결정 (Q2 'a' lock)** — 검토된 대안: (a) silent
   (선택), (b) toast 로 안내 "이전 데이터 손상 — 복구하지 못함", (c)
   dialog 로 수동 recover 버튼. (b)/(c) 모두 사용자가 "그래서 뭘 하라
   고?" 가 답 없는 noise. (a) 가 사용자 가치 가장 높음.

**트레이드오프**:

- **+** 사용자 zero-friction recovery — fresh boot 와 동등 UX, 첫 화면
  에서 즉시 connection 추가 가능.
- **+** 데이터 보존 — `.corrupt-XXX` 파일 로 향후 recovery tool /
  support diagnosis 가능.
- **+** 코드 단순 — boot path 분기 0 (corrupt 도 first-run 으로 처리).
- **+** Toast / dialog 미도입으로 i18n 부담 0 (해당 message 번역 0).
- **−** 사용자가 "내 데이터 어디 갔어요?" 신고할 때 silent recovery
  였다는 사실 알려면 support 가 `.corrupt-XXX` 파일 존재 확인 + 사용자
  에게 전달 필요. Dev console log 가 1차 단서.
- **−** Disk full 위험 — corrupt 가 자주 발생하는 디스크 (실패 직전
  SSD) 에서 `.corrupt-XXX` 파일 누적. Phase 6 cron 으로 30d 후 cleanup
  으로 완화.
- **−** Connection 비밀번호 ciphertext 가 corrupt SQLite 안에만 있으면
  사용자가 비밀번호 재입력 필요 — 별도 `connections.json.legacy` 백업
  과 차이. Phase 6 W4 의 30d 보관기간이 안전망.

**관련**:

- state-management-strategy-2026-05-15.md §Q2 line 405 (silent quarantine 선택)
- state-management-strategy-2026-05-15.md §F.1 line 835–909 (migration contract — W3
  까지 `--rollback-state` flag, W4 이후 rollback 불가)
- state-management-strategy-2026-05-15.md §Phase 1 line 752 (Phase 1 의 quarantine
  로직 위치)
- state-management-strategy-2026-05-15.md §Phase 1 AC line 1618 (corrupt SQLite 시뮬
  레이션 → `.bak` rename + fresh start, 사용자 toast 없음)
- ADR 0032 — SQLite infrastructure (corrupt detection 의 SQLite open
  / migration 실패 경로)
- ADR 0040 — File-key OS keyring (file-key 자체는 SQLite 와 별 — corrupt
  SQLite recovery 후에도 keyring 의 file-key 로 decrypt 가능)
