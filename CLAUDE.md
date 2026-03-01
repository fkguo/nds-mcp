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
| DDEP *(optional, `ddep.sqlite`)* | `ddep_meta`, `ddep_nuclides`, `ddep_radiation` | Evaluated radionuclide half-lives + key emission lines |
| CODATA 2022 | `codata_constants`, `codata_meta` | Fundamental constants (value/uncertainty/unit) |

## Key Conventions

- **Zod SSOT**: All tool input schemas defined with Zod in `src/tools/registry.ts`
- **sqlite3 CLI**: Uses `src/shared/sqlite3Cli.ts` (subprocess, not binding)
- **No artifact system**: Simpler than pdg-mcp; all results inline
- **Auto-download**: On first start, downloads pre-built SQLite to `~/.nds-mcp/nds.sqlite`
- **Network fallback**: If network access fails (download/search/API timeout), try proxy first:
  `export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890`
- **Cross-source default rule**: If the same physical observable exists in multiple databases/sources, query tools should return source-tagged values from each source by default (and provide a clear recommended/best value only as an additional field, not by silently dropping alternatives).
- **Docs sync**: Any change to DB files (new DB, schema, contents, download URLs, env vars) must update `README.md` in the same PR.

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
