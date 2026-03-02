# nds-mcp

Nuclear Data Services MCP server — offline SQLite-backed nuclear physics data for AI agents.

Provides 22 standard tools covering atomic masses (AME2020), nuclear properties (NUBASE2020), charge radii (IAEA + laser spectroscopy), energy levels and gamma transitions (ENSDF), light nuclei resonance data (TUNL, A=3–20), bibliographic references, JENDL-5 decay/cross-section data, EXFOR experimental data, CODATA fundamental constants, and update checks.

## Quick Start

```bash
npx -y nds-mcp
```

The pre-built SQLite database (~85 MB) is automatically downloaded to `~/.nds-mcp/nds.sqlite` on first launch.
By default it downloads from this repo's GitHub Releases (override via `NDS_DB_DOWNLOAD_URL`).
Release assets use a single compressed format: `*.sqlite.gz` (auto-decompressed after download).

Optional tools `JENDL-5` / `EXFOR` use separate SQLite files and are auto-downloaded on demand.
`CODATA` is bundled inside `nds.sqlite`.

## Databases

| SQLite file | Default path | Download behavior | Includes |
|-------------|--------------|-------------------|----------|
| `nds.sqlite` | `~/.nds-mcp/nds.sqlite` | Auto-download on server startup *(required)* | AME2020 masses + reaction Q-values; NUBASE2020 nuclear properties; charge radii (IAEA + Li2021 laser spectroscopy); ENSDF (levels, gammas, decay feedings, references); TUNL light-nuclei resonance/level data (A=3–20); CODATA fundamental constants |
| `jendl5.sqlite` *(optional)* | `~/.nds-mcp/jendl5.sqlite` | Auto-download on first call to JENDL-5 tools | JENDL-5 decay data + radiation spectra; JENDL-5 pointwise cross sections + ENDF-6 interpolation laws |
| `exfor.sqlite` *(optional)* | `~/.nds-mcp/exfor.sqlite` | Auto-download on first call to EXFOR tools | EXFOR experimental data points (SIG/MACS/...) + per-entry metadata |

You can always bring your own files by setting `NDS_DB_PATH` / `NDS_JENDL5_DB_PATH` / `NDS_EXFOR_DB_PATH`.

### Optional DB auto-download trigger

- `jendl5.sqlite` is downloaded when calling `nds_get_radiation_spectrum`, `nds_list_available_targets`, `nds_get_reaction_info`, `nds_get_cross_section_table`, or `nds_interpolate_cross_section`.
- `exfor.sqlite` is downloaded when calling `nds_search_exfor` or `nds_get_exfor_entry`.
- These optional SQLite assets are published on this repo's GitHub Releases page (latest release assets).
- Download URL can point to either plain `.sqlite` or compressed `.sqlite.gz`; server auto-gunzips when needed.
- For maintainers, `jendl5.sqlite` should include both decay tables and XS tables (`jendl5_xs_meta` / `jendl5_xs_points` / `jendl5_xs_interp`) before release upload.

## Install (Optional)

Global install (lets you use `command: "nds-mcp"` in configs):

```bash
npm install -g nds-mcp
nds-mcp
```

From source:

```bash
git clone https://github.com/fkguo/nds-mcp.git
cd nds-mcp
pnpm install
pnpm build
node dist/index.js
```

## Configuration

This is a **local stdio MCP server**. Launch options:

- `npx` (no install): `command: "npx"`, `args: ["-y", "nds-mcp"]`
- global install: `command: "nds-mcp"`, `args: []`

### Clients using `mcpServers` (same JSON)

Claude Code (`./.mcp.json`), Cursor (`./.cursor/mcp.json` or `~/.cursor/mcp.json`), Cline (`cline_mcp_settings.json`),
Kimi Code CLI (`~/.kimi/mcp.json`), Qwen Code CLI (`./.qwen/settings.json` or `~/.qwen/settings.json`).

```json
{
  "mcpServers": {
    "nds-mcp": {
      "command": "npx",
      "args": ["-y", "nds-mcp"],
      "env": {}
    }
  }
}
```

### VS Code (Copilot)

VS Code uses `.vscode/mcp.json` and a `servers` key:

```json
{
  "servers": {
    "nds-mcp": {
      "command": "npx",
      "args": ["-y", "nds-mcp"]
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.nds-mcp]
command = "npx"
args = ["-y", "nds-mcp"]
```

### OpenCode

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```json
{
  "mcp": {
    "nds-mcp": {
      "type": "local",
      "command": ["npx", "-y", "nds-mcp"],
      "enabled": true,
      "environment": {}
    }
  }
}
```

### Cherry Studio

Settings → MCP Server → Add server:

- Type: `STDIO`
- Command: `npx`
- Parameters: `-y nds-mcp`

### Generic stdio (manual)

```bash
npx -y nds-mcp
```

The server communicates over stdin/stdout (MCP protocol). Diagnostic messages go to stderr.

## Data Sources

