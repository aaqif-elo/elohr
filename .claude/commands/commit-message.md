---
description: Generate a Conventional Commits message from the staged changes
argument-hint: "[optional hint, e.g. a type/scope or focus]"
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---

## Context

- Staged files: !`git diff --cached --stat`
- Full staged diff: !`git diff --cached`
- Recent commit style for reference: !`git log --oneline -10`

## Task

Write a commit message describing **only the staged changes** shown above.

If the staged diff is empty, do not invent a message — tell the user there is
nothing staged and suggest `git add`, then stop.

Optional user hint: $ARGUMENTS

Rules:
- Follow Conventional Commits, matching this repo's history: `type: subject`
  (types seen here: `feat`, `fix`, `refactor`, `chore`, `docs`). Add a `(scope)`
  only when it sharpens meaning.
- Subject: imperative mood, lowercase after the type, no trailing period,
  ≤ ~72 chars.
- Add a body only when the change needs the "why" or has non-obvious impact.
  Wrap at ~72 chars, use `-` bullets for multiple distinct changes.
- Summarize what the diff actually does; never describe unstaged work or guess
  at intent beyond the code.
- If the hint conflicts with what the diff shows, trust the diff.

Output the message inside a single ```text fenced block so it can be copied
directly. Do not run `git commit` unless I explicitly ask.
