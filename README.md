# nds-mcp

Nuclear Data Services MCP server — offline SQLite-backed nuclear physics data for AI agents.

Provides 20 tools covering atomic masses (AME2020), nuclear properties (NUBASE2020), charge radii (IAEA + laser spectroscopy), energy levels and gamma transitions (ENSDF), light nuclei resonance data (TUNL, A=3–20), bibliographic references, JENDL-5 decay/cross-section data, EXFOR experimental data, DDEP decay data, and CODATA fundamental constants.

## Quick Start

```bash
npx -y nds-mcp
```

The pre-built SQLite database (~85 MB) is automatically downloaded to `~/.nds-mcp/nds.sqlite` on first launch.
By default it downloads from this repo's GitHub Releases (override via `NDS_DB_DOWNLOAD_URL`).

Optional tools `JENDL-5` / `EXFOR` / `DDEP` use separate SQLite files and are auto-downloaded on demand.
`CODATA` is bundled inside `nds.sqlite`.

## Databases

| SQLite file | Default path | Download behavior | Includes |
|-------------|--------------|-------------------|----------|
| `nds.sqlite` | `~/.nds-mcp/nds.sqlite` | Auto-download on server startup *(required)* | AME2020 masses + reaction Q-values; NUBASE2020 nuclear properties; charge radii (IAEA + Li2021 laser spectroscopy); ENSDF (levels, gammas, decay feedings, references); TUNL light-nuclei resonance/level data (A=3–20); CODATA fundamental constants |
| `jendl5.sqlite` *(optional)* | `~/.nds-mcp/jendl5.sqlite` | Auto-download on first call to JENDL-5 tools | JENDL-5 decay data + radiation spectra; JENDL-5 pointwise cross sections + ENDF-6 interpolation laws |
| `exfor.sqlite` *(optional)* | `~/.nds-mcp/exfor.sqlite` | Auto-download on first call to EXFOR tools | EXFOR experimental data points (SIG/MACS/...) + per-entry metadata |
| `ddep.sqlite` *(optional)* | `~/.nds-mcp/ddep.sqlite` | Auto-download on first call to DDEP tools | DDEP evaluated decay half-lives + key radiation lines (energy/intensity) |

You can always bring your own files by setting `NDS_DB_PATH` / `NDS_JENDL5_DB_PATH` / `NDS_EXFOR_DB_PATH` / `NDS_DDEP_DB_PATH`.

### Optional DB auto-download trigger

- `jendl5.sqlite` is downloaded when calling `nds_get_radiation_spectrum`, `nds_get_cross_section_table`, or `nds_interpolate_cross_section`.
- `exfor.sqlite` is downloaded when calling `nds_search_exfor` or `nds_get_exfor_entry`.
- `ddep.sqlite` is downloaded when calling `nds_get_ddep_decay`.
- These optional SQLite assets are published on this repo's GitHub Releases page (latest release assets).

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
| DDEP *(optional, `ddep.sqlite`)* | `ddep_meta`, `ddep_nuclides`, `ddep_radiation` | Evaluated radionuclide half-lives + key emission lines |
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
| `nds_get_cross_section_table` | JENDL-5 cross-section tables (`mode=raw|sampled`) |
| `nds_interpolate_cross_section` | ENDF-6 NBT/INT interpolation at one incident energy |
| `nds_search_exfor` | Search EXFOR data points (supports `quantity=SIG|MACS|...`) |
| `nds_get_exfor_entry` | Load full EXFOR entry payload by `entry_id` |
| `nds_get_ddep_decay` | DDEP decay query: source-tagged half-life values + key radiation lines |
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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NDS_DB_PATH` | `~/.nds-mcp/nds.sqlite` | Database path. Set to skip auto-download. |
| `NDS_JENDL5_DB_PATH` | `~/.nds-mcp/jendl5.sqlite` | Optional JENDL-5 DB path (Phase 2a/2b tools). |
| `NDS_JENDL5_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `jendl5.sqlite`. |
| `NDS_EXFOR_DB_PATH` | `~/.nds-mcp/exfor.sqlite` | Optional EXFOR DB path (Phase 2c tools). |
| `NDS_EXFOR_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `exfor.sqlite`. |
| `NDS_DDEP_DB_PATH` | `~/.nds-mcp/ddep.sqlite` | Optional DDEP DB path (DDEP decay tool). |
| `NDS_DDEP_DB_DOWNLOAD_URL` | GitHub Releases latest | Override auto-download URL for `ddep.sqlite`. |
| `NDS_DB_DOWNLOAD_URL` | GitHub Releases latest | Custom download URL for the SQLite file. |
| `NDS_TOOL_MODE` | `standard` | Set to `full` to expose all tools. |

## Building the Database from Source

Maintainer-only: MCP clients never call these commands.

See `RUNBOOK.md` (repo only) for the build SOP and raw input requirements.

## License

MIT
