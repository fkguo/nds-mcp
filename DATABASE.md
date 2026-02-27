# NDS-MCP Database Reference

> Schema reference, data conventions, and caveats for `nds.sqlite` — the offline
> nuclear data database used by `nds-mcp`.
>
> All statistics below reflect the build as of `build_date` in `nds_meta`.
> Per-source timestamps (`ensdf_build_date`, `laser_radii_build_date`) are
> recorded during incremental rebuilds; a full rebuild always sets `build_date`.
> Exact row counts may change on rebuild against newer upstream snapshots.

## Overview

| Data source | Version | Rows | Description |
|-------------|---------|------|-------------|
| AME2020 | AME2020 | 3,558 masses + 3,558 reaction Q-values | Atomic Mass Evaluation 2020 |
| NUBASE2020 | NUBASE2020 | 5,843 (incl. isomers) | Nuclear properties & decay modes |
| IAEA charge radii | IAEA-2024 | 957 | RMS nuclear charge radii |
| Li et al. 2021 | Li2021 | 257 radii, 351 citation links | Laser spectroscopy charge radii |
| ENSDF | ENSDF-2024 | 6,361 datasets, 233,659 levels, 389,371 gammas, 26,448 feedings, 48,836 references | Evaluated Nuclear Structure Data |

Database size: ~85 MB.

Coverage varies by source:

| Source | Z range | A range | Notes |
|--------|---------|---------|-------|
| AME / NUBASE | 0–118 | 1–295 | Includes free neutron (Z=0, A=1) |
| ENSDF | 1–118 | 1–295 | No neutron (Z=0) entry |
| Charge radii | 0–96 | 1–248 | Far fewer nuclides (957); includes neutron |
| Laser radii | 4–88 | 7–233 | 21 elements, 257 isotopes (Be through Ra) |

The `nds_meta` table stores version strings and row counts as key-value pairs.

---

## Table Reference

### `nds_meta`

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PK | Metadata key |
| `value` | TEXT NOT NULL | Value string |

Keys include `ame_version`, `nubase_version`, `ensdf_version`, `radii_version`,
`laser_radii_version`, `build_date`, `ensdf_build_date`, and `*_count` entries for each table.

---

### `ame_masses` — Atomic Mass Evaluation

Primary key: `(Z, A)`.

**Important:** These are **atomic** masses (neutral-atom, electrons included), not
nuclear masses. When computing nuclear Q-values, electron masses cancel for most
reactions, but **not** for beta-plus/EC or any reaction where the electron count
changes. See caveats below.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `Z` | INTEGER | — | Proton number |
| `A` | INTEGER | — | Mass number |
| `element` | TEXT | — | Element symbol, title-case (e.g. `He`, `Og`); neutron = `n` |
| `mass_excess_keV` | REAL | keV | Atomic mass excess, M - A (in u), converted to keV |
| `mass_excess_unc_keV` | REAL | keV | Uncertainty |
| `binding_energy_per_A_keV` | REAL | keV/A | Binding energy per nucleon |
| `binding_energy_per_A_unc_keV` | REAL | keV/A | Uncertainty |
| `beta_decay_energy_keV` | REAL | keV | Q(beta-minus) = M(Z,A) - M(Z+1,A) |
| `beta_decay_energy_unc_keV` | REAL | keV | Uncertainty |
| `atomic_mass_micro_u` | REAL | 10^-6 u | Atomic mass in micro-u |
| `atomic_mass_unc_micro_u` | REAL | 10^-6 u | Uncertainty |
| `is_estimated` | INTEGER | — | 1 = extrapolated from systematics, 0 = experimental |

**Caveats:**
- 1,230 of 3,558 rows (34.6%) have `is_estimated = 1`. These are extrapolations
  from mass-surface systematics, not direct measurements.
- All 3,558 rows have non-NULL `mass_excess_keV` (estimated values are included,
  not omitted).
- Includes the free neutron: Z=0, A=1, element=`n`.
- **`beta_decay_energy_keV` is Q(β⁻), defined as M_atom(Z,A) − M_atom(Z+1,A).**
  For beta-minus emitters this is positive. For proton-rich (EC/β⁺) nuclei,
  this value is **negative** — do not treat negative values as data errors.
  **However, negating this column does NOT give Q_EC.** The correct relations
  using atomic masses are:
  - Q_EC = M_atom(Z,A) − M_atom(Z−1,A) = `mass_excess_keV(Z,A) - mass_excess_keV(Z-1,A)`
  - Q(β⁺) = Q_EC − 2m_e c² ≈ Q_EC − 1022 keV
  To compute Q_EC from this database, look up both `ame_masses` rows for (Z,A)
  and (Z−1,A), then subtract their `mass_excess_keV` values.
- **Atomic masses vs. nuclear masses:** The `mass_excess_keV` and
  `atomic_mass_micro_u` columns include the electron mass and atomic binding
  energy. For most nuclear reactions, electron masses cancel. For beta-plus/EC
  calculations, the 2m_e correction above is needed.

---

### `ame_reactions` — Separation Energies & Q-Values

Primary key: `(Z, A)`.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `Z`, `A`, `element` | — | — | Same as `ame_masses` |
| `S2n_keV` / `S2n_unc_keV` | REAL | keV | Two-neutron separation energy |
| `S2p_keV` / `S2p_unc_keV` | REAL | keV | Two-proton separation energy |
| `Sn_keV` / `Sn_unc_keV` | REAL | keV | One-neutron separation energy |
| `Sp_keV` / `Sp_unc_keV` | REAL | keV | One-proton separation energy |
| `Qa_keV` / `Qa_unc_keV` | REAL | keV | Alpha-decay Q-value |
| `Q2bm_keV` / `Q2bm_unc_keV` | REAL | keV | Double beta-minus Q-value |
| `Qep_keV` / `Qep_unc_keV` | REAL | keV | Q(εp): Electron-capture proton Q-value (not Q_EC — see ame_masses caveats) |
| `Qbn_keV` / `Qbn_unc_keV` | REAL | keV | Beta-delayed neutron Q-value |
| `Q4bm_keV` / `Q4bm_unc_keV` | REAL | keV | Quadruple beta-minus Q-value |
| `Qda_keV` / `Qda_unc_keV` | REAL | keV | Deuteron-alpha Q-value |
| `Qpa_keV` / `Qpa_unc_keV` | REAL | keV | Proton-alpha Q-value |
| `Qna_keV` / `Qna_unc_keV` | REAL | keV | Neutron-alpha Q-value |

**Caveats:**
- **NULL means "not calculable"** — the neighboring nuclide mass is unknown or the
  reaction is undefined. NULL does **not** mean zero.