| Source | Tables | Content |
|--------|--------|---------|
| AME2020 | `ame_masses`, `ame_reactions` | Mass excess, binding energy, separation energies, Q-values |
| NUBASE2020 | `nubase` | Half-life, spin/parity, decay modes, isomers |
| IAEA (Angeli & Marinova 2013) | `charge_radii` | RMS charge radii |
| Li et al. 2021 | `laser_radii`, `laser_radii_refs` | Laser spectroscopy charge radii with per-isotope references |
| ENSDF | `ensdf_levels`, `ensdf_gammas`, `ensdf_decay_feedings`, `ensdf_datasets`, `ensdf_references` | Nuclear structure: levels, gamma transitions, decay feedings |
| TUNL | `tunl_levels` | Light nuclei (A=3–20) energy levels, resonance widths, isospin, decay modes (59 nuclides, 2512 levels) |
| JENDL-5 Decay *(optional, `jendl5.sqlite`)* | `jendl5_decays`, `jendl5_decay_modes`, `jendl5_radiation` | Decay data + radiation spectra |
| JENDL-5 XS *(optional, `jendl5.sqlite`)* | `jendl5_xs_meta`, `jendl5_xs_points`, `jendl5_xs_interp` | Pointwise cross sections + ENDF-6 interpolation laws |
| EXFOR *(optional, `exfor.sqlite`)* | `exfor_entries`, `exfor_points` | Experimental data points (SIG/MACS/...) |
| CODATA 2022 | `codata_constants`, `codata_meta` | Fundamental constants (value/uncertainty/unit, exact/truncated flags) |

## Masses, Thresholds, and Near-Threshold Resonances (Important)

- `nds_get_mass` returns **AME atomic masses** (neutral atoms; electrons included). This is standard: many Q-values/threshold
  computations can be done directly with atomic masses because electron masses largely cancel for reactions with the same total Z.
- If you need **nuclear masses**, convert via `M_nuc = M_atom - Z*m_e + B_e/c^2` (electron binding energies `B_e` are eV-scale for
  light nuclei; include them only if you need sub-keV precision).
- For **unbound nuclei / broad resonances** (e.g. `5He`, `5Li`), a single real-number “ground-state energy/mass” depends on the
  *resonance-parameter convention* (S-matrix pole vs eigenphase centroid vs cross-section peak). Mixing AME masses with level
  energies from ENSDF/TUNL/evaluations can yield O(10–100 keV) shifts and even “threshold-above vs threshold-below” sign flips.
  When doing threshold comparisons for such systems, use a single self-consistent evaluation/convention.

## Tools

| Tool | Description |
|------|-------------|
| `nds_info` | Database metadata: data versions, nuclide counts, file hash, optional DB status, and build/source metadata |
| `nds_check_update` | Check npm registry for newer `nds-mcp` version (read-only; no update performed) |
| `nds_self_update` | Update `nds-mcp` from npm (`confirm=true` required; `full` mode only) |
| `nds_find_nuclide` | Find nuclides by element, Z, and/or A (NUBASE2020) |
| `nds_get_mass` | Atomic mass data: mass excess, binding energy/A, atomic mass (AME2020) |
| `nds_get_separation_energy` | Nucleon separation energies: Sn, Sp, S2n, S2p (AME2020) |
| `nds_get_q_value` | Reaction Q-values: Qa, Q2bm, Qep, Qbn, etc. (AME2020) |
| `nds_get_decay` | Decay info: half-life, spin/parity, decay modes (NUBASE2020) |
| `nds_get_charge_radius` | Nuclear charge radii with cross-source comparison (`mode=best|all|compare`) |
| `nds_search` | Search nuclides by property range (half-life, mass excess) |
| `nds_query_levels` | Nuclear energy levels from ENSDF + TUNL (auto-merged for A ≤ 20, with `source` discriminator) |
| `nds_query_gammas` | Gamma-ray transitions from ENSDF |
| `nds_query_decay_feedings` | Beta/EC decay feeding patterns from ENSDF |
| `nds_lookup_reference` | ENSDF/NSR bibliographic references |
| `nds_get_radiation_spectrum` | JENDL-5 decay radiation spectra (discrete lines + continuous summaries) |
| `nds_list_available_targets` | List available JENDL-5 XS targets (A/state) for a given Z/projectile |
| `nds_get_reaction_info` | List available JENDL-5 reaction channels for one target (mt/reaction/e-range/point-count) |
| `nds_get_cross_section_table` | JENDL-5 cross-section tables (`mode=raw|sampled`) |
| `nds_interpolate_cross_section` | ENDF-6 NBT/INT interpolation at one incident energy |
| `nds_search_exfor` | Search EXFOR data points (supports `quantity=SIG|MACS|...`) |
| `nds_get_exfor_entry` | Load full EXFOR entry payload by `entry_id` |
| `nds_get_constant` | Get one CODATA fundamental constant by name |
| `nds_list_constants` | List CODATA constants with filter and pagination |

## Cross-Source Rule

For the same physical observable that exists in multiple sources/databases, tools return source-tagged values from each source by default. Any `recommended` / `best` value is an additional field and does not replace or hide other source values.

## Example: Charge Radii (new source-tagged output)

Use `mode=compare` to get all source-tagged values plus an explicit comparison summary:

