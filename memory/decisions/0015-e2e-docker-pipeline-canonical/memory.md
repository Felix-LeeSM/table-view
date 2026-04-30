---
id: "0015"
title: E2E 실행을 docker compose 파이프라인으로 표준화
status: Superseded
date: 2026-04-29
supersedes: null
superseded_by: "0019"
---

# ADR 0015 — E2E 실행을 docker compose 파이프라인으로 표준화

## 결정

- E2E 테스트(`e2e/**/*.spec.ts`)는 `pnpm test:e2e:docker`(= `docker compose --profile test up --build --abort-on-container-exit --exit-code-from e2e`)를 단일 진입점으로 한다.
- 이미지 빌드(Dockerfile.e2e), 시드(`e2e/fixtures/seed.sql`), 실행(`e2e/run-e2e-docker.sh`)을 로컬과 CI가 모두 공유한다 — 별도의 inline apt/cargo/xvfb 시퀀스는 폐지.

## 이유

- CI(`.github/workflows/ci.yml`)와 로컬 스크립트가 각자 webkit2gtk-driver/xvfb/Rust/Node을 설치하고 시드 SQL을 중복 정의해 drift가 발생했다 — 동일 이미지·동일 시드로 강제하면 drift는 빌드 에러로 노출된다.
- 호스트는 `docker`와 `git`만 있으면 되며, webkit2gtk/xvfb/Rust/Node 의존성 설치 책임이 컨테이너로 이동해 신규 기여자 onboarding이 단순해진다.

## 트레이드오프

- (+) 시드 SQL 단일 소스(`e2e/fixtures/seed.sql`), 툴체인 버전 단일 소스(`Dockerfile.e2e`), CI/로컬 정확히 동일 실행 경로로 회귀 위험 감소.
- (+) Tauri 빌드는 `tauri-target` named volume에 캐시되어 두 번째 이후 실행은 incremental rebuild만 발생.
- (-) macOS(Apple Silicon)는 webkit2gtk Linux 전용 의존성 때문에 컨테이너 native 실행 불가 — Linux VM 또는 CI에 위임해야 한다.
- (-) `tauri-target`은 named volume이라 `docker compose down -v` 시 캐시가 손실되며, BuildKit cache mount보다 compose-native 단순성을 선택한 결과다.
