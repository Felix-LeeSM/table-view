#!/usr/bin/env bash
# Sprint 175 — Boot-time measurement harness.
#
# Drives the four scenarios required by `docs/sprints/sprint-175/baseline.md`:
#   - launcher-cold
#   - launcher-warm
#   - workspace-cold
#   - workspace-warm
#
# For each scenario this script runs N=5 trials, drops the slowest, computes
# median and p95 of every milestone produced by the frontend boot summary
# line ("[boot] T0=0 ... app:effects-fired=...") plus the two Rust log
# tokens (rust:entry, rust:first-ipc), and prints a Markdown table per
# scenario that can be pasted into baseline.md.
#
# Usage:
#   ./scripts/measure-startup.sh [scenario]
#       scenario ∈ {launcher-cold, launcher-warm, workspace-cold, workspace-warm, all}
#
# Cold-vs-warm protocol:
#   - cold: kill all `table-view` / `tauri-driver` processes and run
#     `purge` (macOS) or `sync && echo 3 > /proc/sys/vm/drop_caches` (Linux)
#     before each trial. macOS `purge` requires sudo; the script will warn
#     and continue without if not available — record that fact in notes.
#   - warm: launch immediately after the previous trial's clean exit.
#
# Notes:
#   - Numbers come from the webview's `[boot] ...` summary line, which is
#     a `console.info(...)` call. Tauri 2 release builds disable WKWebView
#     devtools by default, so the operator interactive path uses a
#     `pnpm tauri build --debug --no-bundle` build (debug Rust binary +
#     production Vite bundle). Devtools is auto-enabled in debug builds,
#     so the operator can right-click → Inspect Element and read the
#     summary line. This is what `baseline.md` records as the `build
#     mode` — comparisons across sprints stay valid as long as every
#     sprint baselines + re-measures with the same recipe.
#   - The script depends on `tauri-driver` for headless launch when run
#     inside Docker. On macOS dev box, the user must run the trials
#     interactively and paste the eight-milestone summary line; this
#     script provides the parser.
#   - Slowest trial is dropped before reporting (so slowdowns from
#     spotlight indexing, security daemons, or one-off OS noise don't
#     dominate the median).

set -euo pipefail

SCENARIO="${1:-all}"
TRIALS="${TRIALS:-5}"
LOG_DIR="${LOG_DIR:-./.startup-trials}"
mkdir -p "$LOG_DIR"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Drop OS file cache. macOS needs sudo `purge`; Linux needs root for
# /proc/sys/vm/drop_caches. We do best-effort and continue without on
# failure, but the operator should record the fallback in notes.
clear_os_cache() {
    case "$(uname -s)" in
        Darwin)
            if command -v purge >/dev/null 2>&1; then
                sudo purge 2>/dev/null || echo "[warn] sudo purge unavailable; skipping cache drop"
            fi
            ;;
        Linux)
            sync || true
            if [ -w /proc/sys/vm/drop_caches ]; then
                echo 3 > /proc/sys/vm/drop_caches
            else
                echo "[warn] /proc/sys/vm/drop_caches not writable; skipping cache drop"
            fi
            ;;
    esac
}

# Kill any stale app / driver processes so cold means cold.
kill_app_processes() {
    pkill -f "tauri-driver" 2>/dev/null || true
    pkill -f "table-view" 2>/dev/null || true
    pkill -f "Table View" 2>/dev/null || true
    sleep 1
}

# Parse a `[boot] T0=0 theme:applied=2.5 ...` line and emit one
# `<milestone>\t<ms>` row per known milestone. Missing values become `NA`.
parse_summary() {
    local line="$1"
    local names=(T0 theme:applied session:initialized connectionStore:imported connectionStore:hydrated react:render-called react:first-paint app:effects-fired)
    for n in "${names[@]}"; do
        local val
        val=$(echo "$line" | sed -nE "s/.* ${n//:/\\:}=([^ ]+).*/\\1/p")
        if [ -z "$val" ] || [ "$val" = "<missing>" ]; then
            printf "%s\tNA\n" "$n"
        else
            printf "%s\t%s\n" "$n" "$val"
        fi
    done
}

median() {
    sort -n | awk '
    {
        a[NR]=$1
    }
    END {
        if (NR == 0) { print "NA"; exit }
        if (NR % 2 == 1) print a[(NR+1)/2]
        else printf "%.2f\n", (a[NR/2] + a[NR/2 + 1]) / 2
    }'
}

