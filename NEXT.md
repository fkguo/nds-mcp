# Next Steps (Maintainer/Agent)

This is a lightweight development plan for `nds-mcp` (not user-facing).

## Recently completed (retro)

Status snapshot as of doc audit on 2026-05-26. Cross-check `~/.nds-mcp/*_meta` and `git log` before relying on this.

- ✅ **Phase-2 DB releases live**: `jendl5.sqlite` (2.1 GB, 30.4 M XS points) and `exfor.sqlite` (528 MB, 7.1 M points) are auto-downloadable from GitHub Releases; `ensureJendl5Db()` / `ensureExforDb()` succeed from clean `~/.nds-mcp/`.
- ✅ **Optional DB meta standardized**: all six DBs (`nds`, `jendl5`, `exfor`, `ddep`, `fendl32c`, `irdff2`) carry the metaContract keys (`schema_version`, `built_at`, `generator`, `generator_version`, `source_kind`, `upstream_name`, `upstream_url`, `upstream_version_or_snapshot`).
- ✅ **JENDL-5 XS direct-ingest pipeline**: maintainers rebuild from upstream `jendl5-n-300K.tar.gz` (or extracted dir / single ENDF / `.gz`) with no JSON/JSONL conversion step.
- ✅ **Universal query Phase 1+2**: `nds_schema`, `nds_query` (BLOB forbidden, `*_points` selectivity guard), `nds_catalog` (libraries + quantities surface), `nds_list_raw_archives` (FENDL/IRDFF metadata only).
- ✅ **FENDL-3.2c + IRDFF-II ingest**: ENDF-6 evaluated XS + embedded upstream zip archives (BLOBs) in `fendl32c.sqlite` (10,722 XS channels, 607 archives) and `irdff2.sqlite` (139 channels, 70 archives). Maintainer-built (no public auto-download asset yet).
- ✅ **CODATA 2022**: 355 constants merged into `nds.sqlite` with separate `codata_meta`; tools `nds_get_constant` / `nds_list_constants` exposed in standard mode.
- ⚠️ **DDEP scaffolded only**: `ddep.sqlite` + `nds_get_ddep_decay` tool exist, but current ingest is a stub (2 nuclides + 3 lines). Tool is double-gated (`NDS_TOOL_MODE=full` AND `NDS_ENABLE_DDEP=1`) until real ingest lands — see "Stepwise ingestion plan → Step 1" below.

## Now (minimal, high-impact)

1) **Close the FENDL/IRDFF operational loop**
   - `scripts/check-db.sh` doesn't yet validate `fendl32c.sqlite` / `irdff2.sqlite` (only `main|jendl5|exfor|ddep`).
   - `scripts/release-phase2-dbs.sh` has no `--fendl` / `--irdff` upload flow.
   - `package.json` has no `ingest:fendl` / `ingest:irdff` shortcut; must use raw `pnpm exec tsx src/index.ts ingest --fendl ...`.
   - Done when: check-db understands `fendl|irdff`, release script can publish both as `*.sqlite.gz`, and shortcut scripts exist. Until then, FENDL/IRDFF violate the "Release gating (required)" policy in CLAUDE.md for any future public release.

2) **Universal query Phase 3 (raw ENDF access without full normalization)**
   - `nds_export_raw_archive` (full-mode tool) — return the upstream zip archive bytes for a given `rel_path`/`sha256` from `fendl_raw_archives` / `irdff_raw_archives`.
   - ENDF section tools `nds_endf_list_sections` + `nds_endf_get_section` — let agents locate/read MF/MT slices inside the embedded zips without ingesting every MF/MT into normalized tables.
   - Docs: keep README acronym/glossary explanations up-to-date (ENDF/MAT/MF/MT, SIG/MACS, etc.).

3) **DDEP real ingest** (see Stepwise Step 1)
   - Replace the 2-nuclide stub with the full LNHB evaluated table set so the tool can leave `NDS_ENABLE_DDEP`-gated mode.

4) **Doc-script consistency policy**
   - When CLAUDE.md / DATABASE.md / RUNBOOK.md add a new optional DB, the same PR must also update `scripts/check-db.sh`, `scripts/release-phase2-dbs.sh`, and `package.json` scripts. The current FENDL/IRDFF gap (item 1) is what this policy is meant to prevent next time.

## Later (new data sources)

- **RIPL-3** (level-density / optical-model / gamma-strength parameters) as a separate optional DB + tools.
- **ENDF/B-VIII.0** evaluated cross sections (large; likely separate DB, reuse the same query/interpolation surface as JENDL).
- **XUNDL** as an unevaluated “latest experiments” layer complementing ENSDF.
- **KADoNiS** for MACS (if not relying solely on EXFOR’s MACS entries).
- **KTUY** theoretical mass predictions (lowest priority).

## Newly recorded sources (missing in prior survey docs)

Compared against:
- `/Users/fkg/Coding/Agents/autoresearch-nds/meta/docs/survey-nuclear-data-sources.md`
- `/Users/fkg/Coding/Agents/autoresearch-nds/meta/docs/nds-mcp-phase2-plan.md`

The following candidates were **not explicitly included** there and are now recorded:

