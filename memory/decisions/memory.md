---
title: ADR 인덱스
type: index
updated: 2026-04-22
---

# ADR 인덱스

## 활성 결정

| ID | 제목 | 상태 | 날짜 | Supersedes |
|----|------|------|------|-----------|
| [0001](./0001-desktop-stack-tauri-sqlx/memory.md) | 데스크톱 스택: Tauri v2 + sqlx | Accepted | 2026-01-01 | — |
| [0002](./0002-global-state-zustand/memory.md) | 전역 상태: Zustand 채택 | Accepted | 2026-01-01 | — |
| [0003](./0003-multi-connection-focused-id/memory.md) | 다중 connection: focusedConnId store 승격 | Accepted | 2026-04-20 | — |

## 역사 (Superseded / Deprecated)

_아직 없음._

형식:

| ID | 제목 | 상태 | 날짜 | Superseded by |
|----|------|------|------|--------------|
| `0042` | 예시: 이전 결정 | Superseded | YYYY-MM-DD | [NNNN](./NNNN-slug/memory.md) |

## 작성 규칙

- 한 ADR = 한 디렉토리 = 한 memory.md
- 번호는 4자리, 순차 증가.
- 슬러그는 **주제-접두사 + 결정-꼬리** (예: `global-state-zustand`). 주제가 같은 나중 ADR이 접두사를 공유해 훑기 쉬움.
- 본문(결정/이유/트레이드오프)은 작성 순간 **동결 — 절대 수정 금지**. 그 시점의 판단을 보존해야 함.
- 프론트매터 **메타 필드만 갱신 가능**: `status`, `superseded_by`. 본문은 건드리지 않음.
- 상태 값: `Accepted` | `Deprecated` | `Superseded`.
- 결정이 뒤집히면:
  1. 새 ADR 작성 + 프론트매터 `supersedes: NNNN`.
  2. 원본 ADR 프론트매터의 `status`를 `Superseded`로, `superseded_by: NNNN` 추가.
  3. 인덱스에서 원본을 "활성 결정"에서 "역사" 섹션으로 이동.

## 정리 가이드

삭제하지 않고 **구조화**로 정리한다:
- 인덱스가 200줄 초과하면 `/split-memory`로 주제별 하위 디렉토리 분할 (예: `decisions/state/`, `decisions/stack/`).
- 주제 접두사로 관련 ADR 훑기: `ls memory/decisions | grep global-state`.

## 관련 방

- [architecture](../architecture/memory.md)
- [roadmap](../roadmap/memory.md)
