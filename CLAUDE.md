# nds-mcp — Nuclear Data Services MCP Server

Offline SQLite-backed MCP server for nuclear physics data queries.

## Data Sources

Main DB (`nds.sqlite`, auto-downloaded):

| Source | Tables | Content |
|--------|--------|---------|
| AME2020 | `ame_masses`, `ame_reactions` | Mass excess, binding energy, separation energies, Q-values |
| NUBASE2020 | `nubase` | Half-life, spin/parity, decay modes, isomers |
| IAEA charge radii | `charge_radii` | RMS charge radii (Angeli & Marinova / IAEA-2024 compilation) |
| Li et al. 2021 | `laser_radii`, `laser_radii_refs` | Laser spectroscopy charge radii (21 elements, 257 isotopes) |
| ENSDF | `ensdf_datasets`, `ensdf_levels`, `ensdf_gammas`, `ensdf_decay_feedings`, `ensdf_references` | Nuclear structure: levels, gamma transitions, beta/EC decay feedings, NSR bibliography |
| TUNL | `tunl_levels` | Light-nuclei energy levels (A=4–20, 59 nuclides, 2512 levels): resonance widths + width_relation, isospin, decay modes, table_label provenance |
| CODATA 2022 | `codata_constants`, `codata_meta` | Fundamental constants (value/uncertainty/unit, exact/truncated flags) |

Optional DBs (auto-downloaded on first tool call unless `NDS_*_DB_PATH` is set):

| Source | DB file | Tables | Content |
|--------|---------|--------|---------|
| JENDL-5 Decay | `jendl5.sqlite` | `jendl5_decays`, `jendl5_decay_modes`, `jendl5_radiation` | Decay data + radiation spectra (discrete lines + continuous summaries) |
| JENDL-5 XS | `jendl5.sqlite` | `jendl5_xs_meta`, `jendl5_xs_points`, `jendl5_xs_interp` | Pointwise cross sections + ENDF-6 NBT/INT interpolation laws |
| EXFOR | `exfor.sqlite` | `exfor_entries`, `exfor_points`, `exfor_meta` | Experimental data points (SIG/MACS/DA/DE/FY) + per-entry metadata |

Optional DBs (maintainer ingest only; no public auto-download today):

| Source | DB file | Tables | Content |
|--------|---------|--------|---------|
| FENDL-3.2c | `fendl32c.sqlite` | `fendl_xs_meta`, `fendl_xs_points`, `fendl_xs_interp`, `fendl_raw_archives`, `fendl_meta` | ENDF-6 evaluated cross sections (transport) + embedded upstream zip archives (BLOB; metadata-only via tools) |
| IRDFF-II | `irdff2.sqlite` | `irdff_xs_meta`, `irdff_xs_points`, `irdff_xs_interp`, `irdff_raw_archives`, `irdff_meta` | ENDF-6 dosimetry cross sections + embedded upstream archives |
| DDEP *(internal, sample-only)* | `ddep.sqlite` | `ddep_meta`, `ddep_nuclides`, `ddep_radiation` | Evaluated radionuclide half-lives + key emission lines. Current ingest is a stub (handful of nuclides); tool hidden unless `NDS_TOOL_MODE=full` **and** `NDS_ENABLE_DDEP=1` |

## Key Conventions

- **Zod SSOT**: All tool input schemas defined with Zod in `src/tools/registry.ts`
- **sqlite3 CLI**: Uses `src/shared/sqlite3Cli.ts` (subprocess, not binding)
- **No artifact system**: Simpler than pdg-mcp; all results inline
- **Auto-download**: On first start, downloads pre-built SQLite to `~/.nds-mcp/nds.sqlite`
- **DB integrity policy (required)**:
  - Every shipped SQLite file (`nds.sqlite`, `jendl5.sqlite`, `exfor.sqlite`, `ddep.sqlite`, `fendl32c.sqlite`, `irdff2.sqlite`) must pass:
    1) non-empty file check, 2) SQLite header check (`SQLite format 3\0`).
  - Applies to both auto-downloaded DBs and maintainer-built optional DBs.
  - This policy applies to existing DBs and any newly added optional DBs in future changes.
  - Note: `scripts/check-db.sh` currently only validates `main|jendl5|exfor|ddep`; FENDL/IRDFF row-count checks must be added before FENDL/IRDFF assets are uploaded.