- **Negative values are physically meaningful.** A negative separation energy means
  the nuclide is unbound with respect to that emission; a negative Q-value means
  the reaction is endoergic. For example, `Qa_keV < 0` for light stable nuclei
  (alpha emission is endothermic) — do not filter these out as errors.
- Some columns are NULL at the drip lines (e.g. `Sn_keV` NULL for 118 proton-rich
  nuclides where the value is undefined or not evaluable).

---

### `nubase` — Nuclear Properties (NUBASE2020)

Primary key: `(Z, A, isomer_index)`.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `Z`, `A`, `element` | — | — | Same conventions as AME |
| `isomer_index` | INTEGER | — | 0 = ground state, 1–9 = isomers |
| `mass_excess_keV` | REAL | keV | Mass excess |
| `mass_excess_unc_keV` | REAL | keV | Uncertainty |
| `excitation_energy_keV` | REAL | keV | Isomer excitation energy (0 for ground state) |
| `half_life` | TEXT | — | Raw string: `"12.32 Y"`, `"stable"`, `"unknown"`, etc. |
| `half_life_seconds` | REAL | s | Parsed numeric half-life; NULL if unparseable or stable |
| `half_life_unc_seconds` | REAL | s | Uncertainty |
| `spin_parity` | TEXT | — | Raw J^pi string (see spin_parity conventions below) |
| `decay_modes` | TEXT | — | Semicolon-separated modes (see caveats) |
| `is_estimated` | INTEGER | — | 1 = mass/excitation values are extrapolated from systematics |

**Caveats:**
- **`is_estimated` applies to mass and excitation energy fields only.** It does NOT
  indicate whether spin_parity, half_life, or decay_modes are estimated. Those
  fields have their own uncertainty markers (`*`, `#` suffixes for spin_parity;
  `#` suffix in decay_modes values).
- 24% of rows have `is_estimated = 1`.
- Maximum `isomer_index` is 9 (Ta-177 has isomers up to index 9).
- `half_life` special values that do NOT convert to `half_life_seconds`:
  - `"stable"` (254 nuclides) — NULL in `half_life_seconds`
  - `"unknown"` (341) — NULL
  - `"p-unst"` (3) — proton-unstable, no measurable lifetime, NULL
  - Strings with `>` or `<` prefixes (94 total) — lower/upper bounds, NULL
- `spin_parity` embeds extra annotations:
  - `*` suffix (1,063 cases): value from systematics, not measured
  - `#` suffix (966 cases): value from Hartree-Fock-Bogolyubov calculations
  - `T=N` annotation (192 cases): isospin quantum number, e.g. `"0+      T=1"`
  - `frg` annotation (14 cases): broad resonance/fragment state
- **`decay_modes` is not exclusively decay information.** The field also contains:
  - `IS=...` — natural isotopic abundance (e.g. `"IS=0.20 1;B-=100"`). An AI
    agent should not treat `IS` entries as a decay branch.
  - `?` — unknown decay mode
  - `#` suffix on values — estimated branching ratios
  - Format: `"B-=100"`, `"B-=100;B-n=25 10"` (mode=branching%;
    space-separated uncertainty).
- **Branching ratios can exceed 100% in total.** Modes like `B-n` (beta-delayed
  neutron), `B-2n`, `B-a` (beta-delayed alpha) are **sub-branches** of the primary
  `B-` mode. Their percentages are already included in the primary branch — do NOT
  sum them. Example: `"B-=100;B-n=25 10"` means 100% beta-minus, of which 25%
  is followed by neutron emission.

---

### `charge_radii` — Nuclear RMS Charge Radii (IAEA-2024)

Primary key: `(Z, A)`.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `Z`, `A`, `element` | — | — | Same conventions; includes neutron (Z=0, A=1) |
| `r_charge_fm` | REAL | fm | RMS charge radius sqrt(⟨r^2⟩) |
| `r_charge_unc_fm` | REAL | fm | Uncertainty |
| `r_charge_preliminary_fm` | REAL | fm | Preliminary (unpublished) RMS charge radius |
| `r_charge_preliminary_unc_fm` | REAL | fm | Uncertainty |

**Caveats:**
- **These are RMS charge radii**, defined as sqrt(⟨r^2⟩) where ⟨r^2⟩ is the
  mean-square charge radius. Values are always positive for nuclei (Z >= 1).
- **Neutron special case (Z=0, A=1):** The neutron has no net charge but has a
  non-zero charge distribution. The stored value is the **mean-square charge
  radius ⟨r^2⟩** (in fm^2, not fm), which is **negative** (~-0.1149 fm^2). This
  is physically correct: the negative sign reflects the spatial distribution of
  the neutron's internal charge. Do not treat this as an error or as a regular
  radius value.
- **Ground-state only.** This table stores adopted ground-state charge radii.
  Isomer-specific charge radii and isomer shifts are not represented.
- 48 nuclides have `r_charge_fm = NULL` but `r_charge_preliminary_fm` non-NULL.
  These are recently measured exotic isotopes not yet in the main compilation
  (e.g. Be-12, Mg-21 through Mg-32).
- No row has both values NULL.
- To get the best available radius:
  `COALESCE(r_charge_fm, r_charge_preliminary_fm)`.
- Coverage: Z = 0–96, A = 1–248 (957 entries — far fewer than AME/NUBASE).

---

### `laser_radii` — Laser Spectroscopy Charge Radii (Li et al. 2021)

Primary key: `(Z, A)`.

Source: Li, Wang, et al., Atomic Data and Nuclear Data Tables 140 (2021) 101440.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `Z` | INTEGER | — | Proton number |
| `A` | INTEGER | — | Mass number |
| `N` | INTEGER | — | Neutron number |
| `element` | TEXT | — | Element symbol (title-case) |
| `delta_r2_fm2` | REAL | fm² | δ⟨r²⟩ = ⟨r²⟩_A - ⟨r²⟩_ref — mean-square charge radius difference relative to reference isotope |
| `delta_r2_unc_fm2` | REAL | fm² | Uncertainty (quadrature of statistical + systematic); NULL for reference isotopes |
| `r_charge_fm` | REAL | fm | Absolute RMS charge radius r_c = sqrt(r_ref² + δ⟨r²⟩), where r_ref is the reference isotope's charge radius |
| `r_charge_unc_fm` | REAL | fm | Uncertainty |
| `is_reference` | INTEGER | — | 1 = reference isotope for this element (δ⟨r²⟩ ≡ 0) |
| `in_angeli_2013` | INTEGER | — | 1 = this measurement was included in Angeli & Marinova 2013 compilation |
| `ref_A` | INTEGER | — | Mass number of the reference isotope for this element |

