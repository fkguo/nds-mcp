# nds-mcp

Nuclear Data Services MCP server — offline SQLite-backed nuclear physics data for AI agents.

Provides 17 tools covering atomic masses (AME2020), nuclear properties (NUBASE2020), charge radii (IAEA + laser spectroscopy), energy levels and gamma transitions (ENSDF), light nuclei resonance data (TUNL, A=3–20), bibliographic references, JENDL-5 decay/cross-section data, and EXFOR experimental data.

## Quick Start

```bash
npx -y nds-mcp
```

The pre-built SQLite database (~85 MB) is automatically downloaded to `~/.nds-mcp/nds.sqlite` on first launch.
By default it downloads from this repo's GitHub Releases (override via `NDS_DB_DOWNLOAD_URL`).

Optional Phase 2 tools (`JENDL-5` / `EXFOR`) use separate SQLite files and are auto-downloaded on demand.

## Databases

| SQLite file | Default path | Download behavior | Includes |
|-------------|--------------|-------------------|----------|
| `nds.sqlite` | `~/.nds-mcp/nds.sqlite` | Auto-download on server startup *(required)* | AME2020 masses + reaction Q-values; NUBASE2020 nuclear properties; charge radii (IAEA + Li2021 laser spectroscopy); ENSDF (levels, gammas, decay feedings, references); TUNL light-nuclei resonance/level data (A=3–20) |
| `jendl5.sqlite` *(optional)* | `~/.nds-mcp/jendl5.sqlite` | Auto-download on first call to JENDL-5 tools | JENDL-5 decay data + radiation spectra; JENDL-5 pointwise cross sections + ENDF-6 interpolation laws |
| `exfor.sqlite` *(optional)* | `~/.nds-mcp/exfor.sqlite` | Auto-download on first call to EXFOR tools | EXFOR experimental data points (SIG/MACS/...) + per-entry metadata |

You can always bring your own files by setting `NDS_DB_PATH` / `NDS_JENDL5_DB_PATH` / `NDS_EXFOR_DB_PATH`.

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
| `nds_get_charge_radius` | Nuclear charge radii with laser spectroscopy provenance |
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

## Example: Charge Radii from H to O-16

Query charge radii for light nuclei (Z = 1–8, A ≤ 16), with original measurement references where available from laser spectroscopy data:

| Nuclide | Z | A | r_charge (fm) | unc (fm) | Source | Reference |
|---------|---|---|:---:|:---:|--------|-----------|
| ¹H  | 1 | 1  | 0.8783 | 0.0086 | IAEA | — |
| ²H  | 1 | 2  | 2.1421 | 0.0088 | IAEA | — |
| ³H  | 1 | 3  | 1.7591 | 0.0363 | IAEA | — |
| ³He | 2 | 3  | 1.9661 | 0.0030 | IAEA | — |
| ⁴He | 2 | 4  | 1.6755 | 0.0028 | IAEA | — |
| ⁶He | 2 | 6  | 2.066  | 0.0111 | IAEA | — |
| ⁸He | 2 | 8  | 1.9239 | 0.0306 | IAEA | — |
| ⁶Li | 3 | 6  | 2.589  | 0.039  | IAEA | — |
| ⁷Li | 3 | 7  | 2.444  | 0.042  | IAEA | — |
| ⁸Li | 3 | 8  | 2.339  | 0.044  | IAEA | — |
| ⁹Li | 3 | 9  | 2.245  | 0.046  | IAEA | — |
| ¹¹Li| 3 | 11 | 2.482  | 0.043  | IAEA | — |
| ⁷Be | 4 | 7  | 2.646  | 0.016  | IAEA + Laser | Krieger et al., PRL 108 (2012) 142501 |
| ⁹Be | 4 | 9  | 2.519  | 0.012  | IAEA + Laser | Krieger et al., PRL 108 (2012) 142501 |
| ¹⁰Be | 4 | 10 | 2.355 | 0.017  | IAEA + Laser | Krieger et al., PRL 108 (2012) 142501 |
| ¹¹Be | 4 | 11 | 2.463 | 0.015  | IAEA + Laser | Krieger et al., PRL 108 (2012) 142501 |
| ¹²Be | 4 | 12 | 2.5031| 0.0157 | Laser only | Krieger et al., PRL 108 (2012) 142501 |
| ¹⁰B | 5 | 10 | 2.4277 | 0.0499 | IAEA | — |
| ¹¹B | 5 | 11 | 2.406  | 0.0294 | IAEA | — |
| ¹²C | 6 | 12 | 2.4702 | 0.0022 | IAEA | — |
| ¹³C | 6 | 13 | 2.4614 | 0.0034 | IAEA | — |
| ¹⁴C | 6 | 14 | 2.5025 | 0.0087 | IAEA | — |
| ¹⁴N | 7 | 14 | 2.5582 | 0.0070 | IAEA | — |
| ¹⁵N | 7 | 15 | 2.6058 | 0.0080 | IAEA | — |
| ¹⁶O | 8 | 16 | 2.6991 | 0.0052 | IAEA | — |

**Notes:**
- **IAEA** = Angeli & Marinova, At. Data Nucl. Data Tables 99 (2013) 69
- **Laser** = Li et al. 2021 compilation of laser spectroscopy charge radii, with per-isotope original measurement references
- Only **Be isotopes** in this range have laser spectroscopy data (all from Krieger et al. 2012)
- **¹²Be** has no IAEA entry; its radius comes exclusively from laser spectroscopy
- Short-lived halo nuclei (⁶He, ⁸He, ¹¹Li) have larger uncertainties from indirect methods

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

See `RUNBOOK.md` (repo only) for the build SOP and raw input requirements.

## License

MIT
