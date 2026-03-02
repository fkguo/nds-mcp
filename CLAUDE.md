# nds-mcp — Nuclear Data Services MCP Server

Offline SQLite-backed MCP server for nuclear physics data queries.

## Data Sources

| Source | Tables | Content |
|--------|--------|---------|
| AME2020 | `ame_masses`, `ame_reactions` | Mass excess, binding energy, separation energies, Q-values |
| NUBASE2020 | `nubase` | Half-life, spin/parity, decay modes, isomers |
| IAEA | `charge_radii` | RMS charge radii |
| Li et al. 2021 | `laser_radii`, `laser_radii_refs` | Laser spectroscopy charge radii (21 elements, 257 isotopes) |
| TUNL | `tunl_levels` | Energy levels for A=3-20 light nuclei: resonance widths, isospin, decay modes |
| DDEP *(optional, `ddep.sqlite`, internal)* | `ddep_meta`, `ddep_nuclides`, `ddep_radiation` | Evaluated radionuclide half-lives + key emission lines |
| CODATA 2022 | `codata_constants`, `codata_meta` | Fundamental constants (value/uncertainty/unit) |

## Key Conventions

- **Zod SSOT**: All tool input schemas defined with Zod in `src/tools/registry.ts`
- **sqlite3 CLI**: Uses `src/shared/sqlite3Cli.ts` (subprocess, not binding)
- **No artifact system**: Simpler than pdg-mcp; all results inline
- **Auto-download**: On first start, downloads pre-built SQLite to `~/.nds-mcp/nds.sqlite`
- **DB integrity policy (required)**:
  - Every auto-downloaded SQLite file (`nds.sqlite`, `jendl5.sqlite`, `exfor.sqlite`, `ddep.sqlite`) must pass:
    1) non-empty file check, 2) SQLite header check (`SQLite format 3\0`).
  - This policy applies to existing DBs and any newly added optional DBs in future changes.
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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NDS_DB_PATH` | `~/.nds-mcp/nds.sqlite` | Database path (set to skip auto-download) |
| `NDS_JENDL5_DB_PATH` | `~/.nds-mcp/jendl5.sqlite` | Optional JENDL-5 DB path (Phase 2a/2b tools) |
| `NDS_EXFOR_DB_PATH` | `~/.nds-mcp/exfor.sqlite` | Optional EXFOR DB path (Phase 2c tools) |
| `NDS_DDEP_DB_PATH` | `~/.nds-mcp/ddep.sqlite` | Optional DDEP DB path (DDEP decay tool) |
| `NDS_DDEP_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `ddep.sqlite` |
| `NDS_DB_DOWNLOAD_URL` | GitHub Releases latest | Custom download URL for the SQLite file |
| `NDS_TOOL_MODE` | `standard` | Set to `full` to expose all tools |

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