**Caveats:**
- **δ⟨r²⟩ is relative to a per-element reference isotope**, identified by `ref_A`. For example,
  all Be isotopes use Be-9 as reference (ref_A=9), so Be-9 has `delta_r2_fm2 = 0` and
  `delta_r2_unc_fm2 = NULL`.
- **21 reference isotopes** (one per element): Be-9, Mg-26, K-39, Ca-40, Mn-55, Fe-54,
  Ni-60, Cu-65, Zn-68, Ga-71, Rb-87, Ag-109, Cd-114, Sn-124, Yb-176, Hg-198, Tl-205,
  Bi-209, Po-210, Fr-221, Ra-214.
- **130 of 257 isotopes are new** (not in Angeli 2013): `in_angeli_2013 = 0`.
- **`r_charge_fm` here may differ slightly from `charge_radii.r_charge_fm`** for the same
  (Z,A) — they come from different compilations with different evaluation methods.
- The `NDS_GET_CHARGE_RADIUS` tool merges both tables: each result includes a
  `laser_spectroscopy` field (null if no laser data exists for that isotope).

---

### `laser_radii_refs` — Laser Radii Citations

Primary key: `(Z, A, citekey)`. Foreign key: `(Z, A)` references `laser_radii`.

| Column | Type | Description |
|--------|------|-------------|
| `Z` | INTEGER | Proton number |
| `A` | INTEGER | Mass number |
| `citekey` | TEXT | Citation key from Li et al. 2021 (e.g. `c4Be`, `c29Cu1`) |
| `reference` | TEXT | Full bibliographic reference string |

**Caveats:**
- Most isotopes have 1 citation; some have 2 (e.g. Cu isotopes have `c29Cu1` and `c29Cu2`
  for different mass ranges).
- All isotopes of the same element share the same citation(s). Note: in the
  original Li et al. 2021 paper, citations refer to the newly measured isotopic
  chains; the ingest script broadcasts each element's citation(s) to all its
  isotopes (including those already in Angeli 2013) for SQL query convenience.
- 27 distinct experimental citation keys covering 21 elements.

---

### `ensdf_references` — ENSDF Bibliography

Primary key: `(A, keynumber)`.

| Column | Type | Description |
|--------|------|-------------|
| `A` | INTEGER | Mass number this reference is filed under |
| `keynumber` | TEXT | ENSDF keynumber, format `YYYYAAnn` (e.g. `2012WA38`) |
| `type` | TEXT | Publication type: `JOUR`, `CONF`, `THES`, `REPT`, `PC`, `PREP`, etc. |
| `reference` | TEXT | Free-text reference string using NSR/ENSDF journal abbreviation codes |

**Caveats:**
- Keynumbers are **scoped to mass number A**. The same keynumber string (e.g.
  `2012WA38`) may appear for multiple A values — the primary key is `(A, keynumber)`,
  not `keynumber` alone. These rows refer to the same physical publication.
- 89.5% are `JOUR` (journal articles). Other types include `CONF`, `THES`,
  `REPT`, `PREP`, `BOOK`, and private communications.
- **Private communication types start with `PC`** but include letter suffixes:
  `PC A`, `PC B`, ..., `PC Y`, `PC (`. Filtering on `type = 'PC'` will return
  zero rows — use `type LIKE 'PC%'` instead.
- The `reference` field uses NSR/ENSDF journal abbreviation codes (e.g.
  `PRLAA 115 483`), not standard journal names. A mapping of these codes to
  full journal names is not stored in the database.
- A few variant type codes exist (`JOYR`, `JUOU`) — apparent typos in upstream
  ENSDF data, functionally equivalent to `JOUR`.
- **No per-level or per-gamma reference mapping exists.** `ensdf_datasets.qref_keynumbers`
  links only Q-record references (Q-value provenance); complete dataset-level or
  gamma-level provenance mapping is not present. Individual levels and gamma
  transitions do not have provenance links to specific publications.

---

### `ensdf_datasets` — ENSDF Dataset Index

Primary key: `dataset_id` (AUTOINCREMENT).

| Column | Type | Description |
|--------|------|-------------|
| `dataset_id` | INTEGER PK | Auto-incrementing ID (not stable across rebuilds) |
| `Z` | INTEGER | Proton number |
| `A` | INTEGER | Mass number |
| `element` | TEXT | Element symbol (title-case) |
| `dataset_type` | TEXT | Classified type (see below) |
| `dsid` | TEXT | Original ENSDF DSID string (e.g. `"60CO B- DECAY (5.2714 Y)"`) |
| `parent_z` | INTEGER | Parent Z (decay datasets only) |
| `parent_a` | INTEGER | Parent A (decay datasets only) |
| `parent_element` | TEXT | Parent element (decay datasets only) |
| `parent_half_life` | TEXT | Parent half-life string (decay datasets only) |
| `qref_keynumbers` | TEXT | Q-value reference keynumbers (JSON array string) |
| `qref_raw` | TEXT | Raw Q-record text |

**Dataset types present in this build:**

| `dataset_type` | Count | Has gammas? | Has feedings? |
|----------------|-------|-------------|---------------|
| `ADOPTED LEVELS, GAMMAS` | 2,290 | Yes | No |
| `ADOPTED LEVELS` | 1,147 | No | No |
| `B- DECAY` | 1,151 | Sometimes | Yes |
| `EC DECAY` | 1,171 | Sometimes | Yes |
| `EC+B+ DECAY` | 14 | Sometimes | Yes |
| `IT DECAY` | 588 | Sometimes | No |

**Caveats:**
- **Adopted levels datasets are always included.** Among decay datasets, only
  B-/EC/EC+B+/IT decays are present. Alpha decay, spontaneous fission, proton/
  neutron emission, heavy-ion reactions, Coulomb excitation, and all other
  reaction-type datasets are **not** in this build. Users querying decay data for
  heavy nuclei (Z > ~80) will find no alpha-decay feeding information.
- `parent_z`/`parent_a`/`parent_element`/`parent_half_life` are NULL for adopted-levels
  datasets (they have no parent nucleus).
- **Parent isomer identity is not directly encoded.** Decay datasets for metastable
  parent states (e.g. Ag-110m vs. Ag-110 g.s.) share the same `parent_z`/`parent_a`
  values. To distinguish them, use `dsid` (which encodes the parent state explicitly,
  e.g. `"110AG IT DECAY (249.83 D)"`) or `parent_half_life`.
- **`qref_keynumbers` is a JSON array string** (e.g. `'["2012WA38","2003AU03"]'`),
  not a plain keynumber. Use `json_each()` or string search to extract values:
  ```sql
  SELECT * FROM ensdf_datasets WHERE qref_keynumbers LIKE '%2012WA38%';
  ```
