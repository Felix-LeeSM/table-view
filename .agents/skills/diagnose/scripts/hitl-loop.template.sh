#!/usr/bin/env bash
# Human-in-the-loop reproduction loop.
#
# THE AGENT DOES NOT RUN THIS. The agent copies this file, edits the steps, and
# hands the path to the user; the USER runs it in their own terminal and pastes
# the KEY=VALUE block back.
#
# Measured: in an agent's Bash tool there is no terminal on stdin — `[ -t 0 ]`
# is false and `read -r -t 2` returns rc=1 on immediate EOF. Every `read` below
# would fall through unanswered, so an agent-run loop collects nothing and looks
# like it succeeded. The old header said the opposite ("the agent runs the
# script; the user follows prompts"), which is not reachable in this harness.
#
# Usage (user, in their own terminal):
#   bash hitl-loop.template.sh
#
# Two helpers:
#   step "<instruction>"          → show instruction, wait for Enter
#   capture VAR "<question>"      → show question, read response into VAR
#
# At the end, captured values are printed as KEY=VALUE. Paste that block back to
# the agent.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

step "Open the app at http://localhost:3000 and sign in."

capture ERRORED "Click the 'Export' button. Did it throw an error? (y/n)"

capture ERROR_MSG "Paste the error message (or 'none'):"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