p95() {
    sort -n | awk '
    {
        a[NR]=$1
    }
    END {
        if (NR == 0) { print "NA"; exit }
        idx = int(NR * 0.95 + 0.5)
        if (idx < 1) idx = 1
        if (idx > NR) idx = NR
        print a[idx]
    }'
}

# ---------------------------------------------------------------------------
# Trial runner — operator-driven on macOS, automated under Docker E2E.
# ---------------------------------------------------------------------------
#
# This function is intentionally simple. It runs the app and waits for the
# `[boot] ...` summary line to appear in stdout. The timeout is 60s —
# anything slower indicates a real problem worth investigating before
# averaging away.
run_one_trial() {
    local scenario="$1"
    local trial_idx="$2"
    local out_file="$LOG_DIR/$scenario-trial-$trial_idx.log"

    if [ "$scenario" = "launcher-cold" ] || [ "$scenario" = "workspace-cold" ]; then
        kill_app_processes
        clear_os_cache
    fi

    # Operator-driven path — print instructions and wait for the user to
    # paste the summary line. This is the macOS dev-box default.
    if [ -z "${MEASURE_NONINTERACTIVE:-}" ]; then
        echo "" >&2
        echo "=== $scenario · trial $trial_idx ===" >&2
        echo "1) Build (once per session, not per trial):" >&2
        echo "     pnpm tauri build --debug --no-bundle" >&2
        echo "2) Launch the binary directly:" >&2
        echo "     ./src-tauri/target/debug/table-view" >&2
        echo "   (release builds disable devtools; --debug keeps them on so you can read the boot summary.)" >&2
        echo "3) Wait for the launcher / workspace to render." >&2
        echo "4) Open devtools: right-click in the window → Inspect Element (or Cmd+Option+I)." >&2
        echo "5) Switch to the Console tab. Copy the line that starts with '[boot] T0=0' and paste below, then Enter." >&2
        echo "   (For workspace-cold/warm: open a connection from the launcher first, then read the workspace window's console.)" >&2
        echo "Summary line:" >&2
        IFS= read -r summary
        echo "$summary" > "$out_file"
    else
        # Non-interactive path — Docker E2E container. Tauri stdout is
        # captured via the WebDriver harness; the operator has redirected
        # it into $out_file already.
        if [ ! -s "$out_file" ]; then
            echo "[error] non-interactive mode requires $out_file to be pre-populated" >&2
            return 1
        fi
    fi

    parse_summary "$(grep -F '[boot]' "$out_file" | tail -n 1)"
}

aggregate() {
    local scenario="$1"
    echo ""
    echo "## $scenario"
    echo ""
    echo "| milestone | median (ms) | p95 (ms) | notes |"
    echo "|---|---|---|---|"

    local milestones=(T0 theme:applied session:initialized connectionStore:imported connectionStore:hydrated react:render-called react:first-paint app:effects-fired)
    for m in "${milestones[@]}"; do
        # Collect per-trial values, drop NAs, drop the slowest, compute
        # median and p95.
        local values
        # macOS BSD `head -n -1` is illegal (negative counts only on GNU
        # coreutils). Use `sed '$d'` to drop the slowest (last after
        # ascending sort) — works on both BSD and GNU.
        values=$(for i in $(seq 1 "$TRIALS"); do
            grep -E "^${m//:/\\:}\s" "$LOG_DIR/$scenario-parsed-trial-$i.tsv" 2>/dev/null \
                | awk '{print $2}'
        done | grep -v '^NA$' | sort -n | sed '$d')

        if [ -z "$values" ]; then
            printf "| %s | NA | NA | no data |\n" "$m"
            continue
        fi

        local med p95v
        med=$(echo "$values" | median)
        p95v=$(echo "$values" | p95)
        printf "| %s | %s | %s |  |\n" "$m" "$med" "$p95v"
    done
}

run_scenario() {
    local scenario="$1"
    echo "=== Running $scenario ($TRIALS trials, slowest dropped) ===" >&2

    for i in $(seq 1 "$TRIALS"); do
        run_one_trial "$scenario" "$i" > "$LOG_DIR/$scenario-parsed-trial-$i.tsv"
    done

    aggregate "$scenario"
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

case "$SCENARIO" in
    launcher-cold|launcher-warm|workspace-cold|workspace-warm)
        run_scenario "$SCENARIO"
        ;;
    all)
        for s in launcher-cold launcher-warm workspace-cold workspace-warm; do
            run_scenario "$s"
        done
        ;;
    *)
        echo "Usage: $0 [launcher-cold|launcher-warm|workspace-cold|workspace-warm|all]" >&2
        exit 2
        ;;
esac
