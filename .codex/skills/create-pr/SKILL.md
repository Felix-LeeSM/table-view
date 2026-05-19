---
name: create-pr
description: Creates GitHub pull requests. Use when creating PRs, submitting changes for review, or when the user says /pr or asks to create a pull request.
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob
---

# Create Pull Request

Each phase ends with a user confirmation step. Do not proceed to the next phase until the user responds.

## Phase 1: Check current state

### 1. Check current state

```bash
git status --short
git log main..HEAD --oneline
git diff main...HEAD --stat
```

If there are uncommitted changes, warn the user before proceeding.

### 2. Read the PR template

Read `.github/pull_request_template.md` from the repository root. Preserve its **exact section structure** in the PR body — do not add, remove, or rename any sections.

If uncommitted changes exist, ask the user how to proceed.

## Phase 2: Draft the PR

### 3. Determine PR title

Use Conventional Commits format. Follow the language convention of existing commits in the repository (Korean or English).

```
<type>: <summary>
```

Types: `feat`, `fix`, `perf`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`

### 4. Write the PR body

Fill in the template sections with the following rules:

**Opening description (the first free-text area in the template):**
- Write a high-level overview so reviewers can quickly understand the direction and purpose of the change before reading the details.
- Focus on what is being improved and why, not on implementation specifics.

**Technical details:**
- Put implementation specifics (what files changed, what patterns were used) in the later sections of the template, not in the opening description.

### 5. Push the branch if needed

```bash
# Check if the branch has an upstream
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || git push -u origin HEAD
```

### 6. Show draft for approval

Present the full PR title and body to the user, and ask whether to create as **draft** or **ready for review**.

## Phase 3: Create the PR

### 7. Create the PR

```bash
# Add --draft flag if user chose draft
gh pr create --title "<title>" [--draft] --body "$(cat <<'EOF'
<body>
EOF
)"
```

Return the PR URL when done.