- Every nuclide in the database has at least one `ADOPTED LEVELS` or
  `ADOPTED LEVELS, GAMMAS` dataset.

---

### `ensdf_levels` — Nuclear Energy Levels

Primary key: `level_id` (AUTOINCREMENT). Foreign key: `dataset_id` references
`ensdf_datasets`.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `level_id` | INTEGER PK | — | Auto-incrementing ID (not stable across rebuilds) |
| `dataset_id` | INTEGER FK | — | Parent dataset |
| `Z`, `A`, `element` | — | — | Nuclide identifiers |
| `energy_keV` | REAL | keV | Level energy (numeric part only — see caveats) |
| `energy_raw` | TEXT | — | Original ENSDF energy string (preserves symbolic offsets) |
| `energy_unc_keV` | REAL | keV | Energy uncertainty; NULL may mean non-numeric code (see caveats) |
| `spin_parity` | TEXT | — | J^pi assignment (see spin_parity conventions below) |
| `half_life` | TEXT | — | Raw half-life string |
| `half_life_seconds` | REAL | s | Parsed numeric half-life |
| `half_life_unc_seconds` | REAL | s | Uncertainty |
| `isomer_flag` | TEXT | — | Isomer designation (see below) |
| `questionable` | INTEGER | — | 1 = level existence is questionable |
| `comment_flag` | TEXT | — | Comment/XREF flag from ENSDF record (see caveats) |

**Caveats:**

#### Levels are duplicated across datasets

The same physical level appears in **both** the adopted-levels dataset and in any
decay datasets that populate it. Queries by `(Z, A)` alone will return duplicates
with potentially inconsistent energies, J^pi, and intensities. **Always filter by
`dataset_type`** unless intentional:
```sql
-- Canonical adopted levels only:
SELECT * FROM ensdf_levels l
JOIN ensdf_datasets d ON l.dataset_id = d.dataset_id
WHERE d.Z = 28 AND d.A = 60
  AND d.dataset_type IN ('ADOPTED LEVELS', 'ADOPTED LEVELS, GAMMAS');
```

#### Symbolic energy offsets (~6.4% of levels)

14,888 levels have energy strings like `1234.5+X`, `567.8+Y`, `0+W`, etc. The
variable (`+X`, `+Y`, `+Z`, `+W`, `+V`) represents an unknown band-head energy.
`energy_keV` stores **only the numeric coefficient** — the offset is lost.

Additionally, ~114 levels use `+S` (neutron separation energy), `+P` (proton
separation energy), or `+Q` offsets for resonance states above particle threshold.
For example, `0+S` means "energy equals Sn"; `energy_keV` stores 0.0 which is
semantically incorrect without the Sn offset.

**These are not absolute energies.** To detect them:
```sql
SELECT * FROM ensdf_levels
WHERE energy_raw LIKE '%+X%' OR energy_raw LIKE '%+Y%'
   OR energy_raw LIKE '%+Z%' OR energy_raw LIKE '%+W%'
   OR energy_raw LIKE '%+V%' OR energy_raw LIKE '%+S%'
   OR energy_raw LIKE '%+P%' OR energy_raw LIKE '%+Q%';
```

Variable usage: `+X` (9,334 levels), `+Y` (3,369), `+Z` (1,370), `+V` (476),
`+W` (339), `+S`/`+P`/`+Q` (~114 combined).

#### STABLE levels

541 levels have `half_life = 'STABLE'` with `half_life_seconds = NULL`. Do not
treat NULL as "unknown" — filter explicitly:
```sql
-- Stable ground states:
SELECT * FROM ensdf_levels WHERE half_life = 'STABLE';
-- Levels with unknown lifetime (truly unknown):
SELECT * FROM ensdf_levels WHERE half_life IS NULL AND energy_keV > 0;
```

**Sorting gotcha:** `ORDER BY half_life_seconds DESC` will push STABLE nuclei to
the end (SQLite sorts NULLs last by default). To include them at the top:
```sql
ORDER BY CASE WHEN half_life = 'STABLE' THEN 1e99 ELSE half_life_seconds END DESC
```

#### Half-life from resonance widths

For very short-lived resonance states, ENSDF gives the level width Gamma (in eV,
keV, or MeV) rather than a half-life. The parser converts these via
T_1/2 = ln(2) * hbar / Gamma. The resulting `half_life_seconds` values can be
extremely small (~10^-23 s) and the uncertainty propagation is approximate.

#### Half-life limits parsed as exact values

When the raw ENSDF `half_life` string contains limit qualifiers (e.g. `> 1.0 MS`,
`< 200 NS`, `GT`, `LT`, `GE`, `LE`, `AP`), the parser extracts the numeric value
and unit but **discards the qualifier**. The resulting `half_life_seconds` is
stored as an exact value. Always cross-check `half_life` (the raw string) if limit
awareness matters.

#### Extreme half-life values

- Longest: ~2.4 x 10^32 seconds (~7.7 x 10^24 years — Te isotopes)
- Shortest: ~1.8 x 10^-23 seconds (~18 zeptoseconds — nuclear resonances)

#### Uncertainty NULL semantics

A NULL `energy_unc_keV` (or any `*_unc_*` column) can mean either:
- Uncertainty is genuinely unknown/not measured, OR
- Uncertainty is encoded non-numerically in ENSDF (e.g. `AP` = approximate, `SY` =
  from systematics, `CA` = calculated, `LT`/`GT` = limits)

The non-numeric uncertainty qualifier is not separately stored. If distinguishing
these cases matters, consult the raw ENSDF files.

#### Questionable levels

7,513 levels (3.2%) have `questionable = 1`, meaning their existence is uncertain
in the ENSDF evaluation.

#### Comment flag

The `comment_flag` field stores ENSDF comment/XREF flags (e.g. `C`, `X`, `S`,
etc.). However, the **actual comment text** and cross-reference records are not
stored in the database. These flags are not human-interpretable without access to
the raw ENSDF files.

#### Isomer flags

| Flag | Count | Meaning |
|------|-------|---------|
| NULL | 231,510 | Ground state or no isomer designation |
| `M` | 1,068 | First isomer |
| `M1` | 643 | First isomer (alternate notation — equivalent to `M`) |
| `M2` | 300 | Second isomer |
| `M3` | 55 | Third isomer |
| `M4`–`M9` | 34 | Higher isomers (M9 only in Ta-177) |
| `R` | 47 | Resonance (not a true isomer) |
| `E` | 1 | Unique flag on Pd-105 at 3694 keV |
| `?` | 1 | Ambiguous isomer assignment |

Treat `M` and `M1` as equivalent when identifying first isomers.

