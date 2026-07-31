---
id: 0049
title: Auto-update — full in-app tauri-plugin-updater (minisign only, ad-hoc OS signing 유지)
status: Accepted
date: 2026-07-06
supersedes: 0037
superseded_by: null
---

**결정**: Auto-update 를 **notification-only 에서 완전 in-app auto-update 로
전환** (ADR 0037 뒤집음, #1400). 앱이 launcher boot 시 GitHub 의 서명된
`latest.json` updater manifest 를 조회하고, 새 버전이 있으면 프롬프트 후
사용자 승인 시 `tauri-plugin-updater` 로 minisign 검증된 번들을
다운로드/설치하고 `tauri-plugin-process` 로 재시작한다.

1. **Signing** — Tauri updater 의 minisign(Ed25519) manifest 서명만 도입.
   private key + password 는 GitHub Actions secret
   (`TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD`), pubkey 는
   `tauri.conf.json` `plugins.updater.pubkey` 에 커밋. **Apple Developer ID
   / notarization / Windows EV cert 는 여전히 미도입** — macOS 는 ad-hoc
   서명(`signingIdentity: "-"`) 유지. minisign 서명이 in-app 다운로드의
   신뢰 anchor 다.
2. **Check 시점** — launcher 창 로드 시 1회, background, non-blocking.
   `isTauri()` 게이트 + lazy import 로 cold-boot critical path 밖. 실패
   (offline / rate-limit / IPC) 는 전부 삼켜 DEV-only `logger.warn`. 24h
   interval / settings toggle 은 이번 범위 아님 (후속).
3. **Endpoint** — `releases/latest/download/latest.json` (public repo,
   인증 불필요). CSP `connect-src` 에 `https://github.com` +
   `https://objects.githubusercontent.com` (release asset 302 redirect
   host) 추가.
4. **사용자 컨트롤** — 자동 설치 강요 안 함. 프롬프트에서 "나중에" 선택 시
   no-op. 승인해야만 download/install/relaunch.
5. **Artifact** — `bundle.createUpdaterArtifacts: true`. tauri-action 이
   `createUpdaterArtifacts` 감지 시 번들 서명 + `latest.json` 을 draft
   release 에 자동 업로드.

**이유**:

1. **ROI 재평가** — ADR 0037 이 근거로 든 "signing infra cost" 는 주로
   Apple Developer ID + Windows EV cert 의 연간 비용/운영이었다. Tauri
   updater 는 그 OS code-signing cert 없이 **minisign 키페어만으로**
   in-app 서명 검증이 성립한다. minisign 키 운영 비용은 사실상 0 (키페어
   1회 생성 + CI secret 2개). 즉 0037 이 묶어서 기각한 "signing infra" 중
   실제로 비쌌던 OS cert 는 여전히 안 쓰고, 싼 minisign 만 도입하면 완전
   auto-update 가 가능하다.
2. **사용자 friction 제거** — 0037 의 notification-only 는 toast → 브라우저
   → 다운로드 → 수동 설치(4 step). 완전 auto-update 는 프롬프트 승인 1
   step. 0037 이 우려한 "작업 중 강제 update" 는 **프롬프트 승인 게이트**
   로 방어 — 사용자가 거부하면 아무 일도 안 일어난다.
3. **신뢰 anchor 유지** — in-app 다운로드의 신뢰 anchor 를 minisign
   서명 검증이 담당 (0037 이 external browser 에 위임했던 역할). pubkey 는
   앱 바이너리에 박혀 배포되고, private key 는 CI secret 에만 존재.
4. **Telemetry zero (ADR 0036) 유지** — updater GET 은 request body 없음,
   사용자 데이터 전송 0. 0037 의 이 축은 그대로 성립.

**트레이드오프**:

- **+** 사용자 update 1-step. security patch 도달률 상승 (0037 의
  "update 누락" 리스크 완화).
- **+** OS code-signing cert 비용 여전히 0 — minisign 만 도입.
- **+** Telemetry zero 유지.
- **−** minisign private key 관리 책임 신설 — 유출 시 임의 번들을 사용자
  앱이 신뢰. 완화: CI secret 격리, key rotation 시 pubkey 교체 + 재배포.
- **−** macOS ad-hoc 서명 유지 → Gatekeeper 는 여전히 첫 실행 시 우클릭
  Open / quarantine 제거 필요. updater 가 설치하는 번들도 동일 (in-app
  install 은 Gatekeeper re-prompt 가능). minisign 은 무결성만 보증하고
  OS notarization 을 대체하지 않는다.
- **−** `latest.json` 이 draft release 에 있으면 endpoint(`latest`)가 못
  찾음 — 릴리스를 publish 해야 updater 가 발견. release 운영 절차 의존.
- **−** 24h interval / settings disable toggle 미구현 — boot 시 1회만.
  enterprise/firewall 환경 opt-out 은 후속 범위.

**관련**:

- ADR 0037 — Auto-update notification only (본 ADR 이 supersede)
- ADR 0036 — Telemetry zero collection (updater GET 데이터 전송 0 유지)
- ADR 0023 — Production warning (environment-aware chrome)
- `.github/workflows/release.yml` — tauri-action 서명 env + latest.json 업로드
- `src/lib/runtime/autoUpdate.ts` — boot-time check/install/relaunch
