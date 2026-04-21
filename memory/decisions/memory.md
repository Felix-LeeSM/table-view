---
title: ADR 인덱스
type: index
updated: 2026-04-22
---

# ADR 인덱스

| ID | 제목 | 상태 | 날짜 | Supersedes |
|----|------|------|------|-----------|
| [0001](./0001-desktop-stack-tauri-sqlx/memory.md) | 데스크톱 스택: Tauri v2 + sqlx | Accepted | 2026-01-01 | — |
| [0002](./0002-global-state-zustand/memory.md) | 전역 상태: Zustand 채택 | Accepted | 2026-01-01 | — |
| [0003](./0003-multi-connection-focused-id/memory.md) | 다중 connection: focusedConnId store 승격 | Accepted | 2026-04-20 | — |

## 작성 규칙

- 한 ADR = 한 디렉토리 = 한 memory.md
- 번호는 4자리, 순차 증가.
- 슬러그는 **주제-접두사 + 결정-꼬리** (예: `global-state-zustand`, `multi-connection-focused-id`). 주제가 같은 나중 ADR이 접두사를 공유해 훑기 쉬움.
- 본문은 3줄 inline 형식 엄수 — 결정 / 이유 / 트레이드오프.
- 기존 ADR이 뒤집히면 새 ADR 작성 + 프론트매터 `supersedes: NNNN`. 원본은 수정 금지.

## 관련 방

- [architecture](../architecture/memory.md)
- [roadmap](../roadmap/memory.md)
