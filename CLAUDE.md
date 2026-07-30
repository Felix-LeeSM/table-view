# Claude Code Entry

`AGENTS.md` 가 universal source다. Claude Code 는 이 파일을 먼저 보고,
규칙 본문은 `AGENTS.md` 와 해당 memory/docs SOT 로 내려간다.

## 프로젝트 한줄

Tauri 2.0 + React + Rust TablePlus-like 로컬 DB 도구. 다중 DBMS.

## 작업 전 read

@AGENTS.md

위 한 줄은 링크가 아니라 import — `AGENTS.md` 본문(작업 type -> memory path
매트릭스 + 강제 룰)이 이 컨텍스트에 그대로 실린다. 링크였을 때는 spawn 된
subagent 에 배달되지 않았다 (#1865 측정). 지우면 배달이 끊긴다 — **이것이
subagent 에 닿는 유일한 채널이다.**

- [`memory/index/by-surface.md`](memory/index/by-surface.md) — 코드/문서 수정 전
  해당 surface active rule 묶음. 링크이므로 직접 열어야 한다.
- [`docs/PLAN.md`](docs/PLAN.md) — product/roadmap/contributor SOT 인덱스.
- git/hook 회피 금지는 `memory/workflow/git-policy/memory.md` 가 SOT. 위 링크를
  스스로 열지 않으면 아무것도 오지 않고, 어겨도 막히지 않는다.

## 강제 룰

- 별도 Claude 전용 정책을 여기서 만들지 않는다. 충돌 시
  [`AGENTS.md`](AGENTS.md) 가 우선.
- memory cap / ADR 동결 / git·hook 회피 금지는 위 import 로 실린
  `AGENTS.md` 「강제 룰」이 SOT. 여기 복제하면 drift 한다.
