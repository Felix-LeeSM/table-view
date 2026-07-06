---
id: 0037
title: Auto-update — notification only, no in-app download/install
status: Superseded
date: 2026-05-17
supersedes: null
superseded_by: 0049
---

**결정**: Auto-update 는 **notification-only** 정책. 앱이 GitHub releases
API 를 1회 GET 으로 폴링해 새 버전 존재 시 toast 표시. 다운로드 /
설치는 사용자가 외부 브라우저로 GitHub release page 에서 수동 진행.
앱 내 자동 다운로드 / 자동 설치 / signing infra 도입하지 않음.

1. **Check 주기** — 앱 boot 시 1회 + 24h interval (background). 사용자
   가 settings 에서 disable 가능.
2. **Endpoint** — `https://api.github.com/repos/{owner}/{repo}/releases/latest`.
   GET only, request body 없음, User-Agent generic. 사용자 데이터 송신
   0 (ADR 0036 telemetry zero 와 일관).
3. **Notification 형식** — Toast "v{NEW} available · {THIS} 사용 중 ·
   [Release notes →]". 클릭하면 OS 기본 브라우저로 release page open.
4. **다운로드 path 미도입** — `tauri-plugin-updater` / 자체 patcher
   서버 / signing infra 안 도입. 사용자가 직접 dmg / msi / AppImage
   다운로드 + 수동 설치.
5. **Disable 옵션** — `settings.auto_update_check` boolean (default
   `true`). False 면 boot/interval GET 호출 안 함.

**이유**:

1. **Signing infra cost vs ROI** — Tauri updater 의 보안 모델은 signed
   manifest (Ed25519) 가 필수. Code-signing cert (Apple Developer ID
   + Windows EV cert) 의 연간 운영 비용 + revocation 절차 + private key
   관리는 1인 개발자 / 작은 팀에 부담. Notification-only 는 GitHub
   release 의 signing (이미 검증된 OS 측 code-sign) 에 위임.
2. **사용자 컨트롤** — 자동 다운로드 / 설치는 사용자가 "지금 update
   할 시간 없는데" 인 상황을 막음. Notification 은 사용자에게 정보만
   제공하고 결정권 위임. 데이터베이스 도구는 사용자가 작업 중 update
   강요받으면 손해 큼 (transaction 진행 중 등).
3. **External browser 가 신뢰 anchor** — GitHub release page 의 sig
   verification / download 는 OS / browser 의 표준 path 사용 (사용자가
   이미 신뢰). 앱 내 in-app download 는 별도 신뢰 anchor 가 필요 (앱
   updater 의 sig verify chain).
4. **Telemetry zero (ADR 0036) 와 일관** — GitHub releases GET 은
   request body 없음 + User-Agent generic. 사용자 데이터 전송 0. IP
   주소가 GitHub log 에 남는 건 모든 OSS download 의 기본값 — 본 앱
   의 추가 노출 없음.
5. **Disable 옵션 = 사용자 자율성** — Enterprise / firewall 환경에서
   GitHub API 차단되거나 사용자가 update 알림 자체를 원치 않으면 toggle.

**트레이드오프**:

- **+** Signing infra 비용 0 — Apple Developer ID / Windows EV cert
  / Tauri updater manifest signing pipeline 전부 미도입.
- **+** 사용자 자율성 — 자동 download/install 강요 안 함. 작업 중
  방해 0.
- **+** Telemetry zero (ADR 0036) 와 자연 일관 — outbound 1개 (GitHub
  GET) 에 데이터 전송 0.
- **+** GitHub releases 의 검증된 distribution (signing / mirror /
  bandwidth) 위임.
- **−** 사용자 update friction 증가 — toast 클릭 → 브라우저 → 다운로드
  → 설치 (4 step) vs 자동 update (1 step). 단 update 빈도 (분기마다 1회
  정도) 가 낮아 누적 비용 적음.
- **−** 일부 사용자 update 누락 가능 — toast 무시 + Disable 안 한 상태
  로 오래된 버전 사용. Security patch 가 critical 일 때 위험. 별도
  in-app "force update" path 가 없음. 완화: critical CVE 시 release
  notes 의 "Required update" 라벨 + toast 강조 (out of scope).
- **−** GitHub API rate limit (60/h unauth) — 24h interval × 1 user =
  안전. 단 사용자 IP 공유 (NAT, corp proxy) 에서 다수 사용자가 같은
  IP 면 throttle 위험. 완화: backoff + 사용자에게 silent fail (toast
  없음).
- **−** Manual download path 의 distribution channel (dmg / msi /
  AppImage) 빌드 maintain 필요 — 본 ADR 의 범위가 아니지만 implication.

**관련**:

- state-management-strategy-2026-05-15.md §Q11 line 422 (auto-update notification only)
- ADR 0036 — Telemetry zero collection (auto-update GET 이 유일한 outbound
  — 데이터 전송 0)
- ADR 0023 — Production warning (production build 의 environment-aware
  chrome — update notification 도 production build 에서만 활성)
