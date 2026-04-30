---
title: Cold-boot 측정은 tracing::info! phase markers + Tauri 2 setup/on_page_load hooks가 가장 가벼운 instrumentation
type: lesson
date: 2026-04-30
---

**상황**: Sprint 175에서 데스크톱 앱(Tauri 2)의 cold boot 1.5초 어디에 시간이 들어가는지 모르면 application-layer optimization 타깃을 못 짚는다. `cargo flamegraph`는 macOS에서 sudo 필요, `Instruments.app`은 GUI 캡처라 5-trial 자동화가 어렵다.
**원인**: cold-boot 디테일 없이는 "1.5초 → 1.0초" 같은 % 목표를 profile-back할 수 없고, 잘못된 가설(예: `AppState::new()` 또는 plugin init이 dominant) 위에서 application-layer를 건드려 시간 낭비.
**재발 방지**: `tracing::info!(target: "boot", ...)` + `record_phase(cursor: &mut Instant, name)` 헬퍼로 builder 단계별 delta 캡처(`src-tauri/src/lib.rs`). Tauri 2 추가 hook 두 개로 `.run()` 잔여 영역을 더 쪼개기: `Builder::setup(|app|)` callback이 `rust:setup-done`(event-loop alive 시점) 발화, `Builder::on_page_load(|webview, payload|)`가 per-window `Started`/`Finished` 발화. 모든 marker는 release 빌드에 영구(Sprint 1 precedent) — 향후 sprint가 동일 grep token으로 rebaseline 가능. 측정 protocol: 5-trial drop-slowest, raw release binary stdout `tee` + `grep -E "rust:entry|rust:first-ipc|rust:setup-done|rust:page-load|phase="`. JS-side `[boot]` 라인은 release WKWebView가 parent stdout으로 안 piping하므로 별도 캡처 필요(debug 빌드 또는 IPC sink).
