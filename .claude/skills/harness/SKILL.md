---
name: harness
description: >
  Multi-agent Planner-Generator-Evaluator harness with sprint-based workflow
  and contract system. Produces high-quality features by separating planning,
  implementation, and evaluation into distinct agents with a feedback loop.
  Usage: /harness <feature-description>
argument-hint: <feature-description>
---

# Multi-Agent Harness: Planner → Generator → Evaluator

You are an **orchestrator** managing three specialized agents to build the feature described by the user. Execute the following workflow precisely.

## Parameters

- `MAX_SPRINTS`: 10 (increase to 15 for complex features)
- `MAX_ATTEMPTS_PER_SPRINT`: 5
- `PASS_THRESHOLD`: 7.0 (each dimension must score ≥ 7/10)

## Workflow

### Phase 1: Planning (Planner 에이전트)

Read the planner prompt from `.claude/skills/harness/prompts/planner.md`.

Spawn a **Plan-type Agent** with:
- **Task**: "You are the Planner (기획자). Read the planner prompt at `.claude/skills/harness/prompts/planner.md` and follow its instructions exactly. Produce a spec for this feature: {{user_argument}}"
- **Context**: The user's feature request, plus read the project roadmap/config and the files directly related to the requested feature area before writing the spec.

Wait for the spec output. Validate it contains:
1. Feature Description
2. Sprint Breakdown (ordered list of sprints)
3. Per-sprint Acceptance Criteria (testable via browser, command, API response, or file inspection)
4. Components to Create/Modify
5. Data Flow
6. Edge Cases

If incomplete, re-run Planning once. Save the spec — it is the **master contract**.

### Phase 2: Sprint N — Contract + Verification Plan (계약)

Before each sprint, establish the **sprint contract** and the **verification plan** between Generator and Evaluator:

Use these canonical templates from the skill directory:
- `.claude/skills/harness/templates/contract.md`
- `.claude/skills/harness/templates/execution-brief.md`

Spawn a **general-purpose Agent** with the contract task:
- **Task**: "Given the master spec and sprint {{N}} scope, produce a **Sprint Contract** and **Verification Plan** — a concrete, testable agreement between the Generator and Evaluator for this sprint. Use `.claude/skills/harness/templates/contract.md` as the output shape."
- **Input**: The sprint scope from the spec (which acceptance criteria belong to this sprint)

The Sprint Contract must contain:
```markdown
## Sprint {{N}} Contract

### Scope
[Which acceptance criteria from the master spec this sprint covers]

### Done Criteria (완료 기준)
Both Generator and Evaluator agree that this sprint is DONE when:
1. [Specific, testable criterion]
2. [Specific, testable criterion]
...

### Out of Scope
[What is explicitly NOT part of this sprint — deferred to later sprints]

### Invariants
[What must not regress or be altered while implementing this sprint]

### Verification Plan
- Profile: `browser` | `command` | `api` | `static` | `mixed`
- Required checks:
  1. [Concrete check]
  2. [Concrete check]
- Required evidence:
  - [What the Generator must return]
  - [What the Evaluator must cite]
```

Select the Verification Plan using this decision order:
1. Use `browser` when the sprint's acceptance criteria are primarily visible through UI behavior in a running app.
2. Use `command` when the sprint is primarily validated by build, test, lint, smoke, or script execution.
3. Use `api` when correctness is primarily visible through endpoint behavior or request/response checks.
4. Use `static` when the sprint is documentation, configuration, schema, or other non-executable change.
5. Use `mixed` when no single profile is sufficient. In that case, list browser and non-browser checks separately.

After the contract is written, the orchestrator must normalize it into a **Sprint Execution Brief** for downstream agents using `.claude/skills/harness/templates/execution-brief.md`:

```markdown
## Sprint Execution Brief

### Objective
[What to build in this sprint]

### Task Why
[Why this sprint matters right now]

### Scope Boundary
[Hard stop lines; what must not change]

### Invariants
[Preserved behaviors/contracts]

### Done Criteria
1. [Testable criterion]
2. [Testable criterion]

### Verification Plan
- Profile:
- Required checks:
- Required evidence:

### Evidence To Return
- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence
- Assumptions, risks, unresolved gaps
```

### Phase 3: Sprint N — Generation (Generator 에이전트)

Read the generator prompt from `.claude/skills/harness/prompts/generator.md`.

Spawn a **general-purpose Agent** with:
- **Task**: "You are the Generator (제작자). Read the generator prompt at `.claude/skills/harness/prompts/generator.md` and follow its instructions exactly."
- **Input**:
  - Sprint Execution Brief
  - Sprint Contract