---

### `ensdf_gammas` — Gamma-Ray Transitions

Primary key: `gamma_id` (AUTOINCREMENT). Foreign keys: `dataset_id`, `level_id`.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `gamma_id` | INTEGER PK | — | Auto-incrementing ID (not stable across rebuilds) |
| `dataset_id` | INTEGER FK | — | Parent dataset |
| `level_id` | INTEGER FK | — | **Initial** (de-exciting) level only |
| `Z`, `A`, `element` | — | — | Nuclide identifiers |
| `level_energy_keV` | REAL | keV | Energy of the initial level (denormalized) |
| `gamma_energy_keV` | REAL | keV | Gamma-ray energy |
| `gamma_energy_raw` | TEXT | — | Original ENSDF energy string |
| `gamma_energy_unc_keV` | REAL | keV | Energy uncertainty |
| `rel_intensity` | REAL | — | Relative intensity (dataset-scoped — see caveats) |
| `rel_intensity_unc` | REAL | — | Uncertainty |
| `total_intensity` | REAL | — | Total transition intensity TI = RI x (1+alpha_T), dataset-normalized |
| `total_intensity_unc` | REAL | — | Uncertainty |
| `multipolarity` | TEXT | — | Transition multipolarity (see below) |
| `mixing_ratio` | REAL | — | Multipole mixing ratio delta |
| `mixing_ratio_unc` | REAL | — | Uncertainty |
| `total_conv_coeff` | REAL | — | Total internal conversion coefficient alpha_T |
| `total_conv_coeff_unc` | REAL | — | Uncertainty |
| `comment_flag` | TEXT | — | Comment flag (text not stored — see ensdf_levels caveats) |
| `coin_flag` | TEXT | — | Coincidence flag (text not stored) |
| `questionable` | INTEGER | — | 1 = transition existence questionable |
| `be2w` | REAL | W.u. | Reduced transition probability B(E2) in Weisskopf units |
| `be2w_unc` | REAL | W.u. | Uncertainty |
| `bm1w` | REAL | W.u. | Reduced transition probability B(M1) in Weisskopf units |
| `bm1w_unc` | REAL | W.u. | Uncertainty |

**Caveats:**

#### No final (fed) level is stored

The `level_id` and `level_energy_keV` refer to the **initial** (de-exciting) level.
The **final** (fed) level is **not stored** — there is no `final_level_id` column.

To infer the final level, compute `level_energy_keV - gamma_energy_keV` and match
against `ensdf_levels.energy_keV` within a tolerance window. However, this is
approximate due to independent rounding in level and gamma energies, and fails for
levels with symbolic offsets. **Full level-scheme reconstruction requires
tolerance-based matching.**

#### Gammas are duplicated across datasets

Like levels, the same physical gamma transition appears in both adopted-levels and
decay datasets. Filter by `dataset_type` to avoid double-counting:
```sql
-- Adopted gammas only (canonical):
SELECT g.* FROM ensdf_gammas g
JOIN ensdf_datasets d ON g.dataset_id = d.dataset_id
WHERE d.Z = 28 AND d.A = 60 AND d.dataset_type = 'ADOPTED LEVELS, GAMMAS';
```

Relative intensities have **different normalization scales** between adopted and
decay datasets and cannot be mixed.

#### `rel_intensity` is NOT absolute

`rel_intensity` is normalized **within each dataset**. The strongest transition in
a dataset is typically set to 100.0, but this is not guaranteed. The normalization
factor differs between datasets — you **cannot** compare `rel_intensity` values
across different datasets.

36,866 gammas (9.5%) have `rel_intensity = NULL` — transition observed but
intensity not measured.

27 gammas have `rel_intensity = 0.0` — transition detected but too weak to
quantify.

The maximum `rel_intensity` value is 640,000 (Hf-176 ground-state transition) —
there is no fixed upper bound.

#### `total_intensity` is NOT absolute either

Despite its name, `total_intensity` is the ENSDF TI field: `RI x (1 + alpha_T)`
(photon + conversion electron intensity), still in the **same dataset-relative
normalization** as `rel_intensity`. It is NOT an absolute emission probability per
100 decays.

Converting to absolute intensity requires ENSDF normalization records (NR, NB, NT
multipliers from "N" records), which are **not ingested** into this database. This
is a known limitation: absolute photon emission probabilities cannot be computed
from this database alone.

Only 2,380 gammas (0.6%) have `total_intensity` populated.

#### Multipolarity encoding

65.9% of gammas have `multipolarity = NULL`. When present, it uses ENSDF notation:

| Notation | Meaning | Example |
|----------|---------|---------|
| `E2` | Pure electric quadrupole | |
| `M1` | Pure magnetic dipole | |
| `M1+E2` | Mixed, M1 dominant | |
| `M1(+E2)` | Predominantly M1, small E2 admixture | |
| `(E2)` | Uncertain assignment (parenthesized) | |
| `[E2]` | Weakly argued assignment (bracketed) | |
| `M1,E2` | Either M1 or E2 — ambiguous | |
| `D` | Dipole (L=1), E/M character unknown | |
| `Q` | Quadrupole (L=2), E/M character unknown | |
| `D+Q` | Mixed dipole+quadrupole, character unknown | |
| `E0` | Electric monopole (0+ -> 0+ transitions) | |

249 distinct multipolarity strings exist. Parsing multipolarity requires handling
parentheses, brackets, commas, and the `D`/`Q` shorthand.

#### 511 keV annihilation gammas

ENSDF decay datasets sometimes include 511 keV positron-annihilation gammas as
gamma records. These are **not** nuclear level transitions — they come from
beta-plus annihilation. There is no flag in the schema to distinguish them from
real nuclear transitions at or near 511 keV. Exercise caution when interpreting
gammas at exactly 511.0 keV in EC/EC+B+ decay datasets.

#### Field coverage summary

| Field | % non-NULL | Notes |
|-------|-----------|-------|
| `gamma_energy_keV` | 100% | Always present |
| `rel_intensity` | 90.5% | |
| `total_conv_coeff` | 22.7% | |
| `mixing_ratio` | 5.7% | 3,784 have ratio but no uncertainty |
| `be2w` | 1.7% | |
| `bm1w` | 0.8% | |
| `total_intensity` | 0.6% | NOT absolute — see above |

#### Energy range

0.008 keV to 31,958 keV. No symbolic offsets in gamma energies (unlike levels).
However, 31 `gamma_energy_raw` values use scientific notation (e.g. `2.44E+3`);
do not use the `+` character to detect symbolic offsets in gamma energies.

---

### `ensdf_decay_feedings` — Beta/EC Feeding Intensities