```json
[
  {
    "Z": 4,
    "A": 10,
    "mode": "compare",
    "source_values": [
      {
        "source_name": "Li et al. laser spectroscopy",
        "value_fm": 2.355,
        "uncertainty_fm": 0.017,
        "unit": "fm"
      },
      {
        "source_name": "IAEA charge radii",
        "value_fm": 2.355,
        "uncertainty_fm": 0.017,
        "unit": "fm"
      }
    ],
    "recommended_source": "Li et al. laser spectroscopy",
    "recommended_r_charge_fm": 2.355,
    "recommended_r_charge_unc_fm": 0.017,
    "max_source_diff_fm": 0
  }
]
```

This reflects the current cross-source contract: return source-tagged values by default, and keep `recommended`/`best` as an additional field.

## Example: JENDL-5 Pb-208 `n,gamma`

Raw points table:

```json
{
  "tool": "nds_get_cross_section_table",
  "args": {
    "Z": 82,
    "A": 208,
    "projectile": "n",
    "mt": 102,
    "mode": "raw",
    "limit": 20
  }
}
```

Single-energy interpolation:

```json
{
  "tool": "nds_interpolate_cross_section",
  "args": {
    "Z": 82,
    "A": 208,
    "projectile": "n",
    "mt": 102,
    "energy_eV": 0.0253
  }
}
```

Optional clamped interpolation (instead of out-of-range error):

```json
{
  "tool": "nds_interpolate_cross_section",
  "args": {
    "Z": 82,
    "A": 208,
    "projectile": "n",
    "mt": 102,
    "energy_eV": 1000000000000,
    "on_out_of_range": "clamp"
  }
}
```

Reaction channel discovery for one target:

```json
{
  "tool": "nds_get_reaction_info",
  "args": {
    "Z": 82,
    "A": 208,
    "state": 0,
    "projectile": "n"
  }
}
```

If requested `mt`/`reaction` is absent for the nuclide, the server returns `INVALID_PARAMS` with `available_mts` and `available_reactions`.
If `Z` exists but requested `A/state` has no XS rows, server returns `INVALID_PARAMS` with `available_targets` (instead of generic not-found).
For common naming confusion (e.g., Li-6 `n,a` vs ENDF/JENDL `n,t` MT=105), error payload may include `suggested_reaction`.
`nds_interpolate_cross_section` defaults to `on_out_of_range="error"` (current behavior). With `on_out_of_range="clamp"`, response includes `clamped`, `requested_energy_eV`, `effective_energy_eV`, `tabulated_e_min_eV`, and `tabulated_e_max_eV`.
For `nds_search_exfor` INVALID_PARAMS, payload includes structured guidance: parameter dependency/mutual-exclusion rules, copyable example calls, and `available_for_Z` overview (`projectiles`/`quantities`/`A_values`) when available.
Cross-section responses include explicit context fields: `energy_unit="eV"`, `cross_section_unit="b"`, `jendl5_xs_version`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NDS_DB_PATH` | `~/.nds-mcp/nds.sqlite` | Database path. Set to skip auto-download. |
| `NDS_JENDL5_DB_PATH` | `~/.nds-mcp/jendl5.sqlite` | Optional JENDL-5 DB path (Phase 2a/2b tools). |
| `NDS_JENDL5_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `jendl5.sqlite`. |
| `NDS_EXFOR_DB_PATH` | `~/.nds-mcp/exfor.sqlite` | Optional EXFOR DB path (Phase 2c tools). |
| `NDS_EXFOR_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `exfor.sqlite`. |
| `NDS_DB_DOWNLOAD_URL` | GitHub Releases latest | Custom download URL for the SQLite file. |
| `NDS_TOOL_MODE` | `standard` | Set to `full` to expose all tools. |

## Building the Database from Source

Maintainer-only: MCP clients never call these commands.

See `RUNBOOK.md` (repo only) for full SOP and raw input requirements. Minimal JENDL-5 build:

```bash
# Decay sublibrary
scripts/download-jendl5-dec.sh ~/.nds-mcp/raw/jendl5-dec_upd5.tar.gz
pnpm run ingest:jendl5-dec -- --source ~/.nds-mcp/raw/jendl5-dec_upd5.tar.gz --output ~/.nds-mcp/jendl5.sqlite

# Neutron pointwise XS sublibrary (300K, full archive)
scripts/download-jendl5-xs.sh ~/.nds-mcp/raw/jendl5-n-300K.tar.gz
pnpm run ingest:jendl5-xs -- --source ~/.nds-mcp/raw/jendl5-n-300K.tar.gz --output ~/.nds-mcp/jendl5.sqlite
```

`--jendl5-xs` accepts tar/tgz, extracted directory, single ENDF text file (`.dat` / `.endf` / `.txt`, including `.gz`), and json/jsonl sources.

Release upload flow for optional DBs:

```bash
scripts/check-db.sh --only main,jendl5
scripts/release-phase2-dbs.sh --tag <tag> --repo fkguo/nds-mcp --jendl5 ~/.nds-mcp/jendl5.sqlite
```

Rule: build sqlite first, verify it locally, then upload release asset.

## License

MIT