- **If sprint attempt > 1**: Append "\n\n---\n\n## Evaluator Feedback from previous attempt:\n{{evaluator_feedback}}\n\nAddress EVERY point. Do not regress on previously-passing criteria."

Wait for completion.

After generation, run the Sprint Contract's **Verification Plan** checks before evaluation.

- If the profile is `browser`, ensure the application is reachable before evaluation and record the route(s) to test.
- If the profile is `command`, run the listed commands and capture output.
- If the profile is `api`, execute the listed request/response checks and capture evidence.
- If the profile is `static`, validate the changed files against the contract directly.
- If the profile is `mixed`, run every required check listed in the plan.

If a required pre-evaluation check fails, count it as an attempt but skip evaluator scoring — feed the concrete failure back directly.

### Phase 4: Sprint N — Evaluation (Evaluator 에이전트)

Read the evaluator prompt from `.claude/skills/harness/prompts/evaluator.md`.

Spawn a **general-purpose Agent** with:
- **Task**: "You are the Evaluator (평가자). Read the evaluator prompt at `.claude/skills/harness/prompts/evaluator.md` and follow its instructions exactly."
- **Input**:
  - Sprint Execution Brief
  - Sprint Contract
  - Generator evidence packet
  - List of changed files and their purposes
- **Important**: The evaluator must follow the Verification Plan instead of assuming browser testing. Use Playwright only when the selected verification profile requires browser checks.

Wait for the scorecard output. Parse:
- Individual dimension scores
- Overall score
- Feedback items

### Sprint Loop Decision

```
IF all dimensions ≥ 7/10:
  → Sprint PASS
  → Move to next sprint (Phase 2 for sprint N+1)
  → If all sprints done: present Final Report

ELSE IF attempt < MAX_ATTEMPTS_PER_SPRINT (default 5):
  → Extract "Feedback for Generator" section from evaluator output
  → Go to Phase 3 (re-attempt same sprint with feedback)

ELSE:
  → Sprint FAILED (max attempts reached)
  → Report failure with last scorecard
  → Ask user whether to continue to next sprint or abort
```

### Progression Across Sprints

After a sprint passes, its output becomes the **baseline** for the next sprint:
- The Generator for sprint N+1 works on top of sprint N's completed work
- The Evaluator for sprint N+1 evaluates only the NEW sprint's criteria
- Previously passing criteria must not regress

### Final Report

After all sprints complete (or abort), present:

```
## Harness Result: PASS / FAIL

### Feature: {{feature name}}
### Sprints Completed: {{N}} / {{total}}
### Total Attempts: {{sum of all sprint attempts}}

| Sprint | Scope | Attempts | Final Score | Status |
|--------|-------|----------|-------------|--------|
| 1 | [scope summary] | X | X/10 | PASS/FAIL |
| 2 | [scope summary] | X | X/10 | PASS/FAIL |

### Overall Score: {{average}}/10
```

In addition, persist or summarize these sprint artifacts:
- `contract.md`: agreed sprint scope and verification plan, shaped from `.claude/skills/harness/templates/contract.md`
- `execution-brief.md`: normalized generator-facing task brief, shaped from `.claude/skills/harness/templates/execution-brief.md`
- `findings.md`: evaluator findings and pass checklist, shaped from `.claude/skills/harness/templates/findings.md`
- `handoff.md`: outcome, evidence, changed areas, residual risk, next sprint candidates, shaped from `.claude/skills/harness/templates/handoff.md`

## Important Rules

1. **Never skip phases** — Planning → Contract → Generation → Evaluation, in that order.
2. **Never let the Generator evaluate itself** — The Evaluator is always a separate agent.
3. **Contract before code** — No sprint starts without a signed Sprint Contract. This prevents scope ambiguity.
4. **Sprints are incremental** — Each sprint builds on the previous. Failed sprints are retried; passed sprints are the foundation.
5. **Each attempt is independent** — The Generator receives the contract + feedback, not its own previous code. This maintains GAN-like separation.
6. **Verification-first** — Before evaluation, run the explicit checks from the Verification Plan. Do not hardcode `pnpm build` as the universal gate.
7. **Context discipline** — Pass only the sprint contract, execution brief, evidence packet, and relevant feedback to agents. Do not dump entire conversation history.
8. **No worktree assumption** — Worktree isolation may be used by the caller, but the harness must not require it or assume a dedicated worktree command exists.