Primary key: `feeding_id` (AUTOINCREMENT). Foreign keys: `dataset_id`,
`daughter_level_id`.

| Column | Type | Unit | Description |
|--------|------|------|-------------|
| `feeding_id` | INTEGER PK | — | Auto-incrementing ID (not stable across rebuilds) |
| `dataset_id` | INTEGER FK | — | Parent decay dataset |
| `parent_Z`, `parent_A`, `parent_element` | — | — | Parent nuclide |
| `decay_mode` | TEXT | — | `B-`, `EC`, or `EC+B+` |
| `daughter_level_keV` | REAL | keV | Fed daughter level energy |
| `daughter_level_id` | INTEGER FK | — | Matched level within same decay dataset (nullable) |
| `ib_percent` | REAL | % | Beta intensity: beta-minus for B-, **beta-plus** for EC/EC+B+ |
| `ib_percent_unc` | REAL | % | Uncertainty |
| `ie_percent` | REAL | % | Electron-capture intensity (EC/EC+B+ decays only; NULL for B-) |
| `ie_percent_unc` | REAL | % | Uncertainty |
| `ti_percent` | REAL | % | Total transition intensity = ib + ie (EC/EC+B+ only; NULL for B-) |
| `ti_percent_unc` | REAL | % | Uncertainty |
| `log_ft` | REAL | — | Comparative half-life log ft |
| `log_ft_unc` | REAL | — | Uncertainty |
| `endpoint_keV` | REAL | keV | Beta endpoint energy |
| `endpoint_unc_keV` | REAL | keV | Uncertainty |
| `forbiddenness` | TEXT | — | Transition forbiddenness (see below) |
| `comment_flag` | TEXT | — | Comment flag |

**Caveats:**

#### Decay modes

| `decay_mode` | Count | Description |
|--------------|-------|-------------|
| `B-` | 13,091 | Beta-minus decay |
| `EC` | 13,040 | Electron capture (may include beta-plus component) |
| `EC+B+` | 317 | Explicitly flagged EC+beta-plus |

IT (isomeric transition) decay datasets exist but produce gammas, not feedings —
no `IT` entries appear in this table.

#### Intensity field semantics

The meaning of `ib_percent` changes with decay mode:
- **B- decays:** `ib_percent` = beta-minus (B-) intensity. `ie_percent` and
  `ti_percent` are always NULL.
- **EC / EC+B+ decays:** `ib_percent` = beta-plus (B+) intensity, `ie_percent` =
  electron-capture (EC) intensity, `ti_percent` = total = ib + ie. In some cases
  only `ti_percent` is given when the EC/B+ split was not separately measured.

#### Feeding intensities may not sum to 100%

Feeding intensities from ENSDF evaluations may not add up to 100% due to
unobserved weak branches, unmeasured ground-state feeding, or evaluation
conventions. Do not assume conservation — check the dataset's normalization
documentation in the original ENSDF files if precise totals are needed.

#### `daughter_level_id` scope

`daughter_level_id` references a level **within the same decay dataset**, not the
adopted-levels dataset. To cross-reference with adopted levels, match by energy
within a tolerance:
```sql
-- Find adopted level corresponding to a decay feeding:
SELECT al.* FROM ensdf_levels al
JOIN ensdf_datasets ad ON al.dataset_id = ad.dataset_id
WHERE ad.Z = <daughter_Z> AND ad.A = <daughter_A>
  AND ad.dataset_type IN ('ADOPTED LEVELS', 'ADOPTED LEVELS, GAMMAS')
  AND ABS(al.energy_keV - <daughter_level_keV>) < 1.0;
```

4 of 26,448 feedings (0.015%) have `daughter_level_id = NULL` — extremely rare
cases where the daughter level energy could not be matched to any level in the
decay dataset. Use `LEFT JOIN` when joining to `ensdf_levels`.

#### Intensity field sparsity

| Field | % non-NULL | Notes |
|-------|-----------|-------|
| `log_ft` | 93% | |
| `ib_percent` | 79% | B- intensity for B-; B+ intensity for EC |
| `ie_percent` | 46% | Only populated for EC/EC+B+ |
| `ti_percent` | 44% | Only populated for EC/EC+B+ |
| `endpoint_keV` | 2% | Very sparse |

#### Forbiddenness values

| Value | Meaning |
|-------|---------|
| NULL | **Not specified** (could be allowed or simply unassigned — do not assume allowed) |
| `1` | First forbidden |
| `1U` | First forbidden unique |
| `2` | Second forbidden |
| `2U` | Second forbidden unique |
| `3U` | Third forbidden unique |

934 feedings have an explicit forbiddenness assignment.

---

## Spin-Parity (`spin_parity`) Conventions

The `spin_parity` column in `ensdf_levels` (and `nubase`) is a **raw ENSDF
string**, not a clean enumeration. It encodes multiple levels of certainty.

### Coverage

- 23% of levels (53,534) have NULL or empty `spin_parity` — no assignment exists.
- Of the remaining 77%, roughly half carry uncertainty notation.

### Notation

| Pattern | Meaning | Example |
|---------|---------|---------|
| `J+` or `J-` | Firm assignment | `2+`, `3/2-` |
| `(J+)` | Uncertain (parenthesized) | `(2+)` |
| `[J+]` | Weakly argued | `[2+]` |
| `J1,J2` | Multiple candidates | `3/2+,5/2+` |
| `(J1,J2)` | Uncertain, multiple candidates | `(3/2+,5/2+)` |
| `(J1 TO J2)` | Range | `(3/2+ TO 7/2+)` |
| `(GE J)` | Lower bound | `(GE 6-)` |
| `(LE J)` | Upper bound | `(LE 3)` |
| `(J)+` | Spin uncertain, parity firm | `(2)+` |
| `J1+&J2-` | Ambiguous parity | `(0+&3-)` |

**Never use exact string equality for physics queries.** Use careful pattern
matching with word boundaries:
```sql
-- All levels with possible J=2+ assignment:
-- Note: naive '%2+%' would also match 12+, 20+, etc.
SELECT * FROM ensdf_levels
WHERE spin_parity = '2+'
   OR spin_parity LIKE '(2+)%'
   OR spin_parity LIKE '%,2+%'
   OR spin_parity LIKE '2+,%';
```

### NUBASE-specific annotations

In the `nubase` table, `spin_parity` may additionally contain:
- `*` suffix — value from nuclear systematics
- `#` suffix — value from HFB (Hartree-Fock-Bogolyubov) calculations
- `T=N` — isospin quantum number embedded in the string
- `frg` — broad resonance or fragment state

Strip these annotations before comparing J^pi values with ENSDF data.

---

## Element Symbol Conventions

