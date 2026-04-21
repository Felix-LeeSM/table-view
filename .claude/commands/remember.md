---
description: 대화에서 배운 것·결정을 메모리 팔레스의 적절한 위치에 기록
---

# /remember

인자(`$ARGUMENTS`) + 최근 대화 맥락을 분석해, 아래 분류 중 **가장 적합한 한 곳**에 저장한다.

## 분류

| 신호 | 저장 위치 | 템플릿 |
|---|---|---|
| 실패·성공·원인·재발 방지 | `memory/lessons/YYYY-MM-DD-<slug>/memory.md` | lesson |
| 트레이드오프 있는 선택 | `memory/decisions/NNNN-<slug>/memory.md` | ADR |
| 시스템 구조·흐름 변화 | `memory/<주제>/memory.md` 업데이트 | topic |

## 템플릿 (엄수 — 3줄 inline)

**ADR**:
```
---
id: NNNN
title: 한 줄 제목
status: Accepted
date: YYYY-MM-DD
---

**결정**: 한 문장.
**이유**: 한두 문장.
**트레이드오프**: + 장점 / - 단점 (한 줄씩).
```

**Lesson**:
```
---
title: 한 줄 제목
type: lesson
date: YYYY-MM-DD
---

**상황**: 한 문장.
**원인**: 한 문장.
**재발 방지**: 한 문장.
```

## 동작

1. 분류 결정 → 경로 계산:
   - `NNNN`: `memory/decisions/` 디렉토리 중 최대 번호 + 1 (4자리 zero-pad).
   - `<slug>`: **주제 접두사 + 결정 꼬리** kebab-case (예: `global-state-zustand`).
   - 날짜: 현재 시스템 날짜.
2. 디렉토리 + `memory.md` 생성, 템플릿 채움.
3. ADR이면 `memory/decisions/memory.md` 인덱스 테이블에 한 행 추가.
4. 사용자에게 한 줄 요약 보고.

## 제약

- 200줄 초과 예상 시 즉시 분할 금지. 경고만 출력 + `/split-memory` 안내.
- `memory/` 트리는 `memory.md`만 허용. 다른 이름 금지.
- 본문은 3줄 형식 엄수. 장황하게 쓰지 말 것.
- 기존 ADR/`CLAUDE.md`는 수정 금지 (ADR은 append-only).
