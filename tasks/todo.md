# Task Plan: Universal Query Phase 2 (Catalog + Raw Archives)

Last updated: 2026-03-03

## Goal

Make the server easier for colleagues to use via agents by adding:

- `nds_catalog` (standard): “what’s installed + what can I query + what tool/table to use”.
- `nds_list_raw_archives` (standard): list raw ENDF archive metadata (never return BLOB payloads).

## Safety / Policy

- DDEP must remain hidden in `standard` mode.
- `nds_query` must continue to forbid selecting BLOB columns.

## Checklist

- [x] Add tool constants + registry entries.
- [x] `nds_catalog` returns library status + minimal quantity directory with example calls.
- [x] `nds_list_raw_archives` supports `library=fendl32c|irdff2`, filters, pagination; returns metadata only.
- [x] Tests: DDEP hidden; raw archives tool does not expose BLOB; pagination works.
- [x] Docs: README tool list + acronym/glossary stays clear (ENDF/MAT/MF/MT).
- [x] Verification: `pnpm lint` + `pnpm test` recorded in `.tmp/tasks/todo.md`.

---

# Task Plan: Make ENDF MT User-Friendly

Last updated: 2026-03-03

## Goal

ENDF **MT numbers** (e.g. `MT=1`, `MT=102`) are not self-explanatory. Keep MT for precision, but always return a human-meaningful
description alongside it so agents/users don't need to memorize the numbering.

## Checklist

- [x] Add a stable `reaction_description` field wherever cross-section tools return `mt`.
- [x] Tests: `reaction_description` is present and non-empty.
- [x] Docs: README clarifies MT vs reaction labels/descriptions.
- [x] Verification: `pnpm lint` + `pnpm test` recorded in `.tmp/tasks/todo.md`.
