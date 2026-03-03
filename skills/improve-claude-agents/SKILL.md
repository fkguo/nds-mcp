---
name: improve-claude-agents
description: "Improve or normalize repository agent policy docs (`CLAUDE.md`, `AGENTS.md`) using a balanced workflow: conditional planning, required verification, scoped subagent usage, and lightweight lessons capture. Use when users ask to tighten agent execution rules, convert rigid rules into practical gates, align CLAUDE/AGENTS policies, or audit existing workflow guidance."
---

# Improve CLAUDE/AGENTS Policy

Use this workflow to update policy docs without making them rigid or verbose.

## Workflow

1. Detect policy files and current state
- Read `CLAUDE.md` and `AGENTS.md` if present.
- If only one file exists, update it and create the missing counterpart only when the user asks for dual-file policy.

2. Apply balanced policy rules
- Convert absolute rules ("always plan", "always use subagents") into conditional gates:
  - Scope gate for simple vs complex work
  - Required verification gate before completion
  - Subagent usage only when parallel/context-heavy work benefits
- Keep mandatory quality bars:
  - No completion claims without evidence
  - Test/build/lint or equivalent verification required
  - Lessons capture only for reusable correction patterns

3. Keep policy compact and actionable
- Prefer short, imperative bullets.
- Avoid duplicate long blocks across files; either mirror concise content or keep one canonical and one pointer.
- Keep task-specific procedures in task docs (`tasks/todo.md`) instead of expanding global policy files.

4. Validate before finishing
- Confirm both files are consistent with the same workflow semantics.
- Confirm no TODO placeholders remain.
- Review diffs for overreach (policy-only change; no unrelated edits).

## Required Policy Sections

When creating or normalizing policy docs, include these sections (exact names may vary):
- Scope gate
- Explore -> plan -> implement
- Verification gate
- Subagent strategy
- Feedback/lessons loop
- Context hygiene
- Safety defaults

## Output Contract

In the final response:
- State which files changed.
- Summarize policy behavior changes in 4-8 bullets.
- Highlight any deliberately deferred item (for example, missing `tasks/` directory).
