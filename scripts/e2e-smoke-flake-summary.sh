#!/usr/bin/env bash
# Observability for masked E2E flakes (#1293). wdio.smoke.conf.ts sets
# specFileRetries: 1, so a WebKitGTK `no such window` crash on the first attempt
# is silently recovered by a same-run spec re-run and the job still goes green —
# the flake never shows up in the workflow's pass/fail tally. This aggregates
# those markers from the captured run log into $GITHUB_STEP_SUMMARY and raises a
# NON-failing warning annotation when any appear, so a green run still surfaces
# the flake for #1293 tracking. Purely observational: always exits 0.
set -uo pipefail

LOG="${1:?usage: e2e-smoke-flake-summary.sh <log-file> [label]}"
LABEL="${2:-e2e-smoke}"

if [[ ! -f "$LOG" ]]; then
  echo "flake-summary: log '$LOG' not found; nothing to aggregate" >&2
  exit 0
fi

# grep -c counts matching lines (exits 1 on no match -> `|| true` keeps the "0").
# `no such window`  = WebKitGTK/wry webview hard-crash (see scripts/e2e-smoke-ci.sh).
# `RETRYING`        = @wdio/cli launcher spec-file retry marker (specFileRetries).
crash_count=$(grep -c "no such window" "$LOG" 2>/dev/null || true)
retry_count=$(grep -c "RETRYING" "$LOG" 2>/dev/null || true)
crash_count=${crash_count:-0}
retry_count=${retry_count:-0}
total=$((crash_count + retry_count))

summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
{
  echo "### E2E masked-flake markers — ${LABEL}"
  echo ""
  echo "| marker | count |"
  echo "| --- | --- |"
  echo "| \`no such window\` (WebKitGTK crash) | ${crash_count} |"
  echo "| \`RETRYING\` (specFileRetries recovery) | ${retry_count} |"
  echo ""
  if [[ "$total" -eq 0 ]]; then
    echo "No masked-flake markers in this run."
  else
    echo "A green run can hide these via same-run spec retry — tracked in #1293."
  fi
} >>"$summary"

# Non-failing annotation only when a masked flake actually appeared.
if [[ "$total" -ge 1 ]]; then
  echo "::warning title=E2E masked flake (${LABEL})::${crash_count} 'no such window' + ${retry_count} RETRYING marker(s) recovered in-run — see #1293"
fi

exit 0
