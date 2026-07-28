#!/usr/bin/env bash
# OTLP counter emitter for hook-side signals. Opt-in, local-only, fail-silent.
#
# Claude Code's own telemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) already covers
# tool decisions, durations and result sizes. What it cannot see is whether a
# rule this repo tried to route actually reached the agent, which is the one
# thing the routing work needs to measure. Hence one custom counter rather than
# a parallel telemetry stack.
#
# Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set — no endpoint, no emission, no
# cost. ADR 0036 (telemetry zero-collection) is not touched: nothing leaves the
# machine, the endpoint is a collector the developer runs.
#
# Never blocks and never fails the hook: bounded by `--max-time`, backgrounded,
# and every error is discarded. A metrics pipeline must not be able to stop an
# edit.
#
# Contract:
#   otel_count <metric-name> <value> [key=value ...]

otel_count() {
	local metric="$1" value="$2"
	shift 2
	[ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ] || return 0
	command -v curl >/dev/null 2>&1 || return 0
	command -v jq >/dev/null 2>&1 || return 0

	local attrs='[]' kv k v
	for kv in "$@"; do
		k="${kv%%=*}"
		v="${kv#*=}"
		attrs="$(jq -c --arg k "$k" --arg v "$v" '. + [{key: $k, value: {stringValue: $v}}]' <<<"$attrs")" || return 0
	done

	# OTLP wants nanoseconds since epoch. `date +%s%N` is GNU; BSD date has no %N,
	# so fall back to seconds padded out — the resolution does not matter for a
	# counter, only that the field is present and monotonic-ish.
	local now
	now="$(date +%s%N 2>/dev/null)"
	case "$now" in
		*N* | '') now="$(date +%s)000000000" ;;
	esac

	local payload
	payload="$(jq -n \
		--arg metric "$metric" \
		--argjson value "$value" \
		--arg now "$now" \
		--argjson attrs "$attrs" \
		'{
			resourceMetrics: [{
				resource: { attributes: [{ key: "service.name", value: { stringValue: "table-view-hooks" } }] },
				scopeMetrics: [{
					scope: { name: "scripts/hooks" },
					metrics: [{
						name: $metric,
						sum: {
							aggregationTemporality: 2,
							isMonotonic: true,
							dataPoints: [{
								asInt: $value,
								timeUnixNano: $now,
								startTimeUnixNano: $now,
								attributes: $attrs
							}]
						}
					}]
				}]
			}]
		}')" || return 0

	curl -s -o /dev/null --max-time 2 \
		-X POST "${OTEL_EXPORTER_OTLP_ENDPOINT%/}/v1/metrics" \
		-H 'Content-Type: application/json' \
		--data-binary "$payload" >/dev/null 2>&1 &
	disown 2>/dev/null || :
	return 0
}