All tables use **title-case** element symbols: `H`, `He`, `Li`, ..., `Og`.

One exception: the free neutron is stored as lowercase `n` (Z=0, A=1) in
`ame_masses`, `ame_reactions`, `nubase`, and `charge_radii`.

ENSDF tables start at Z=1 (hydrogen) — no neutron entry in ENSDF.

---

## Important Caveats and Gotchas

### 1. Gamma transitions belong to the DAUGHTER nucleus, not the parent

The famous "Cs-137 gamma at 661.657 keV" is actually a Ba-137 internal transition
(the isomeric transition Ba-137m -> Ba-137 g.s.). In ENSDF and in this database,
it is stored under **Z=56, A=137 (Ba-137)**, not Z=55, A=137 (Cs-137).

Similarly, the "Co-60 gammas at 1173/1332 keV" are Ni-60 transitions stored
under Z=28, A=60.

To find gammas associated with a specific decay, query the **daughter** nuclide's
adopted levels, or join through the decay dataset:
```sql
-- Gammas de-exciting levels fed by Co-60 beta decay:
SELECT g.* FROM ensdf_gammas g
JOIN ensdf_datasets d ON g.dataset_id = d.dataset_id
WHERE d.parent_z = 27 AND d.parent_a = 60 AND d.dataset_type = 'B- DECAY';
```

### 2. Alpha decay and reaction data is absent

This build includes adopted-levels datasets and B-/EC/EC+B+/IT decay datasets
only. Alpha decay, spontaneous fission, proton/neutron emission, heavy-ion
reactions, Coulomb excitation, and all other reaction-type datasets are **not
ingested**. For heavy and superheavy nuclei, this means:

- No alpha-particle energies
- No alpha-decay feeding intensities
- No alpha-decay branching ratios in ENSDF (though NUBASE `decay_modes` contains them)

### 3. Level energies with symbolic offsets are not absolute

6.4% of levels (14,888) have energies like `1234.5+X` where X is an unknown
band-head energy, plus ~114 levels with `+S`/`+P`/`+Q` threshold offsets.
`energy_keV` stores only the numeric coefficient. **These are relative energies,
not absolute.** See the ensdf_levels section for detection queries.

### 4. Relative intensities are not comparable across datasets

`rel_intensity` in `ensdf_gammas` is normalized per-dataset. A value of `100.0`
in one dataset and `100.0` in another do not imply equal absolute intensity.
The normalization factor is dataset-dependent and **not stored in the database**
(ENSDF normalization "N" records are not ingested).

### 5. STABLE vs. NULL half-life

In `ensdf_levels`:
- `half_life = 'STABLE'` (uppercase) and `half_life_seconds = NULL` -> genuinely stable
- `half_life IS NULL` and `half_life_seconds IS NULL` -> unknown or not applicable

In `nubase`:
- `half_life = 'stable'` (lowercase) and `half_life_seconds = NULL` -> genuinely stable
- `half_life = 'unknown'` -> unknown decay properties
- `half_life = 'p-unst'` -> proton-unstable, no measurable lifetime
- Strings with `>` or `<` prefixes -> lower/upper bounds, stored as-is

Do not conflate STABLE/stable with NULL. Stable nuclides are intentionally NULL in
`half_life_seconds` because infinity is not representable. **Note the case
difference: ENSDF uses uppercase `STABLE`, NUBASE uses lowercase `stable`.**

### 6. Estimated vs. measured data (AME/NUBASE)

AME: 34.6% of masses are extrapolated (`is_estimated = 1`). This flag applies to
mass excess and related mass quantities only.
NUBASE: 24% of entries have `is_estimated = 1`, applying to mass/excitation fields.
Spin/parity and decay mode estimation is marked separately (`*`, `#` suffixes).

For precision-critical calculations, always filter:
```sql
SELECT * FROM ame_masses WHERE is_estimated = 0;
```

### 7. Charge radii: use COALESCE for best coverage

48 nuclides have only preliminary radius measurements:
```sql
-- Exclude the neutron (Z=0, A=1) which stores ⟨r²⟩ in fm², not r in fm:
SELECT Z, A, element,
  COALESCE(r_charge_fm, r_charge_preliminary_fm) AS r_best,
  COALESCE(r_charge_unc_fm, r_charge_preliminary_unc_fm) AS r_unc
FROM charge_radii
WHERE NOT (Z = 0 AND A = 1);
```

### 8. Reference keynumbers are mass-scoped

The ENSDF reference keynumber (e.g. `2012WA38`) is NOT globally unique. The
primary key is `(A, keynumber)`. The same publication may appear under multiple
mass numbers. To find all references for a given keynumber:
```sql
SELECT * FROM ensdf_references WHERE keynumber = '2012WA38';
-- Returns rows for each A value that cites this reference.
```

### 9. Isomer flag ambiguity: M vs. M1

Both `M` and `M1` are used in `ensdf_levels.isomer_flag` to denote the first
isomeric state. When querying isomers:
```sql
SELECT * FROM ensdf_levels WHERE isomer_flag IN ('M', 'M1');
```

The `R` flag (47 levels) marks resonance states, not true isomers.

### 10. Foreign key integrity

All foreign keys are valid in this build:
- 100% of gammas have valid `level_id` and `dataset_id`
- 99.985% of feedings have valid `daughter_level_id` (4 are NULL — unresolved matches)
- Use `LEFT JOIN` when joining feedings to levels to avoid losing these 4 rows

### 11. AUTOINCREMENT IDs are not stable across rebuilds

All `*_id` columns (`dataset_id`, `level_id`, `gamma_id`, `feeding_id`) are
AUTOINCREMENT and depend on insertion order. They will change if the database is
rebuilt. Do not persist these IDs externally. No guaranteed unique stable natural
key exists for ENSDF row-level entities (energy doublets, symbolic offsets, and
multiple datasets per nuclide preclude simple composite keys). If external
persistence is required, store a content fingerprint including `dsid` and raw
fields (e.g. `energy_raw`, `gamma_energy_raw`) plus `build_date` from `nds_meta`.

### 12. Levels and gammas are duplicated across datasets

The same physical level or gamma transition appears in both adopted-levels and
decay datasets. Queries by `(Z, A)` alone will double-count and may mix
inconsistent J^pi assignments or intensity scales. Always filter by `dataset_type`.

### 13. No absolute gamma intensity without external normalization

ENSDF normalization records ("N" records containing NR, NB, NT, NP multipliers)
are not ingested. Neither `rel_intensity` nor `total_intensity` in `ensdf_gammas`
are absolute emission probabilities. To compute absolute intensities (photons per
100 decays), the normalization factors from the raw ENSDF files are required.

