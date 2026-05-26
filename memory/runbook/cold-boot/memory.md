---
title: Cold-boot 5-trial drop-slowest protocol
type: runbook
updated: 2026-05-17
task: cold-boot-measurement, performance, baseline
surface: src-tauri/src/lib.rs, src-tauri/src/commands/connection.rs, src/lib/perf/bootInstrumentation.ts
trigger:
  signal: 사용자가 cold-boot 측정 / rebaseline 요청
  layer: index (능동 검색)
---

# Cold-boot 5-trial drop-slowest protocol

Tauri Table View 부팅 측정 절차. Marker 위치는 코드 grep (`tracing::info!`, `record_phase`, `BOOT_T0`) 으로 찾기 — drift 위험 회피.

## Prereq

- macOS (WKWebView).
- release 빌드 필요 (`pnpm tauri build` 5-10분, sandbox 금지).
- `sudo purge` 권한 (page cache drop) — `sudo` 미가능 환경에서는 step 생략, "purge skipped" 표시.

## 명령

```bash
cd /Users/felix/Desktop/study/view-table
pnpm tauri build
BIN="src-tauri/target/release/table-view"
mkdir -p .startup-trials

for i in 1 2 3 4 5; do
  pkill -f "table-view" 2>/dev/null
  pkill -f "Table View" 2>/dev/null
  sudo purge 2>/dev/null || echo "purge skipped"
  echo "=== trial $i ==="
  "$BIN" 2>&1 | tee ".startup-trials/<label>-trial-$i.log" &
  APP_PID=$!
  sleep 8
  kill $APP_PID 2>/dev/null
  wait $APP_PID 2>/dev/null
done

# 추출
for i in 1 2 3 4 5; do
  echo "=== trial $i ==="
  grep -E "rust:entry|rust:first-ipc|rust:setup-done|rust:page-load|phase=" \
    ".startup-trials/<label>-trial-$i.log"
done
```

## Aggregation

- 기준 marker: `rust:first-ipc` (첫 IPC 호출).
- Slowest 1 trial drop.
- 나머지 4 trial: median + p95 (=max) 계산.
- Sprint 간 비교 시 **같은 protocol** 만 비교 — drop 갯수 / sleep duration 변경 금지.

## Baseline 참조

- `docs/sprints/sprint-175/baseline.md` — Pre-sprint-2 / post-sprint-2 baseline 4 시나리오 표.

## Interpretation rules

- Tauri 2 macOS 의 다중 WKWebView spawn 은 OS-level parallel 일 수 있다.
  launcher/workspace `page-load:Started` marker 가 거의 동시에 찍히면 "윈도우 수
  = 직렬 비용" 가정을 버린다.
- `setup-done` 같은 단일 marker 만 보고 Rust/application 변경을 가정하지 않는다.
  WebKit helper process spawn floor 일 수 있으므로 같은 protocol 의 trial delta 로만
  판단한다.

## Marker 위치 (코드 grep 으로)

- Rust: `src-tauri/src/lib.rs::run()` 의 `BOOT_T0` + `record_phase` + setup `rust:setup-done` + `on_page_load`
- Rust: `src-tauri/src/commands/connection.rs::get_session_id` 의 `rust:first-ipc`
- JS: `src/lib/perf/bootInstrumentation.ts` 의 8 milestone

위치 변동 가능성 있음 — `grep -r "rust:first-ipc\|BOOT_T0\|record_phase" src-tauri/src src/lib` 로 현재 위치 확인 후 측정.

## 관련

- [decisions](../../decisions/memory.md) — ADR 0017 (lazy workspace window)
