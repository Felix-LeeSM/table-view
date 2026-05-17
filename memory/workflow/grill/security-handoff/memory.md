---
title: 보안 grill — threat-model 핸드오프 먼저
type: workflow-rule
updated: 2026-05-17
task: security, threat-model, grill
trigger:
  signal: 보안 영향 키워드 (password, 암호화, KDF, ACL, 서명, 공유) 등장
  layer: agent-prompt (grill-planner / security-handoff agent)
---

# 보안 grill — threat-model 핸드오프 먼저

보안 영향 있는 결정은 options grill ("a/b/c 중 추천 b") 로 바로 들어가지 말고, 먼저 다음 6 섹션을 정리한 핸드오프 문서를 만들어 사용자에게 제시.

## 6 섹션

1. **자산 (assets)** — 보호 대상 (예: DB password 평문, master password, mnemonic).
2. **위협 (threats)** — 외부 공격, 내부 실수, 사이드채널, supply-chain.
3. **현재 인프라 정밀 분석** — 이미 구현된 encryption 경로, KDF 파라미터, 키 저장 위치 + 권한.
4. **사용자 실수 시나리오** — 평문 파일 git commit, Slack 첨부, Dropbox sync, Spotlight 인덱싱 등.
5. **완화 (mitigations)** — 각 옵션이 어떤 위협에 어떻게 대응하는가.
6. **잔여 위험 (residual risks)** — 어떤 위협이 남는가, 사용자가 받아들여야 할 trade-off.

## Why

사용자가 본인 보안 지식 부족 명시 (2026-05-10 "보안에 대해서 잘 몰라서 훨씬 더 엄격한 현상 파악과 계획이 필요할 것 같아"). 일반 UX 결정 grill 패턴으로 보안을 다루면 사용자가 trade-off 무게를 정확히 평가 못 한 채 lock. 깊이 있는 사전 분석이 사용자 informed consent 의 전제 조건.

## 트리거 키워드

다음 신호 등장하면 grill-style 결정 진행 보류하고 먼저 threat-model 핸드오프 제안:
- password / credential 저장, 전송, export, import
- 암호화 알고리즘 선택, KDF 파라미터 (Argon2id m/t/p), nonce / IV 관리, key derivation
- 파일 형식 + 외부 공유 (.tableviewconnection, mnemonic 출력 형식 등)
- 권한 / ACL / 코드 서명 / supply-chain
- 다중 사용자 / 공유 storage

핸드오프 doc 의 Deferred 섹션에 "보안 사전 분석 필요" 라벨 붙은 항목은 자동으로 본 룰 대상.

## 산출물 위치

- `docs/threat-models/<topic>-<date>.md` — 6 섹션 본문.
- 사용자 informed consent (lock) 후에야 옵션 grill 진입.

## 관련

- [grill](../memory.md) — 일반 grill 룰
- `security-handoff` agent (`.claude/agents/security-handoff.md`) — 본 룰 enforce
- [decisions](../../../decisions/memory.md) — 보안 ADR (0005, 0021, 0036, 0040 등)
