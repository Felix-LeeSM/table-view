# Sprint 370 — W2 dogfood log (AC-370-02)

## Purpose

7일 동안 daily mismatch counter raw 결과를 기록. 모두 `0` 이면 W3 진입 gate
통과. 한 번이라도 `> 0` 이면 reconcile 가 회복하지 못한 도메인이 있으므로 W3
진입 보류 (해당 sprint reopen).

## How to read

매일 아침/저녁 (사용자 dogfood session 시작 / 종료 시) `mismatch_metric::counter()`
값을 (Cmd+Shift+I dev console 또는 `cargo run -- --print-mismatch-metric` —
sprint-370 이 metric IPC dump 를 추가) 확인한다. 결과를 아래 표에 기록.

| Day | Date       | Mismatch count | Reconcile retries | Notes |
| --- | ---------- | -------------- | ----------------- | ----- |
| 1   | YYYY-MM-DD | 0              | 0                 |       |
| 2   | YYYY-MM-DD | 0              | 0                 |       |
| 3   | YYYY-MM-DD | 0              | 0                 |       |
| 4   | YYYY-MM-DD | 0              | 0                 |       |
| 5   | YYYY-MM-DD | 0              | 0                 |       |
| 6   | YYYY-MM-DD | 0              | 0                 |       |
| 7   | YYYY-MM-DD | 0              | 0                 |       |

## Status

- `[ ]` 7일 모두 0 — W3 진입 OK.
- `[ ]` `> 0` 발생 — reconcile 회복 안 됨. sprint-370 reopen + 도메인 별 root cause.

## Sprint-370 W3 cut-over decision

본 sprint 의 머지 시점에는 file/LS read 사이트는 retire 되었지만 W3 진입의
공식 gate 는 위 7일 log 가 모두 0 으로 채워지는 시점이다. 진입 전까지는 dogfood
중 회귀가 감지되면 mismatch 가 누적된다.

DEFERRED — 시간 기반. 본 placeholder 는 사용자가 7일 dogfood 종료 후 채우는
파일이다.