- **DDEP visibility policy (required)**:
  - DDEP is hidden/internal-only (`full` mode); it is not part of public standard-mode docs.
  - `README.md` must not expose DDEP tools/env vars unless explicitly deciding to make DDEP public.
  - Internal docs (`CLAUDE.md`, `RUNBOOK.md`) may keep DDEP operational details.
- **Engineering principle (required)**:
  - Do not over-engineer. Prefer the simplest mechanism that reliably solves the current problem.
  - New validation/automation must have clear operational value; avoid adding knobs by default.
- **Network fallback**: If network access fails (download/search/API timeout), try proxy first:
  `export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890`
- **Cross-source default rule**: If the same physical observable exists in multiple databases/sources, query tools should return source-tagged values from each source by default (and provide a clear recommended/best value only as an additional field, not by silently dropping alternatives).
- **Docs sync**: Any change to DB files (new DB, schema, contents, download URLs, env vars) must update `README.md` in the same PR.
- **Release gating (required)**: Every newly included optional DB must have a locally constructed sqlite artifact (e.g. `~/.nds-mcp/ddep.sqlite`) before claiming the step is complete and before uploading release assets.

## Execution Workflow (v2)

- **Scope gate**:
  - Small, low-risk edits (single-file, easy rollback) can skip heavy planning.
  - Multi-step, high-risk, or architecture-changing work must start with an explicit plan.
- **Explore -> plan -> implement**:
  - Start with read-only exploration and constraints capture.
  - For non-trivial work, write a checkable plan in `tasks/todo.md`.
  - Implement with minimal surface-area changes.
- **Verification gate (required)**:
  - Do not claim completion without evidence.
  - Run relevant tests/build/static checks and record the commands/results in `.tmp/tasks/todo.md`.
  - For behavior-sensitive changes, compare before/after behavior.
  - Definition of done: required checks pass and evidence is recorded.
- **Subagent policy**:
  - Use subagents for parallelizable, context-heavy, or independent subproblems.
  - Do not spawn agents by default when single-threaded execution is simpler.
- **Feedback and lessons**:
  - When user correction is generalizable, add a short prevention rule to `tasks/lessons.md`.
  - Keep lessons concise, actionable, and deduplicated.
- **Context hygiene**:
  - If execution drifts, stop and re-plan instead of pushing forward blindly.
  - Keep `CLAUDE.md` compact; place task-specific detail in task docs.
