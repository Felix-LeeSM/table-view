# Sprint 473 Handoff: MongoDB Profile Normalization

## Summary

MongoDB is normalized as the document-source profile in both TypeScript and
Rust profile tests. The workspace query-tab compatibility layer now treats
`queryLanguage: "mongosh"` as routing metadata and keeps `queryMode` as legacy
state only.

## Closed

- MongoDB profile metadata is explicit: document paradigm, server connection,
  mongosh language, document catalog, document/tabular result envelopes,
  document safety policy, and MongoDB document backend adapter capability.
- Document query tabs opened from history/load no longer seed `queryMode`.
- Rehydrated legacy document tabs preserve only old `find` / `aggregate`
  compatibility values.

## Remaining Gaps

- Mongo catalog/result envelope IPCs still return legacy grid-compatible data
  rather than a first-class document envelope boundary.
- Phase 28 unified mongosh editor work remains scoped to whitelisted parser
  dispatch; arbitrary JavaScript shell execution remains out of scope.
- Mongo edit/safety semantics beyond the current profile declaration continue
  in Sprints 474-476.

## Risk Link

- `docs/RISKS.md` tracks the open follow-up as `RISK-048`.
