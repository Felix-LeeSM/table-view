---
title: Explorations Archive Note
type: archive-note
updated: 2026-06-12
---

# Explorations Archive

`docs/explorations/` 의 HTML 파일들은 과거 결정을 시각화하거나 비교하던
historical artifacts 다. 현재 source of truth 가 아니다.

새 exploration 이 필요하면 sprint contract 또는 active docs 에 먼저 목적과
후속 반영 경로를 적고, 완료 뒤 archive 로 라우팅한다.

## 2026-06-12 Audit

현재 제품 상태는 [`docs/product/README.md`](../product/README.md) 와
[`docs/product/known-limitations.md`](../product/known-limitations.md) 가 소유한다.
미래 작업과 승격 후보는 [`docs/ROADMAP.md`](../ROADMAP.md) 가 소유한다.
Workflow/agent 규칙은 [`AGENTS.md`](../../AGENTS.md) 와 `memory/workflow/**`
가 소유한다.

| Artifact | Historical purpose | Current SOT by intent |
|---|---|---|
| `how-browser-theme-works-2026-05-15.html` | Theme cascade/fallback 설명용 demo | [`docs/archives/decisions/0031-syntax-palette-manual-and-token-integrity/memory.md`](../archives/decisions/0031-syntax-palette-manual-and-token-integrity/memory.md), [`docs/archives/decisions/0038-theme-safemode-sqlite-sot-ls-fouc-cache/memory.md`](../archives/decisions/0038-theme-safemode-sqlite-sot-ls-fouc-cache/memory.md), `src/themes.css`, `src/index.css`, `src/lib/themeBoot.ts` |
| `v20-syntax-palette-decision-2026-05-15.html` | Syntax palette options comparison before decision lock | [`docs/archives/decisions/0031-syntax-palette-manual-and-token-integrity/memory.md`](../archives/decisions/0031-syntax-palette-manual-and-token-integrity/memory.md) |
| `mongo-autocomplete-ux-2026-05-15.html` | Mongo/SQL autocomplete UI option sketch | [`docs/product/query-language-support.md`](../product/query-language-support.md), [`docs/ROADMAP.md`](../ROADMAP.md), `src/features/completion/mongo/**`, `src/features/completion/sql/**` |
| `multi-agent-infra-2026-05-18.html` | Agent-memory topology exploration before repo-local entrypoints settled | [`AGENTS.md`](../../AGENTS.md), [`memory/workflow/memory.md`](../../memory/workflow/memory.md), `.codex/agents/**`, `.claude/agents/**` |
| `agent-workflow-hardening-2026-05-19.html` | Draft of documentation/review/delivery gates | [`memory/workflow/documentation/memory.md`](../../memory/workflow/documentation/memory.md), [`memory/workflow/delivery/memory.md`](../../memory/workflow/delivery/memory.md), [`memory/workflow/review/memory.md`](../../memory/workflow/review/memory.md), [`memory/workflow/git-policy/memory.md`](../../memory/workflow/git-policy/memory.md) |