- **Safety defaults**:
  - Treat high-impact operations conservatively and verify assumptions before applying them.
  - Prefer structured outputs between steps to reduce accidental misuse.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NDS_DB_PATH` | `~/.nds-mcp/nds.sqlite` | Main DB path (set to skip auto-download) |
| `NDS_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `nds.sqlite` |
| `NDS_JENDL5_DB_PATH` | `~/.nds-mcp/jendl5.sqlite` | Optional JENDL-5 DB path (decay + XS tools) |
| `NDS_JENDL5_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `jendl5.sqlite` |
| `NDS_EXFOR_DB_PATH` | `~/.nds-mcp/exfor.sqlite` | Optional EXFOR DB path |
| `NDS_EXFOR_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `exfor.sqlite` |
| `NDS_FENDL_DB_PATH` | `~/.nds-mcp/fendl32c.sqlite` | Optional FENDL-3.2c DB path (maintainer ingest; surfaced in `nds_info` / `nds_catalog`) |
| `NDS_FENDL_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `fendl32c.sqlite` (no public asset uploaded today) |
| `NDS_IRDFF_DB_PATH` | `~/.nds-mcp/irdff2.sqlite` | Optional IRDFF-II DB path (maintainer ingest; surfaced in `nds_info` / `nds_catalog`) |
| `NDS_IRDFF_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `irdff2.sqlite` (no public asset uploaded today) |
| `NDS_DDEP_DB_PATH` | `~/.nds-mcp/ddep.sqlite` | Optional DDEP DB path (internal/sample only) |
| `NDS_DDEP_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `ddep.sqlite` |
| `NDS_TOOL_MODE` | `standard` | `standard` (default) or `full`. `full` exposes `nds_self_update` and (if `NDS_ENABLE_DDEP=1`) `nds_get_ddep_decay`. |
| `NDS_ENABLE_DDEP` | unset | Set to `1` to expose `nds_get_ddep_decay` even in `full` mode; otherwise DDEP stays hidden ([registry.ts:87](src/tools/registry.ts:87)). |

## Build & Test

```bash
pnpm build                    # Compile TypeScript
pnpm test                     # Run vitest
pnpm run ingest -- --data-dir /path/to/raw --output /path/to/nds.sqlite  # Build DB
```

## Database Rebuild

Internal-only: `RUNBOOK.md` is a maintainer/agent SOP (not for MCP client users).

We publish/distribute **SQLite database files** (e.g. `nds.sqlite`, optional `jendl5.sqlite` / `exfor.sqlite`).  
We do **not** redistribute upstream raw data snapshots (size + upstream terms); maintainers download them from the original sources.

Raw data files needed in `--data-dir`:
- `mass_1.mas20` — AME2020 mass table
- `rct1.mas20` — AME2020 reaction energies (S2n, S2p, Qα, Q2β⁻, Qεp, Qβ⁻n)
- `rct2_1.mas20` — AME2020 reaction energies (Sn, Sp, Q4β⁻, Qd,α, Qp,α, Qn,α)
- `nubase_4.mas20` — NUBASE2020 nuclear properties
- `charge_radii.csv` — IAEA charge radii
- `laser_radii/Radii.tex` — Li et al. 2021 laser spectroscopy radii (LaTeX source)
- `tunl/*.txt` — TUNL energy level tables (pdftotext -layout output from nucldata.tunl.duke.edu)
- `codata/allascii.txt` *(optional)* — CODATA constants source text (if absent, ingest downloads from NIST)

Download from: https://www-nds.iaea.org/amdc/ (add `.txt` to AME/NUBASE filenames)

### TUNL incremental rebuild

```bash
pnpm run ingest -- --tunl-only --db /path/to/nds.sqlite --tunl-dir /path/to/raw/tunl
```

### JENDL-5 optional DB rebuild (maintainer)

```bash
# Decay
scripts/download-jendl5-dec.sh ~/.nds-mcp/raw/jendl5-dec_upd5.tar.gz
pnpm run ingest:jendl5-dec -- --source ~/.nds-mcp/raw/jendl5-dec_upd5.tar.gz --output ~/.nds-mcp/jendl5.sqlite

# Neutron XS (300K pointwise)
scripts/download-jendl5-xs.sh ~/.nds-mcp/raw/jendl5-n-300K.tar.gz
pnpm run ingest:jendl5-xs -- --source ~/.nds-mcp/raw/jendl5-n-300K.tar.gz --output ~/.nds-mcp/jendl5.sqlite
```

Release note (required): build `jendl5.sqlite` locally and verify (`scripts/check-db.sh --only main,jendl5`) before uploading any release asset.

### FENDL-3.2c / IRDFF-II optional DB rebuild (maintainer)

No `download-fendl.sh` / `download-irdff.sh` helper today; grab the upstream ENDF-6 packages manually from the IAEA portals:

- FENDL-3.2c: https://www-nds.iaea.org/fendl/
- IRDFF-II: https://www-nds.iaea.org/IRDFF/

```bash
pnpm exec tsx src/index.ts ingest --fendl --source ~/.nds-mcp/raw/fendl-3.2c --output ~/.nds-mcp/fendl32c.sqlite
pnpm exec tsx src/index.ts ingest --irdff --source ~/.nds-mcp/raw/irdff-2 --output ~/.nds-mcp/irdff2.sqlite
```

`--source` accepts either a directory (recursively scanned) or a `.zip` / `.tar.gz` archive of ENDF-6 files. Both ingests preserve raw upstream archives as BLOBs in `*_raw_archives` for completeness; tools (`nds_query`, `nds_list_raw_archives`) return metadata only.

Verification today is manual until `scripts/check-db.sh` gets `fendl|irdff` cases (see DB integrity policy note above). Quick sanity row counts:

```bash
sqlite3 ~/.nds-mcp/fendl32c.sqlite \
  "SELECT 'xs_meta',COUNT(*) FROM fendl_xs_meta UNION ALL SELECT 'raw_archives',COUNT(*) FROM fendl_raw_archives;"
sqlite3 ~/.nds-mcp/irdff2.sqlite \
  "SELECT 'xs_meta',COUNT(*) FROM irdff_xs_meta UNION ALL SELECT 'raw_archives',COUNT(*) FROM irdff_raw_archives;"
```
