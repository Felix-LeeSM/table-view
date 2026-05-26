# Agent Workflow Memory Reconstruction — 2026-05-26

Status: raw reconstruction from conversation. This file is not active SOT.
Active rules must be reflected in `AGENTS.md`, `memory/**/memory.md`,
`.agents/skills/**`, hooks, or PR workflow docs.

## Recalled Decisions

1. Final authority is human PR merge.
   Agents may build, evaluate, improve, push a branch, and prepare a PR. They do
   not certify, approve, or merge without explicit user review and merge approval.

2. Work should be small PR slices.
   Some uncertainty is acceptable if the PR stays small enough for human review.
   If a task is predefined, follow it. If not, define one or more task slices
   through an interactive loop before implementation.

3. Destructive actions need hard blocking.
   Prompt policy is secondary. Hooks/blocking scripts should prevent direct
   `main` commit/push, hook bypass, force push without approval, reset/pull
   recovery traps, and other destructive commands.

4. All SOT must live in this repo.
   Chat, external memory, GitHub comments, and tool state are not SOT until
   captured in tracked repo files.

5. Human-facing progress SOT is ROADMAP/PLAN.
   Agents should keep implementation PRs small and report whether roadmap/plan
   SOT needed updates. Completed or inactive planning moves to archive.

6. `memory/` is active operational SOT only.
   Raw history, raw audits, raw lessons, old plans, and inactive context live in
   `docs/archives/`. Memory should contain rules an agent will actually reread
   and apply.

7. Raw lessons are not active memory.
   Keep raw lesson narratives in archive. Interpret reusable knowledge into the
   relevant active room: `workflow`, `conventions`, `runbook`, `ux`, or
   `architecture`.

8. Decisions/ADRs were discussed as archive material.
   Recalled direction: keep decision history out of default active memory unless
   an active rule needs to link it. Current PR still has `memory/decisions/`;
   migration is unresolved.

9. Skills should be agent-agnostic.
   Skill bodies belong under `.agents/skills/`. Brain-specific files such as
   `.claude/commands/` should be thin wrappers. `memory/skills` was a drift from
   the agreed structure.

10. Skills should stay thin.
    Policy and durable workflow rules belong in memory/workflow/conventions.
    Skill files should point to the right SOT and define invocation shape, not
    duplicate long policy.

11. Indexable instructions are required but not sufficient.
    Instructions should be reachable by task/surface indexes where applicable.
    Broken generated indexes need static checks. Index quality does not by
    itself solve memory bloat; repeated material must be merged, split, or
    archived.

12. Agent read evidence matters.
    The system should leave evidence that the right SOT was read and applied.
    The evidence should be compact and side-channel, not dumped into agent
    context.

13. Harness direction is a skill-level workflow, not an autonomous authority.
    Harness coordinates agent work toward a reviewable PR. The final gate is
    human review and merge.

14. Harness should use a small worker topology.
    Recalled shape: `Planner-Contract`, `Builder-Delivery`, and `Reviewer`.
    `Research Scout` is conditional escalation, not default spawn.

15. `run.md` is orchestrator-owned evidence.
    It should be compact evidence for phase/pass/AC state, not a verbose context
    dump. Orchestrator writes it from task packet, SOT read set, commands/checks,
    AC evidence, and review findings.

16. Terminology is repo-wide foundation.
    It should not be scoped only to workflow. Do not define generic words just
    because they exist; define terms whose ambiguity changes routing, authority,
    UI copy, tests, or agent behavior.

17. User review terms must be locked.
    `Reviewer`, `Evaluator`, `approval`, `user review`, `user-review-ready`,
    `pass`, `evidence`, and `AC` must not be used loosely because authority
    boundaries depend on them.

18. Memory top-level taxonomy should be reclassified.
    Recalled target: active operational categories only, roughly
    `architecture`, `conventions`, `index`, `roadmap`, `runbook`,
    `terminology`, `ux`, and `workflow`; archive holds decisions/history/raw
    lessons/raw audits.

## Current PR Gaps Remembered

- `memory/skills` existed after the first PR version. This follow-up moves
  `/remember` and `/split-memory` bodies to `.agents/skills/`.
- Broader `.claude/skills` / `.codex/skills` duplication remains unresolved.
  Some are repo-owned skills, but the long-term direction is still
  agent-agnostic source plus thin runtime wrappers.
- `memory/decisions` remains active. If the recalled decision is still accepted,
  migrate ADR history to archive and update active SOT links.
- `/remember` still writes ADRs to `memory/decisions`. This depends on the ADR
  archive migration decision.
- The current PR has no separate pr-reviewer subagent scorecard. Local gates and
  GitHub checks passed, but the delivery workflow says qualitative review should
  exist before `user-review-ready`.

## Immediate Correction

Move skill body SOT from `memory/skills` to `.agents/skills`, keep
`.claude/commands/*` as wrappers, and update `AGENTS.md` / `memory/memory.md` so
future agents do not rediscover the wrong location.
