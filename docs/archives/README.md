# Docs Archive Index

Inactive docs live here. Future goals stay in `docs/ROADMAP.md`, current product
state and limitations in `docs/product/`, developer-facing follow-ups in
`docs/contributor-guide/`, active phase specs in `docs/phases/`.
Live execution state for current refactor buckets stays in GitHub milestones and
issues, with `docs/ROADMAP.md` carrying only the durable routing summary.

## Audit Rules

- Treat every file under this directory as historical unless a current SOT links
  it as evidence.
- Event-time words such as `active`, `planned`, `current`, and backticked repo
  paths are snapshot context. They do not override `docs/ROADMAP.md`,
  `docs/product/**`, `docs/contributor-guide/**`, or live GitHub milestones and
  issues.
- New future work must be routed to `docs/ROADMAP.md` or an open GitHub issue,
  not appended to archive snapshots.

## Categories

| Directory | Content |
|---|---|
| `action-plans/` | retired action plans replaced by sprint work or active SOT docs |
| `audits/` | completed audits still useful as reference |
| `backlogs/` | retired backlog drafts and refactor scans |
| `decisions/` | historical ADR archive |
| `design-snapshots/` | legacy architecture/design snapshots |
| `incidents/` | historical lesson/incident archive |
| `phases/completed/` | completed phase specs |
| `phases/retired/` | obsolete phase sketches kept for history |
| `plans/` | completed roadmap, sequence indexes, and dated plan snapshots; not active backlog |
| `product-snapshots/` | dated product capability/comparison snapshots |
| `risks/` | retired risk registers and resolved risk archive |
| `roadmaps/` | retired memory roadmap snapshots |
| `test-plans/` | retired test improvement plans |
| `workflows/` | inactive workflow handoffs |

## Naming

- Dated snapshots use `{topic}-{YYYY-MM-DD}.md`.
- Completed/retired phases keep `phase-N.md`.
- Multi-file drafts use `{topic}-{YYYY-MM-DD}/`.