### 14. Q(β⁻) is negative for proton-rich nuclei — but negating it does NOT give Q_EC

`ame_masses.beta_decay_energy_keV` is Q(β⁻) = M_atom(Z,A) − M_atom(Z+1,A). This
is negative for proton-rich nuclei where EC/β⁺ is the actual decay mode. However,
**−Q(β⁻) ≠ Q_EC**. To compute Q_EC, use:
`Q_EC = mass_excess_keV(Z,A) - mass_excess_keV(Z-1,A)` (two row lookups required).
See the `ame_masses` caveats for the full derivation.

---

## Indexes

The following indexes exist for efficient querying:

| Index | Table | Columns |
|-------|-------|---------|
| `idx_ame_masses_element` | ame_masses | element |
| `idx_ame_reactions_element` | ame_reactions | element |
| `idx_nubase_element` | nubase | element |
| `idx_nubase_half_life` | nubase | half_life_seconds |
| `idx_nubase_mass_excess` | nubase | mass_excess_keV |
| `idx_charge_radii_element` | charge_radii | element |
| `idx_laser_radii_element` | laser_radii | element |
| `idx_laser_radii_refs_za` | laser_radii_refs | Z, A |
| `idx_ensdf_references_keynumber` | ensdf_references | keynumber |
| `idx_ensdf_datasets_za` | ensdf_datasets | Z, A |
| `idx_ensdf_datasets_type` | ensdf_datasets | dataset_type |
| `idx_ensdf_levels_za` | ensdf_levels | Z, A |
| `idx_ensdf_levels_dataset` | ensdf_levels | dataset_id |
| `idx_ensdf_levels_element` | ensdf_levels | element |
| `idx_ensdf_levels_energy` | ensdf_levels | energy_keV |
| `idx_ensdf_gammas_za` | ensdf_gammas | Z, A |
| `idx_ensdf_gammas_level` | ensdf_gammas | level_id |
| `idx_ensdf_gammas_level_energy` | ensdf_gammas | Z, A, level_energy_keV |
| `idx_ensdf_gammas_energy` | ensdf_gammas | gamma_energy_keV |
| `idx_ensdf_feedings_parent` | ensdf_decay_feedings | parent_Z, parent_A |
| `idx_ensdf_feedings_dataset` | ensdf_decay_feedings | dataset_id |
| `idx_ensdf_feedings_mode` | ensdf_decay_feedings | decay_mode |

**Typical query patterns** that are well-indexed:
- Look up by Z, A -> all ENSDF tables
- Look up by element symbol -> AME, NUBASE, charge_radii
- Search gammas by energy -> `idx_ensdf_gammas_energy`
- Search levels by energy -> `idx_ensdf_levels_energy`
- Join gammas -> levels -> datasets -> uses `level_id` and `dataset_id` indexes

---

## Example Queries

### Find all gamma transitions for a nuclide (adopted levels)
```sql
SELECT g.gamma_energy_keV, g.gamma_energy_unc_keV,
       g.rel_intensity, g.multipolarity,
       l.energy_keV AS level_energy, l.spin_parity
FROM ensdf_gammas g
JOIN ensdf_levels l ON g.level_id = l.level_id
JOIN ensdf_datasets d ON g.dataset_id = d.dataset_id
WHERE d.Z = 28 AND d.A = 60
  AND d.dataset_type = 'ADOPTED LEVELS, GAMMAS'
ORDER BY g.gamma_energy_keV;
```

### Find gammas in an energy window (all nuclides)
```sql
-- Note: filters to adopted levels to avoid duplicates from decay datasets
SELECT g.gamma_energy_keV, g.Z, g.A, g.element, g.rel_intensity,
       l.spin_parity, g.multipolarity
FROM ensdf_gammas g
JOIN ensdf_levels l ON g.level_id = l.level_id
JOIN ensdf_datasets d ON g.dataset_id = d.dataset_id
WHERE g.gamma_energy_keV BETWEEN 660.0 AND 663.0
  AND d.dataset_type = 'ADOPTED LEVELS, GAMMAS'
ORDER BY g.gamma_energy_keV;
```

### Get mass excess with measurement status
```sql
SELECT Z, A, element, mass_excess_keV, mass_excess_unc_keV,
       CASE WHEN is_estimated = 1 THEN 'extrapolated' ELSE 'measured' END AS status
FROM ame_masses
WHERE Z = 82;  -- Lead isotopes
```

### Find long-lived isomers (> 1 second)
```sql
SELECT l.Z, l.A, l.element, l.energy_keV, l.spin_parity,
       l.half_life, l.isomer_flag
FROM ensdf_levels l
JOIN ensdf_datasets d ON l.dataset_id = d.dataset_id
WHERE l.isomer_flag IN ('M', 'M1', 'M2', 'M3')
  AND l.half_life_seconds > 1.0
  AND d.dataset_type IN ('ADOPTED LEVELS', 'ADOPTED LEVELS, GAMMAS')
ORDER BY l.half_life_seconds DESC;
```

### Decay chain: what does Cs-137 feed?
```sql
SELECT f.decay_mode, f.daughter_level_keV, f.ib_percent,
       f.log_ft, f.forbiddenness
FROM ensdf_decay_feedings f
JOIN ensdf_datasets d ON f.dataset_id = d.dataset_id
WHERE d.parent_z = 55 AND d.parent_a = 137;
```

### Compare mass excess: AME vs. NUBASE
```sql
SELECT a.Z, a.A, a.element,
       a.mass_excess_keV AS ame_me, n.mass_excess_keV AS nubase_me,
       ABS(a.mass_excess_keV - n.mass_excess_keV) AS diff_keV
FROM ame_masses a
JOIN nubase n ON a.Z = n.Z AND a.A = n.A AND n.isomer_index = 0
WHERE ABS(a.mass_excess_keV - n.mass_excess_keV) > 1.0
ORDER BY diff_keV DESC LIMIT 10;
```

---

## Data Provenance

| Source | URL | License |
|--------|-----|---------|
| AME2020 | https://www-nds.iaea.org/amdc/ | Academic use |
| NUBASE2020 | https://www-nds.iaea.org/amdc/ | Academic use |
| ENSDF | https://www.nndc.bnl.gov/ensdf/ | Public domain (US DOE) |
| IAEA charge radii | https://www-nds.iaea.org/radii/ | Academic use |
| Li et al. 2021 | https://doi.org/10.1016/j.adt.2021.101440 | Academic use (ADNDT) |

Built from raw data files using `npx tsx src/ingest/buildDb.ts`. ENSDF files are
the 300-file set distributed by NNDC (ensdf.001–ensdf.300), totaling ~294 MB of
80-column fixed-width ASCII.
