---
id: "0020"
title: ADR 0019 후속 — pre-push e2e는 host docker로 한정 (tauri-driver macOS 미지원)
status: Accepted
date: 2026-05-01
supersedes: null
superseded_by: null
---

**결정**: ADR 0019의 "host-native pre-push" 의도(macOS WKWebView / Windows WebView2 직접 검증)는 `tauri-driver`가 Linux 전용(`WebKitWebDriver` on `webkit2gtk`)이라는 platform 제약 때문에 실현 불가. lefthook pre-push의 `5_e2e` 단계는 `pnpm test:e2e:docker`(= `docker compose --profile test up --abort-on-container-exit --exit-code-from e2e`)를 호출해 사용자 머신의 docker daemon 안에서 ubuntu + xvfb + webkit2gtk-driver 스택을 띄운다. 보조 스크립트 `scripts/e2e-host.sh`는 폐기. ADR 0019의 "CI에서 e2e 제거" 결정은 그대로 유효 — 변경된 것은 게이트의 실행 환경(CI runner → 사용자 머신 docker)만이며 검증 스택은 동일하다.

**이유**: ADR 0019 머지 직전 첫 pre-push 시도(commit 6e7366c)에서 `[wdio] Starting tauri-driver at /Users/felix/.cargo/bin/tauri-driver` 직후 `tauri-driver is not supported on this platform` exit code 1이 13개 spec 모두에 발생하며 75초 안에 fail 확인. 원인: `tauri-driver`는 `webkit2gtk`의 `WebKitWebDriver` (또는 Windows의 `Microsoft Edge WebDriver`)를 dispatch하는 thin layer로, macOS WKWebView에는 webdriver 인터페이스가 노출되지 않는다 — Apple은 표준 WebDriver를 Safari에만 제공(`safaridriver`)하고 임베디드 WKWebView는 미포함. 따라서 host-native macOS 실행은 platform 차원에서 불가능. CI에서 ubuntu-latest를 떼낸 ADR 0019의 핵심 가치(noisy-neighbor 제거, CI minutes 절감, push 게이트 의무화)는 사용자 머신 docker로 옮겨도 유지된다 — 사용자 머신은 CI shared runner보다 자원 안정성·timing 결정성이 높고, 같은 docker 이미지·시드를 쓰므로 ADR 0015의 "drift = 빌드 에러" 정신에도 부합한다.

**트레이드오프**: 
- (+) ADR 0019의 "noisy-neighbor 제거 + CI minutes 절감 + push 게이트" 가치는 그대로 보존.
- (+) 사용자 머신 docker는 CI shared runner보다 timing 일관성이 높아 mocha/helper timeout 부풀림(120s/30s)을 더 안정적으로 흡수.
- (+) 기존 docker compose 파이프라인(`Dockerfile.e2e`, `e2e/run-e2e-docker.sh`, seed.sql) 전체 재사용 — ADR 0015가 폐기된 게 아니라 "CI 진입점 → pre-push 진입점"으로 호출 위치만 이동했음을 명확히.
- (-) push 1회당 docker 안 ubuntu + xvfb + cargo build + wdio = cold ~10분 / warm ~5분. 사용자 push 빈도가 잦으면 friction.
- (-) macOS 사용자가 실제 사용자 환경(WKWebView)에서 직접 검증하지는 못함 — 단 vitest + Tauri IPC seam test로 보완(이게 e2e의 역할이 아닌 unit/integration의 영역이라는 테스트 피라미드 원칙과 일치).
- (-) Windows 협업자가 들어오면 docker 동작 확인 필요(WSL2 + Docker Desktop). 현재 1인 macOS 환경이므로 무위험.
- (-) `scripts/e2e-host.sh`를 작성·검증한 사이클(commit 092645f→6103d45→6e7366c)이 무효가 되어 정리 필요. 같은 PR에서 폐기.

**관련**: 
- ADR 0019 — 본 ADR의 모ADR. 본문 동결 유지(작성 순간 동결 룰). 0019의 트레이드오프 중 "macOS WKWebView host-native" 항목은 본 ADR로 정정됨을 인덱스에서 명시.
- ADR 0015 — Superseded 상태 그대로. docker 파이프라인 자체는 본 ADR이 다시 활성 진입점으로 사용. 즉 docker 파이프라인은 "CI 진입점"으로서는 폐기, "pre-push 진입점"으로서는 정식 채택.
- 보조 자료: `lefthook.yml` `5_e2e: pnpm test:e2e:docker`, `package.json` `test:e2e:docker` 스크립트, `Dockerfile.e2e`, `docker-compose.yml` (e2e 서비스 + postgres/mongo + healthcheck).
