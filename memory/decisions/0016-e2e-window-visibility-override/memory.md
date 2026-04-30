---
id: "0016"
title: e2e 빌드는 workspace 윈도우의 visible 플래그만 overlay로 override
status: Accepted
date: 2026-04-30
supersedes: null
superseded_by: null
---

**결정**: e2e Docker 진입점(`e2e/run-e2e-docker.sh`)이 `pnpm tauri build` 호출 시 `--config src-tauri/tauri.e2e.conf.json` overlay를 함께 전달해 두 윈도우(launcher, workspace)를 모두 `visible: true`로 빌드한다. production 빌드의 `tauri.conf.json`은 그대로 (`workspace.visible: false`) 유지한다.

**이유**: ADR 0012의 multi-window 분리 + sprint-172의 helpers polling 시도로도 e2e 회귀가 풀리지 않았다. CI 로그(PR #5의 `25143770240`)는 13개 spec 중 workspace를 여는 10개 모두가 `switchToWorkspaceWindow: workspace window did not appear within 15000ms`로 실패함을 보여준다. 폴링이 200ms 간격으로 15초간 돌아도 `Table View — Workspace` 핸들이 단 한 번도 안 잡혔다 — race가 아니라 webdriver visibility 자체에서 누락. 근본 원인은 Tauri 2.0 + wry 0.54.4 + libwebkit2gtk-4.1 + Xvfb 조합에서 `visible: false` 윈도우는 런타임 `workspace.show()` IPC 후에도 tauri-driver의 핸들 목록에 등록되지 않는다는 점이다 (Linux 백엔드 한정 회귀로 추정). e2e 빌드만 visibility flag을 override하면 부팅 시점에 두 webview가 모두 마운트되어 핸들이 즉시 노출되며, production 사용자에게 빈 workspace가 잠깐 보이는 UX 회귀(옵션 1)도, 부팅 시 `show().hide()` 마운트 hack(옵션 3)도 회피한다.

**트레이드오프**: + production 첫부팅 UX 무손상 + e2e 빌드는 두 핸들이 즉시 webdriver에 노출되므로 helpers의 polling fallback이 race-only 보호 layer로 좁혀짐 + ADR 0015의 "e2e Docker는 production과 동일한 경로를 검증" 정신을 *동작*은 보존하면서 *visibility flag*만 분리해 약하게만 위반 / - `tauri.conf.json` 변경 시 `tauri.e2e.conf.json`의 windows array를 동시 갱신해야 함 (drift 가능) — 새 윈도우 추가/타이틀 변경 PR 리뷰에서 두 conf 동기화를 명시 체크 - `--config` overlay는 windows array를 deep-merge가 아닌 replace로 처리하므로 e2e overlay에 두 윈도우를 모두 정의해야 함 (launcher 빠뜨리면 부팅 실패).
