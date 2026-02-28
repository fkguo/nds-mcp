# nds-mcp

Nuclear Data Services MCP server — offline SQLite-backed nuclear physics data for AI agents.

Provides 12 tools covering atomic masses (AME2020), nuclear properties (NUBASE2020), charge radii (IAEA + laser spectroscopy), energy levels and gamma transitions (ENSDF), light nuclei resonance data (TUNL, A=3–20), and bibliographic references.

## Quick Start

```bash
npx nds-mcp
```

The pre-built SQLite database (~85 MB) is automatically downloaded to `~/.nds-mcp/nds.sqlite` on first launch. No manual setup required.

## Configuration

Most MCP clients use the same JSON format. The server runs via `npx` over stdio — no API key or network config needed.

### JSON config (Claude Desktop / Claude Code / Cursor / Cline / Cherry Studio / Chatbox ...)

Add the following to your client's MCP config file:

```json
{
  "mcpServers": {
    "nds-mcp": {
      "command": "npx",
      "args": ["nds-mcp"]
    }
  }
}
```

| Client | Config location |
|--------|-----------------|
| Claude Desktop | `claude_desktop_config.json` |
| Claude Code | `.mcp.json` (project) or `~/.claude/mcp.json` (global) |
| Cursor | Settings → MCP → + Add new MCP server |
| Cherry Studio | Settings → MCP Servers → + Add |
| Chatbox | Settings → MCP → + Add |

### VS Code (Copilot)

VS Code uses a slightly different key. Add to `.vscode/settings.json`:

```json
{
  "mcp": {
    "servers": {
      "nds-mcp": {
        "command": "npx",
        "args": ["nds-mcp"]
      }
    }
  }
}
```

### Codex CLI (OpenAI)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.nds-mcp]
command = "npx"
args = ["nds-mcp"]
```

### OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "nds-mcp": {
      "command": ["npx", "nds-mcp"],
      "type": "local"
    }
  }
}
```

### Generic stdio

```bash
npx nds-mcp
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

## Tools

| Tool | Description |
|------|-------------|
| `nds_info` | Database metadata: data versions, nuclide counts, file hash |
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
| `NDS_DB_DOWNLOAD_URL` | GitHub Releases latest | Custom download URL for the SQLite file. |
| `NDS_TOOL_MODE` | `standard` | Set to `full` to expose all tools. |

## Building the Database from Source

If you want to rebuild the database from raw data files:

```bash
pnpm run ingest -- --data-dir /path/to/raw --output /path/to/nds.sqlite
```

Raw data files needed in `--data-dir`:
- `mass_1.mas20` — AME2020 mass table
- `rct1.mas20`, `rct2_1.mas20` — AME2020 reaction energies
- `nubase_4.mas20` — NUBASE2020 nuclear properties
- `charge_radii.csv` — IAEA charge radii
- `laser_radii/Radii.tex` — Li et al. 2021 laser spectroscopy radii
- `ensdf/ensdf.001` ... `ensdf.294` — ENSDF data files
- `tunl/*.txt` — TUNL energy level tables (pdftotext output from nucldata.tunl.duke.edu)

Download AME/NUBASE from https://www-nds.iaea.org/amdc/.

## License

MIT