1) **JEFF-3.3** (OECD/NEA evaluated nuclear data library)  
   - Scope: evaluated reaction data; complementary to ENDF/B and JENDL.
   - Size: large (separate optional DB expected).

2) **TENDL** (TALYS-based evaluated library)  
   - Scope: very broad isotope coverage, useful for long-tail nuclides.
   - Risk: model-heavy evaluations, needs clear provenance labeling.

3) **CENDL** (Chinese evaluated nuclear data library)  
   - Scope: regional evaluated library, complementary for cross-checks.
   - Risk: release cadence and data packaging need upfront validation.

4) **DDEP** (Decay Data Evaluation Project)  
   - Scope: high-quality radionuclide decay data for metrology/dosimetry.
   - Size: small-to-medium; good candidate for focused optional DB.

## Web-validated latest versions and formats (as of 2026-03-01)

### JEFF

- Latest official release: **JEFF-4.0** (released June 2025; announced 2025-07-02).
- Public formats visible on NEA Data Bank: **ENDF6**, **ACE**, **PENDF0K**, **HDF5**, **GENDF-1102**.
- Notes for integration: use ENDF6 as ingest canonical source; processed formats can be optional mirrors.

### TENDL

- Latest full public release on official portal: **TENDL-2023** (release 2023-12-22, last update 2024-08-20).
- Public formats on portal: **ENDF** (+ application tar bundles listing ENDF/GND/ACE/PENDF).
- Additional newer public dataset: **“tendl 2025 neutron endf”** (Zenodo, published 2025-11-15, `TENDL-n.tgz`).
- Notes for integration: treat 2023 as stable baseline; evaluate 2025 neutron set as optional delta track.

### CENDL

- Publicly listed general-purpose release in major portals: **CENDL-3.2 (2020)**.
- Public format path is ENDF-oriented (IAEA `download-endf/CENDL-3.2` and NNDC ENDF library index listing).
- Notes for integration: design as ENDF6 ingest pipeline; keep version pin explicit until newer official release appears.

### DDEP

- Release model: **rolling evaluations** (not a single monolithic library release tag like ENDF/JEFF/TENDL).
- Latest citation index on LNHB table page includes **Vol.25 / Metrologia 63 (2026) 019001**.
- Public data form: curated **recommended radionuclide tables** + **Nucléide-Lara online query** (half-life, decay mode, emission energies/intensities).
- Notes for integration: ingest should be “nuclide-by-nuclide evaluated table” workflow, not ENDF-style bulk ingest.

## Stepwise ingestion plan (for newly recorded sources)

### Step 0 — Common admission gate (all candidates)

- Confirm upstream licensing/redistribution terms and pin canonical download URLs.
- Freeze source snapshot identifiers (version/date/hash) and define required meta keys:
  `schema_version`, `built_at`, `generator`, `generator_version`,
  `source_kind`, `upstream_name`, `upstream_url`, `upstream_version_or_snapshot`.
- Define one clear “query surface” per source before implementation.

### Step 1 — DDEP first (small, high-value)

Status (2026-05-26): **scaffolded, content pending**. Schema (`ddep_nuclides`, `ddep_radiation`, `ddep_meta`), ingest path (`pnpm exec tsx src/index.ts ingest --ddep --source <jsonl>`), tool (`nds_get_ddep_decay`), and `nds_info` surfacing all exist; the shipped `ddep.sqlite` is a 2-nuclide stub gated behind `NDS_TOOL_MODE=full` + `NDS_ENABLE_DDEP=1`.

Remaining work:

- Replace the stub JSONL input with the full LNHB DDEP recommended-table corpus (nuclide-by-nuclide pull; not ENDF-style bulk).
- Verify cross-source parity against JENDL-5 decay tools for shared radionuclides.
- Drop the `NDS_ENABLE_DDEP` env-var gate once content is real and DDEP visibility decision is finalized in CLAUDE.md.

### Step 2 — JEFF-3.3 (evaluated cross-section parity source)

- Build `jeff.sqlite` with ENDF-compatible schema matching current JENDL XS query shape.
- Reuse existing interpolation contract (`raw` / `sampled` / point interpolation).
- Add source switch or sibling tools to compare JEFF vs JENDL on same `(Z,A,MT,E)` query.

### Step 3 — TENDL (coverage expansion)

- Build `tendl.sqlite`; prioritize nuclides/reactions absent in JEFF/JENDL.
- Enforce explicit model/provenance markers in every response field.
- Add filtering options to avoid mixing evaluated-vs-model outputs silently.

### Step 4 — CENDL (third evaluated baseline)

- Build `cendl.sqlite` and align schema with JEFF/JENDL for direct comparison.
- Add multi-source comparison output for cross sections (same pattern as charge-radius source-aware output).

### Step 5 — Convergence and rationalization

- Standardize optional reaction DB contracts (`*_meta`, required keys, shared query semantics).
- Add an internal comparison harness (same query over JENDL/JEFF/TENDL/CENDL) for consistency checks.
- Keep only high-signal tools in `standard` mode; place advanced comparison in `full` mode if needed.

## References (local only)

- `/Users/fkg/Coding/Agents/autoresearch-nds/meta/docs/survey-nuclear-data-sources.md`
- `/Users/fkg/Coding/Agents/autoresearch-nds/meta/docs/nds-mcp-phase2-plan.md`
