# Agent Workflow Policy for `nds-mcp`

This file mirrors the execution workflow in `CLAUDE.md` so local agent behavior stays consistent.

## 1) Scope Gate

- Use lightweight execution for small, low-risk edits that are easy to rollback.
- Use explicit planning for multi-step, high-risk, or architectural work.

## 2) Explore -> Plan -> Implement

- Explore first with read-only inspection.
- For non-trivial work, write a checkable plan in `tasks/todo.md`.
- Keep implementation minimal and targeted.

## 3) Verification Gate (Required)

- Never mark work complete without proof.
- Run relevant tests/build/lint checks and log the commands/results in `.tmp/tasks/todo.md`.
- Compare behavior before/after for behavior-sensitive changes.
- Definition of done: required checks pass and evidence is recorded.

## 4) Subagent Strategy

- Use subagents for parallel, independent, or context-heavy tasks.
- Avoid unnecessary multi-agent orchestration when a direct edit is clearer.

## 5) Feedback Loop

- If user feedback reveals a reusable pattern, add it to `tasks/lessons.md`.
- Keep rules short, specific, and focused on preventing recurrence.

## 6) Context Hygiene

- If execution drifts or new contradictions appear, stop and re-plan.
- Keep persistent policy in `CLAUDE.md` / `AGENTS.md`; keep task detail in task files.

## 7) Safety Defaults

- Be conservative with high-impact actions.
- Prefer structured outputs and explicit checks between major steps.
