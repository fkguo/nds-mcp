# Next Steps (Maintainer/Agent)

This is a lightweight development plan for `nds-mcp` (not user-facing).

## Now (minimal, high-impact)

1) **Make Phase-2 DB releases real**
   - Upload `jendl5.sqlite` / `exfor.sqlite` assets to GitHub Releases so the on-demand auto-download paths work.
   - Done when: `ensureJendl5Db()` / `ensureExforDb()` succeeds from a clean `~/.nds-mcp/` on macOS/Linux.

2) **Preserve + standardize optional DB meta**
   - Ensure `jendl5_meta` / `exfor_meta` always contain upstream/source/version keys (not just `schema_version`/`built_at`).
   - When importing an existing EXFOR sqlite, copy `exfor_meta` if present (instead of overwriting with minimal keys).
   - Done when: `nds_info` consistently returns meaningful `jendl5_meta` / `exfor_meta` fields.

3) **Keep JENDL-5 XS full-build pipeline healthy**
   - Maintain direct ingest path from official JENDL-5 300K ENDF-6 archives (`.tar.gz` with `.dat.gz`) and equivalent extracted directories/single ENDF files.
   - Done when: maintainers can rebuild `jendl5.sqlite` (XS) from upstream archives without any hand-prepared JSON/JSONL conversion step.

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

- Build `ddep.sqlite` as optional DB.
- Add tools focused on decay observables not already covered by current JENDL path:
  half-life reference set, key gamma lines, emission intensities with metrology provenance.
- Add `ddep_meta` and expose in `nds_info`.

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
