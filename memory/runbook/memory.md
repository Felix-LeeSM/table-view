---
title: Runbook
type: index
updated: 2026-05-27
---

# Runbook

"이 상황에서 이 명령 시퀀스 실행" — 절차 모음. 코드만 봐서는 재구성 불가능한 절차만 둔다. 코드 안에 이미 있는 것은 grep 으로 찾고, 본 방에 박지 마.

## 방 지도

- [cold-boot](./cold-boot/memory.md) — Tauri cold-boot 5-trial drop-slowest 측정 protocol
- [worktree](./worktree/memory.md) — 다중 agent / brain 병렬 작업용 git worktree 사용 룰

## 진입 규칙

- 본 방에 둘 것: 명령 시퀀스 + 환경 prereq + aggregation 의미론
- 본 방에 두지 말 것: 코드 marker 위치 (drift 위험 — grep 으로 찾을 것), 단발 결과 데이터 (sprint doc 가 source)

## 관련

- [engineering/conventions](../engineering/conventions/memory.md) — 빌드 / 테스트 / 린트 명령 (단발 실행)
- [docs/archives/incidents](../../docs/archives/incidents/memory.md) — historical incident archive
