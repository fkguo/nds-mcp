/**
 * Build NDS SQLite database from raw data files.
 *
 * Usage:
 *   Full build:      tsx src/ingest/buildDb.ts --data-dir /path/to/raw/ --output /path/to/nds.sqlite
 *   ENSDF only:      tsx src/ingest/buildDb.ts --ensdf-only --db /path/to/nds.sqlite --ensdf-dir /path/to/ensdf/
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { parseAmeMasses, parseAmeRct1, parseAmeRct2 } from './parseAme.js';
import { parseNubase } from './parseNubase.js';
import { parseChargeRadii } from './parseRadii.js';
import { parseLaserRadii } from './parseLaserRadii.js';
import { parseTunlLevels } from './parseTunl.js';
import {
  CODATA_INDEX_SQL,
  CODATA_SCHEMA_SQL,
  DEFAULT_CODATA_ASCII_URL,
  ingestCodata,
} from './buildCodataDb.js';
import {
  splitIntoDatasets,
  classifyRecord,
  parseReferenceRecord,
  identifyDataset,
  parseLevelRecord,
  parseGammaRecord,
  parseBetaRecord,
  parseECRecord,
  parseParentRecord,
  extractQrefKeynumbers,
  extractTitleHalfLife,
  parseBTypeContinuation,
  parseSTypeContinuation,
  preprocessLine,
  type EnsdfGammaRow,
} from './parseEnsdf.js';

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlVal(v: number | null | boolean): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

// ── Base schema (AME + NUBASE + charge radii) ──────────────────────────────

const BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nds_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ame_masses (
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  mass_excess_keV REAL,
  mass_excess_unc_keV REAL,
  binding_energy_per_A_keV REAL,
  binding_energy_per_A_unc_keV REAL,
  beta_decay_energy_keV REAL,
  beta_decay_energy_unc_keV REAL,
  atomic_mass_micro_u REAL,
  atomic_mass_unc_micro_u REAL,
  is_estimated INTEGER DEFAULT 0,
  PRIMARY KEY (Z, A)
);

CREATE TABLE IF NOT EXISTS ame_reactions (
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  S2n_keV REAL, S2n_unc_keV REAL,
  S2p_keV REAL, S2p_unc_keV REAL,
  Qa_keV REAL, Qa_unc_keV REAL,
  Q2bm_keV REAL, Q2bm_unc_keV REAL,
  Qep_keV REAL, Qep_unc_keV REAL,
  Qbn_keV REAL, Qbn_unc_keV REAL,
  Sn_keV REAL, Sn_unc_keV REAL,
  Sp_keV REAL, Sp_unc_keV REAL,
  Q4bm_keV REAL, Q4bm_unc_keV REAL,
  Qda_keV REAL, Qda_unc_keV REAL,
  Qpa_keV REAL, Qpa_unc_keV REAL,
  Qna_keV REAL, Qna_unc_keV REAL,
  PRIMARY KEY (Z, A)
);

CREATE TABLE IF NOT EXISTS nubase (
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  isomer_index INTEGER DEFAULT 0,
  mass_excess_keV REAL,
  mass_excess_unc_keV REAL,
  excitation_energy_keV REAL,
  half_life TEXT,
  half_life_seconds REAL,
  half_life_unc_seconds REAL,
  spin_parity TEXT,
  decay_modes TEXT,
  is_estimated INTEGER DEFAULT 0,
  PRIMARY KEY (Z, A, isomer_index)
);

CREATE TABLE IF NOT EXISTS charge_radii (
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  r_charge_fm REAL,
  r_charge_unc_fm REAL,
  r_charge_preliminary_fm REAL,
  r_charge_preliminary_unc_fm REAL,
  PRIMARY KEY (Z, A)
);
`;

// ── ENSDF schema (5 tables) ────────────────────────────────────────────────

const ENSDF_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nds_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ensdf_references (
  A INTEGER NOT NULL,
  keynumber TEXT NOT NULL,
  type TEXT,
  reference TEXT,
  PRIMARY KEY (A, keynumber)
);

CREATE TABLE IF NOT EXISTS ensdf_datasets (
  dataset_id INTEGER PRIMARY KEY AUTOINCREMENT,
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  dataset_type TEXT NOT NULL,
  dsid TEXT NOT NULL,
  parent_z INTEGER,
  parent_a INTEGER,
  parent_element TEXT,
  parent_half_life TEXT,
  qref_keynumbers TEXT,
  qref_raw TEXT
);

CREATE TABLE IF NOT EXISTS ensdf_levels (
  level_id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES ensdf_datasets(dataset_id),
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  energy_keV REAL NOT NULL,
  energy_raw TEXT NOT NULL,
  energy_unc_keV REAL,
  spin_parity TEXT,
  half_life TEXT,
  half_life_seconds REAL,
  half_life_unc_seconds REAL,
  isomer_flag TEXT,
  questionable INTEGER DEFAULT 0,
  comment_flag TEXT
);

CREATE TABLE IF NOT EXISTS ensdf_gammas (
  gamma_id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES ensdf_datasets(dataset_id),
  level_id INTEGER NOT NULL REFERENCES ensdf_levels(level_id),
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  level_energy_keV REAL NOT NULL,
  gamma_energy_keV REAL NOT NULL,
  gamma_energy_raw TEXT NOT NULL,
  gamma_energy_unc_keV REAL,
  rel_intensity REAL,
  rel_intensity_unc REAL,
  total_intensity REAL,
  total_intensity_unc REAL,
  multipolarity TEXT,
  mixing_ratio REAL,
  mixing_ratio_unc REAL,
  total_conv_coeff REAL,
  total_conv_coeff_unc REAL,
  comment_flag TEXT,
  coin_flag TEXT,
  questionable INTEGER DEFAULT 0,
  be2w REAL,
  be2w_unc REAL,
  bm1w REAL,
  bm1w_unc REAL
);

CREATE TABLE IF NOT EXISTS ensdf_decay_feedings (
  feeding_id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES ensdf_datasets(dataset_id),
  parent_Z INTEGER NOT NULL,
  parent_A INTEGER NOT NULL,
  parent_element TEXT NOT NULL,
  decay_mode TEXT NOT NULL,
  daughter_level_keV REAL,
  daughter_level_id INTEGER REFERENCES ensdf_levels(level_id),
  ib_percent REAL,
  ib_percent_unc REAL,
  ie_percent REAL,
  ie_percent_unc REAL,
  ti_percent REAL,
  ti_percent_unc REAL,
  log_ft REAL,
  log_ft_unc REAL,
  endpoint_keV REAL,
  endpoint_unc_keV REAL,
  forbiddenness TEXT,
  comment_flag TEXT
);
`;

// ── Laser spectroscopy radii schema (Li et al. 2021) ────────────────────────

const LASER_RADII_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS laser_radii (
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  N INTEGER NOT NULL,
  element TEXT NOT NULL,
  delta_r2_fm2 REAL NOT NULL,
  delta_r2_unc_fm2 REAL,
  r_charge_fm REAL NOT NULL,
  r_charge_unc_fm REAL NOT NULL,
  is_reference INTEGER DEFAULT 0,
  in_angeli_2013 INTEGER DEFAULT 0,
  ref_A INTEGER NOT NULL,
  PRIMARY KEY (Z, A)
);

CREATE TABLE IF NOT EXISTS laser_radii_refs (
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  citekey TEXT NOT NULL,
  reference TEXT NOT NULL,
  PRIMARY KEY (Z, A, citekey),
  FOREIGN KEY (Z, A) REFERENCES laser_radii(Z, A)
);
`;

const LASER_RADII_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_laser_radii_element ON laser_radii(element);
CREATE INDEX IF NOT EXISTS idx_laser_radii_refs_za ON laser_radii_refs(Z, A);
`;

// ── TUNL energy levels schema (light nuclei A ≤ 20) ─────────────────────────

const TUNL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tunl_levels (
  tunl_level_id INTEGER PRIMARY KEY AUTOINCREMENT,
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  element TEXT NOT NULL,
  energy_keV REAL NOT NULL,
  energy_unc_keV REAL,
  energy_raw TEXT,
  spin_parity TEXT,
  isospin TEXT,
  width_keV REAL,
  width_unc_keV REAL,
  width_raw TEXT,
  width_relation TEXT,
  half_life TEXT,
  decay_modes TEXT,
  evaluation TEXT NOT NULL,
  table_label TEXT
);
`;

const TUNL_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_tunl_levels_za_energy ON tunl_levels(Z, A, energy_keV);
CREATE INDEX IF NOT EXISTS idx_tunl_levels_element ON tunl_levels(element);
CREATE INDEX IF NOT EXISTS idx_tunl_levels_jpi ON tunl_levels(spin_parity);
CREATE INDEX IF NOT EXISTS idx_tunl_levels_isospin ON tunl_levels(isospin);
`;

// ── Combined constants for full rebuild ─────────────────────────────────────

const SCHEMA_SQL =
  BASE_SCHEMA_SQL +
  ENSDF_SCHEMA_SQL +
  LASER_RADII_SCHEMA_SQL +
  TUNL_SCHEMA_SQL +
  CODATA_SCHEMA_SQL;

// ── Indexes ─────────────────────────────────────────────────────────────────

const BASE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_ame_masses_element ON ame_masses(element);
CREATE INDEX IF NOT EXISTS idx_ame_reactions_element ON ame_reactions(element);
CREATE INDEX IF NOT EXISTS idx_nubase_element ON nubase(element);
CREATE INDEX IF NOT EXISTS idx_nubase_half_life ON nubase(half_life_seconds);
CREATE INDEX IF NOT EXISTS idx_nubase_mass_excess ON nubase(mass_excess_keV);
CREATE INDEX IF NOT EXISTS idx_charge_radii_element ON charge_radii(element);
`;

const ENSDF_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_ensdf_references_keynumber ON ensdf_references(keynumber);
CREATE INDEX IF NOT EXISTS idx_ensdf_datasets_za ON ensdf_datasets(Z, A);
CREATE INDEX IF NOT EXISTS idx_ensdf_datasets_type ON ensdf_datasets(dataset_type);
CREATE INDEX IF NOT EXISTS idx_ensdf_levels_za ON ensdf_levels(Z, A);
CREATE INDEX IF NOT EXISTS idx_ensdf_levels_dataset ON ensdf_levels(dataset_id);
CREATE INDEX IF NOT EXISTS idx_ensdf_levels_element ON ensdf_levels(element);
CREATE INDEX IF NOT EXISTS idx_ensdf_levels_energy ON ensdf_levels(energy_keV);
CREATE INDEX IF NOT EXISTS idx_ensdf_gammas_za ON ensdf_gammas(Z, A);
CREATE INDEX IF NOT EXISTS idx_ensdf_gammas_level ON ensdf_gammas(level_id);
CREATE INDEX IF NOT EXISTS idx_ensdf_gammas_level_energy ON ensdf_gammas(Z, A, level_energy_keV);
CREATE INDEX IF NOT EXISTS idx_ensdf_gammas_energy ON ensdf_gammas(gamma_energy_keV);
CREATE INDEX IF NOT EXISTS idx_ensdf_feedings_parent ON ensdf_decay_feedings(parent_Z, parent_A);
CREATE INDEX IF NOT EXISTS idx_ensdf_feedings_dataset ON ensdf_decay_feedings(dataset_id);
CREATE INDEX IF NOT EXISTS idx_ensdf_feedings_mode ON ensdf_decay_feedings(decay_mode);
`;

const INDEX_SQL =
  BASE_INDEX_SQL +
  ENSDF_INDEX_SQL +
  LASER_RADII_INDEX_SQL +
  TUNL_INDEX_SQL +
  CODATA_INDEX_SQL;

function resolveCodataSource(dataDir: string): string {
  const candidates = [
    path.join(dataDir, 'codata', 'allascii.txt'),
    path.join(dataDir, 'codata', 'codata-allascii.txt'),
    path.join(dataDir, 'codata', 'codata-allscii.txt'),
    path.join(dataDir, 'codata-allascii.txt'),
    path.join(dataDir, 'codata-allscii.txt'),
    path.join(dataDir, 'allascii.txt'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return DEFAULT_CODATA_ASCII_URL;
}

function executeSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath], {
    input: sql,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
}

// ── ENSDF ingestion ────────────────────────────────────────────────────────

const ENSDF_BATCH_SIZE = 5000;

function sqlStr(v: string | null): string {
  if (v === null) return 'NULL';
  return `'${sqlEscape(v)}'`;
}

/**
 * Execute an INSERT and return the AUTOINCREMENT rowid in a single sqlite3 session.
 * (last_insert_rowid() is connection-scoped; separate processes always return 0.)
 */
function insertAndGetRowid(dbPath: string, insertSql: string): number {
  const combined = `${insertSql}\nSELECT last_insert_rowid();`;
  const result = execFileSync('sqlite3', [dbPath], {
    input: combined,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  return parseInt(result.trim(), 10);
}

function ingestEnsdfFiles(dbPath: string, ensdfDir: string): {
  references: number; datasets: number; levels: number; gammas: number; feedings: number;
} {
  if (!fs.existsSync(ensdfDir)) {
    console.error('ENSDF directory not found, skipping ENSDF ingestion');
    return { references: 0, datasets: 0, levels: 0, gammas: 0, feedings: 0 };
  }

  // Idempotent: clear any previous ENSDF data (order respects FK constraints)
  executeSql(dbPath, `
    DELETE FROM ensdf_decay_feedings;
    DELETE FROM ensdf_gammas;
    DELETE FROM ensdf_levels;
    DELETE FROM ensdf_datasets;
    DELETE FROM ensdf_references;
  `);

  const files = fs.readdirSync(ensdfDir)
    .filter(f => /^ensdf\.\d{3}$/.test(f))
    .sort();

  const counts = { references: 0, datasets: 0, levels: 0, gammas: 0, feedings: 0 };

  for (const file of files) {
    const filePath = path.join(ensdfDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const blocks = splitIntoDatasets(content);

    // Extract mass number from filename
    const massMatch = file.match(/ensdf\.(\d{3})/);
    const massNumber = massMatch ? parseInt(massMatch[1]!, 10) : 0;

    for (const block of blocks) {
      const headerLine = block.headerLine;

      // Check if this is a REFERENCES dataset
      const dsidField = headerLine.substring(9, 39).trim();
      if (dsidField === 'REFERENCES') {
        const refStmts: string[] = [];
        for (const line of block.lines) {
          const processed = preprocessLine(line);
          const rc = classifyRecord(processed);
          if (rc === 'reference') {
            const ref = parseReferenceRecord(processed, massNumber);
            if (ref) {
              refStmts.push(
                `INSERT OR IGNORE INTO ensdf_references VALUES(${ref.A},${sqlStr(ref.keynumber)},${sqlStr(ref.type)},${sqlStr(ref.reference)});`
              );
            }
          }
        }
        if (refStmts.length > 0) {
          for (let i = 0; i < refStmts.length; i += ENSDF_BATCH_SIZE) {
            const batch = refStmts.slice(i, i + ENSDF_BATCH_SIZE);
            executeSql(dbPath, `BEGIN;\n${batch.join('\n')}\nCOMMIT;`);
          }
          counts.references += refStmts.length;
        }
        continue;
      }

      // Check if this is a COMMENTS dataset (col 6-9 area)
      if (dsidField === 'COMMENTS' || dsidField === '') continue;

      // Identify dataset type
      const dsInfo = identifyDataset(headerLine);
      if (!dsInfo) continue;

      // Insert dataset record
      const parentNucid = dsInfo.parentNucid;
      const datasetId = insertAndGetRowid(dbPath,
        `INSERT INTO ensdf_datasets(Z,A,element,dataset_type,dsid,parent_z,parent_a,parent_element) VALUES(${dsInfo.nucid.Z},${dsInfo.nucid.A},${sqlStr(dsInfo.nucid.element)},${sqlStr(dsInfo.datasetType)},${sqlStr(dsInfo.dsid)},${sqlVal(parentNucid?.Z ?? null)},${sqlVal(parentNucid?.A ?? null)},${sqlStr(parentNucid?.element ?? null)});`
      );
      counts.datasets++;

      // Per-dataset state
      let currentLevelId: number | null = null;
      let currentLevelEnergy: number | null = null;
      let currentGamma: Partial<EnsdfGammaRow> | null = null;
      let currentGammaRecordType: string = '';
      let parentHalfLife: string | null = extractTitleHalfLife(dsInfo.dsid);
      const qrefKeynumbers: string[] = [];
      let qrefRaw: string = '';
      const gammaBuffer: string[] = [];

      function flushGamma(): void {
        if (currentGamma && currentGamma.gamma_energy_keV !== undefined) {
          gammaBuffer.push(
            `INSERT INTO ensdf_gammas(dataset_id,level_id,Z,A,element,level_energy_keV,gamma_energy_keV,gamma_energy_raw,gamma_energy_unc_keV,rel_intensity,rel_intensity_unc,total_intensity,total_intensity_unc,multipolarity,mixing_ratio,mixing_ratio_unc,total_conv_coeff,total_conv_coeff_unc,comment_flag,coin_flag,questionable,be2w,be2w_unc,bm1w,bm1w_unc) VALUES(${datasetId},${sqlVal(currentGamma.level_id ?? null)},${currentGamma.Z},${currentGamma.A},${sqlStr(currentGamma.element ?? null)},${sqlVal(currentGamma.level_energy_keV ?? null)},${sqlVal(currentGamma.gamma_energy_keV ?? null)},${sqlStr(currentGamma.gamma_energy_raw ?? null)},${sqlVal(currentGamma.gamma_energy_unc_keV ?? null)},${sqlVal(currentGamma.rel_intensity ?? null)},${sqlVal(currentGamma.rel_intensity_unc ?? null)},${sqlVal(currentGamma.total_intensity ?? null)},${sqlVal(currentGamma.total_intensity_unc ?? null)},${sqlStr(currentGamma.multipolarity ?? null)},${sqlVal(currentGamma.mixing_ratio ?? null)},${sqlVal(currentGamma.mixing_ratio_unc ?? null)},${sqlVal(currentGamma.total_conv_coeff ?? null)},${sqlVal(currentGamma.total_conv_coeff_unc ?? null)},${sqlStr(currentGamma.comment_flag ?? null)},${sqlStr(currentGamma.coin_flag ?? null)},${sqlVal(currentGamma.questionable ?? 0)},${sqlVal(currentGamma.be2w ?? null)},${sqlVal(currentGamma.be2w_unc ?? null)},${sqlVal(currentGamma.bm1w ?? null)},${sqlVal(currentGamma.bm1w_unc ?? null)});`
          );
        }
        currentGamma = null;
      }

      // Process lines
      for (let i = 1; i < block.lines.length; i++) {
        const line = block.lines[i]!;
        const col6 = line[5]!;

        // Continuation records (col 6 !== ' ')
        if (col6 !== ' ') {
          if (col6 === 'B' && currentGammaRecordType === 'G' && currentGamma) {
            const bData = parseBTypeContinuation(line);
            if (bData.be2w !== null) { currentGamma.be2w = bData.be2w; currentGamma.be2w_unc = bData.be2w_unc; }
            if (bData.bm1w !== null) { currentGamma.bm1w = bData.bm1w; currentGamma.bm1w_unc = bData.bm1w_unc; }
          } else if (col6 === 'S' && currentGammaRecordType === 'G' && currentGamma) {
            const sData = parseSTypeContinuation(line);
            if (sData.cc !== null && currentGamma.total_conv_coeff === null) {
              currentGamma.total_conv_coeff = sData.cc;
              currentGamma.total_conv_coeff_unc = sData.cc_unc;
            }
          }
          // col 6 = '2'-'9' or other → skip
          continue;
        }

        // Primary records (col 6 = ' ')
        const rc = classifyRecord(line);

        switch (rc) {
          case 'comment': case 'text': case 'xref': case 'history':
          case 'normalization': case 'unknown': case 'delayed': case 'alpha':
          case 'header':
            break;

          case 'parent': {
            const pData = parseParentRecord(line);
            if (pData.halfLife) {
              parentHalfLife = pData.halfLife;
            }
            break;
          }

          case 'qvalue': {
            const qData = extractQrefKeynumbers(line);
            if (qData.keynumbers.length > 0) {
              qrefKeynumbers.push(...qData.keynumbers);
            }
            if (qData.raw) qrefRaw = qData.raw;
            break;
          }

          case 'level': {
            flushGamma();
            const lData = parseLevelRecord(line);
            if (lData) {
              currentLevelId = insertAndGetRowid(dbPath,
                `INSERT INTO ensdf_levels(dataset_id,Z,A,element,energy_keV,energy_raw,energy_unc_keV,spin_parity,half_life,half_life_seconds,half_life_unc_seconds,isomer_flag,questionable,comment_flag) VALUES(${datasetId},${dsInfo.nucid.Z},${dsInfo.nucid.A},${sqlStr(dsInfo.nucid.element)},${sqlVal(lData.energy_keV)},${sqlStr(lData.energy_raw)},${sqlVal(lData.energy_unc_keV)},${sqlStr(lData.spin_parity)},${sqlStr(lData.half_life)},${sqlVal(lData.half_life_seconds)},${sqlVal(lData.half_life_unc_seconds)},${sqlStr(lData.isomer_flag)},${sqlVal(lData.questionable)},${sqlStr(lData.comment_flag)});`
              );
              currentLevelEnergy = lData.energy_keV;
              currentGammaRecordType = '';
              counts.levels++;
            }
            break;
          }

          case 'gamma': {
            flushGamma();
            const gData = parseGammaRecord(line);
            if (gData && currentLevelId !== null) {
              currentGamma = {
                dataset_id: datasetId,
                level_id: currentLevelId,
                Z: dsInfo.nucid.Z,
                A: dsInfo.nucid.A,
                element: dsInfo.nucid.element,
                level_energy_keV: currentLevelEnergy ?? 0,
                gamma_energy_keV: gData.gamma_energy_keV,
                gamma_energy_raw: gData.gamma_energy_raw,
                gamma_energy_unc_keV: gData.gamma_energy_unc_keV,
                rel_intensity: gData.rel_intensity,
                rel_intensity_unc: gData.rel_intensity_unc,
                total_intensity: gData.total_intensity,
                total_intensity_unc: gData.total_intensity_unc,
                multipolarity: gData.multipolarity,
                mixing_ratio: gData.mixing_ratio,
                mixing_ratio_unc: gData.mixing_ratio_unc,
                total_conv_coeff: gData.total_conv_coeff,
                total_conv_coeff_unc: gData.total_conv_coeff_unc,
                comment_flag: gData.comment_flag,
                coin_flag: gData.coin_flag,
                questionable: gData.questionable,
                be2w: null,
                be2w_unc: null,
                bm1w: null,
                bm1w_unc: null,
              };
              currentGammaRecordType = 'G';
            }
            break;
          }

          case 'beta': {
            flushGamma();
            const bData = parseBetaRecord(line);
            const parentZ = parentNucid?.Z ?? dsInfo.nucid.Z;
            const parentA = parentNucid?.A ?? dsInfo.nucid.A;
            const parentEl = parentNucid?.element ?? dsInfo.nucid.element;
            executeSql(dbPath,
              `INSERT INTO ensdf_decay_feedings(dataset_id,parent_Z,parent_A,parent_element,decay_mode,daughter_level_keV,daughter_level_id,ib_percent,ib_percent_unc,ie_percent,ie_percent_unc,ti_percent,ti_percent_unc,log_ft,log_ft_unc,endpoint_keV,endpoint_unc_keV,forbiddenness,comment_flag) VALUES(${datasetId},${parentZ},${parentA},${sqlStr(parentEl)},${sqlStr('B-')},${sqlVal(currentLevelEnergy)},${sqlVal(currentLevelId)},${sqlVal(bData.ib_percent)},${sqlVal(bData.ib_percent_unc)},NULL,NULL,NULL,NULL,${sqlVal(bData.log_ft)},${sqlVal(bData.log_ft_unc)},${sqlVal(bData.endpoint_keV)},${sqlVal(bData.endpoint_unc_keV)},${sqlStr(bData.forbiddenness)},${sqlStr(bData.comment_flag)});`
            );
            currentGammaRecordType = 'B';
            counts.feedings++;
            break;
          }

          case 'ec': {
            flushGamma();
            const eData = parseECRecord(line);
            const parentZ = parentNucid?.Z ?? dsInfo.nucid.Z;
            const parentA = parentNucid?.A ?? dsInfo.nucid.A;
            const parentEl = parentNucid?.element ?? dsInfo.nucid.element;
            const mode = dsInfo.datasetType.includes('EC+B+') ? 'EC+B+' : 'EC';
            executeSql(dbPath,
              `INSERT INTO ensdf_decay_feedings(dataset_id,parent_Z,parent_A,parent_element,decay_mode,daughter_level_keV,daughter_level_id,ib_percent,ib_percent_unc,ie_percent,ie_percent_unc,ti_percent,ti_percent_unc,log_ft,log_ft_unc,endpoint_keV,endpoint_unc_keV,forbiddenness,comment_flag) VALUES(${datasetId},${parentZ},${parentA},${sqlStr(parentEl)},${sqlStr(mode)},${sqlVal(currentLevelEnergy)},${sqlVal(currentLevelId)},${sqlVal(eData.ib_percent)},${sqlVal(eData.ib_percent_unc)},${sqlVal(eData.ie_percent)},${sqlVal(eData.ie_percent_unc)},${sqlVal(eData.ti_percent)},${sqlVal(eData.ti_percent_unc)},${sqlVal(eData.log_ft)},${sqlVal(eData.log_ft_unc)},${sqlVal(eData.endpoint_keV)},${sqlVal(eData.endpoint_unc_keV)},${sqlStr(eData.forbiddenness)},${sqlStr(eData.comment_flag)});`
            );
            currentGammaRecordType = 'E';
            counts.feedings++;
            break;
          }

          case 'reference':
            // References in non-REFERENCES datasets → handled at dataset level
            break;
        }
      }

      // Flush last gamma
      flushGamma();

      // Batch insert gammas
      if (gammaBuffer.length > 0) {
        for (let i = 0; i < gammaBuffer.length; i += ENSDF_BATCH_SIZE) {
          const batch = gammaBuffer.slice(i, i + ENSDF_BATCH_SIZE);
          executeSql(dbPath, `BEGIN;\n${batch.join('\n')}\nCOMMIT;`);
        }
        counts.gammas += gammaBuffer.length;
      }

      // Update dataset with QREF and parent half-life
      if (qrefKeynumbers.length > 0 || parentHalfLife) {
        const uniqueKeys = [...new Set(qrefKeynumbers)];
        const qrefJson = uniqueKeys.length > 0 ? JSON.stringify(uniqueKeys) : null;
        executeSql(dbPath,
          `UPDATE ensdf_datasets SET qref_keynumbers=${sqlStr(qrefJson)}, qref_raw=${sqlStr(qrefRaw || null)}, parent_half_life=${sqlStr(parentHalfLife)} WHERE dataset_id=${datasetId};`
        );
      }
    }

    console.error(`  ${file}: refs=${counts.references}, ds=${counts.datasets}, lvl=${counts.levels}, g=${counts.gammas}, feed=${counts.feedings}`);
  }

  return counts;
}

// ── Laser radii ingestion ───────────────────────────────────────────────────

function ingestLaserRadii(dbPath: string, texPath: string): { rows: number; refs: number } {
  if (!fs.existsSync(texPath)) {
    console.error('Laser radii file not found, skipping laser radii ingestion');
    return { rows: 0, refs: 0 };
  }

  const content = fs.readFileSync(texPath, 'utf-8');
  const { rows, refs, refIsotopes } = parseLaserRadii(content);

  // Idempotent: clear previous data (refs first for FK constraint)
  executeSql(dbPath, `
    DELETE FROM laser_radii_refs;
    DELETE FROM laser_radii;
  `);

  const BATCH_SIZE = 200;

  // Insert laser_radii rows
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const stmts = batch.map(r => {
      const refA = refIsotopes.get(r.Z) ?? 0;
      return `INSERT OR REPLACE INTO laser_radii VALUES(${r.Z},${r.A},${r.N},'${sqlEscape(r.element)}',${sqlVal(r.delta_r2_fm2)},${sqlVal(r.delta_r2_unc_fm2)},${sqlVal(r.r_charge_fm)},${sqlVal(r.r_charge_unc_fm)},${sqlVal(r.is_reference)},${sqlVal(r.in_angeli_2013)},${refA});`;
    });
    executeSql(dbPath, `BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
  }

  // Insert laser_radii_refs
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = refs.slice(i, i + BATCH_SIZE);
    const stmts = batch.map(r =>
      `INSERT OR REPLACE INTO laser_radii_refs VALUES(${r.Z},${r.A},${sqlStr(r.citekey)},${sqlStr(r.reference)});`
    );
    executeSql(dbPath, `BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
  }

  return { rows: rows.length, refs: refs.length };
}

// ── TUNL levels ingestion ─────────────────────────────────────────────────────

function ingestTunlLevels(dbPath: string, tunlDir: string): number {
  if (!fs.existsSync(tunlDir)) {
    console.error('TUNL directory not found, skipping TUNL ingestion');
    return 0;
  }

  const files = fs.readdirSync(tunlDir)
    .filter(f => f.endsWith('.txt'))
    .sort();

  if (files.length === 0) {
    console.error('No TUNL .txt files found, skipping TUNL ingestion');
    return 0;
  }

  // Idempotent: clear previous TUNL data
  executeSql(dbPath, `DELETE FROM tunl_levels;`);

  const BATCH_SIZE = 200;
  let totalRows = 0;

  for (const file of files) {
    const filePath = path.join(tunlDir, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const rows = parseTunlLevels(text);

    if (rows.length === 0) {
      console.error(`  TUNL ${file}: 0 levels (parse failed or empty)`);
      continue;
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(r =>
        `INSERT INTO tunl_levels(Z,A,element,energy_keV,energy_unc_keV,energy_raw,spin_parity,isospin,width_keV,width_unc_keV,width_raw,width_relation,half_life,decay_modes,evaluation,table_label) VALUES(${r.Z},${r.A},${sqlStr(r.element)},${sqlVal(r.energy_keV)},${sqlVal(r.energy_unc_keV)},${sqlStr(r.energy_raw)},${sqlStr(r.spin_parity)},${sqlStr(r.isospin)},${sqlVal(r.width_keV)},${sqlVal(r.width_unc_keV)},${sqlStr(r.width_raw)},${sqlStr(r.width_relation)},${sqlStr(r.half_life)},${sqlStr(r.decay_modes)},${sqlStr(r.evaluation)},${sqlStr(r.table_label)});`
      );
      executeSql(dbPath, `BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
    }

    totalRows += rows.length;
    console.error(`  TUNL ${file}: ${rows.length} levels`);
  }

  return totalRows;
}

export async function buildDatabase(dataDir: string, outputPath: string): Promise<{
  masses: number;
  rct1: number;
  rct2: number;
  nubase: number;
  radii: number;
  laserRadii: number;
  ensdf: { references: number; datasets: number; levels: number; gammas: number; feedings: number };
  tunl: number;
  codata: number;
}> {
  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Build into temp file, then atomic rename on success
  const tmpPath = `${outputPath}.tmp.${Date.now()}`;

  // Remove stale temp file if any
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }

  try {
    // Create schema
    executeSql(tmpPath, SCHEMA_SQL);

    // Parse all data files
    const massContent = fs.readFileSync(path.join(dataDir, 'mass_1.mas20'), 'utf-8');
    const masses = parseAmeMasses(massContent);

    const rct1Content = fs.readFileSync(path.join(dataDir, 'rct1.mas20'), 'utf-8');
    const rct1Rows = parseAmeRct1(rct1Content);

    const rct2Content = fs.readFileSync(path.join(dataDir, 'rct2_1.mas20'), 'utf-8');
    const rct2Rows = parseAmeRct2(rct2Content);

    const nubaseContent = fs.readFileSync(path.join(dataDir, 'nubase_4.mas20'), 'utf-8');
    const nubaseRows = parseNubase(nubaseContent);

    let radiiCount = 0;
    const radiiPath = path.join(dataDir, 'charge_radii.csv');
    let radiiRows: ReturnType<typeof parseChargeRadii> = [];
    if (fs.existsSync(radiiPath)) {
      const radiiContent = fs.readFileSync(radiiPath, 'utf-8');
      radiiRows = parseChargeRadii(radiiContent);
    }

    // Insert data in batches
    const BATCH_SIZE = 200;

    // -- ame_masses --
    for (let i = 0; i < masses.length; i += BATCH_SIZE) {
      const batch = masses.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(r =>
        `INSERT OR REPLACE INTO ame_masses VALUES(${r.Z},${r.A},'${sqlEscape(r.element)}',${sqlVal(r.mass_excess_keV)},${sqlVal(r.mass_excess_unc_keV)},${sqlVal(r.binding_energy_per_A_keV)},${sqlVal(r.binding_energy_per_A_unc_keV)},${sqlVal(r.beta_decay_energy_keV)},${sqlVal(r.beta_decay_energy_unc_keV)},${sqlVal(r.atomic_mass_micro_u)},${sqlVal(r.atomic_mass_unc_micro_u)},${sqlVal(r.is_estimated)});`
      );
      executeSql(tmpPath, `BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
    }

    // -- ame_reactions (merge rct1 + rct2) --
    // Build rct2 lookup
    const rct2Map = new Map<string, typeof rct2Rows[0]>();
    for (const r of rct2Rows) {
      rct2Map.set(`${r.Z}_${r.A}`, r);
    }

    // Union of all (Z,A) from rct1 and rct2
    const reactionKeys = new Set<string>();
    for (const r of rct1Rows) reactionKeys.add(`${r.Z}_${r.A}`);
    for (const r of rct2Rows) reactionKeys.add(`${r.Z}_${r.A}`);

    const rct1Map = new Map<string, typeof rct1Rows[0]>();
    for (const r of rct1Rows) rct1Map.set(`${r.Z}_${r.A}`, r);

    const reactionInserts: string[] = [];
    for (const key of reactionKeys) {
      const r1 = rct1Map.get(key);
      const r2 = rct2Map.get(key);
      const [zStr, aStr] = key.split('_');
      const Z = parseInt(zStr!, 10);
      const A = parseInt(aStr!, 10);
      const element = r1?.element ?? r2?.element ?? '';

      reactionInserts.push(
        `INSERT OR REPLACE INTO ame_reactions VALUES(${Z},${A},'${sqlEscape(element)}',${sqlVal(r1?.S2n_keV ?? null)},${sqlVal(r1?.S2n_unc_keV ?? null)},${sqlVal(r1?.S2p_keV ?? null)},${sqlVal(r1?.S2p_unc_keV ?? null)},${sqlVal(r1?.Qa_keV ?? null)},${sqlVal(r1?.Qa_unc_keV ?? null)},${sqlVal(r1?.Q2bm_keV ?? null)},${sqlVal(r1?.Q2bm_unc_keV ?? null)},${sqlVal(r1?.Qep_keV ?? null)},${sqlVal(r1?.Qep_unc_keV ?? null)},${sqlVal(r1?.Qbn_keV ?? null)},${sqlVal(r1?.Qbn_unc_keV ?? null)},${sqlVal(r2?.Sn_keV ?? null)},${sqlVal(r2?.Sn_unc_keV ?? null)},${sqlVal(r2?.Sp_keV ?? null)},${sqlVal(r2?.Sp_unc_keV ?? null)},${sqlVal(r2?.Q4bm_keV ?? null)},${sqlVal(r2?.Q4bm_unc_keV ?? null)},${sqlVal(r2?.Qda_keV ?? null)},${sqlVal(r2?.Qda_unc_keV ?? null)},${sqlVal(r2?.Qpa_keV ?? null)},${sqlVal(r2?.Qpa_unc_keV ?? null)},${sqlVal(r2?.Qna_keV ?? null)},${sqlVal(r2?.Qna_unc_keV ?? null)});`
      );
    }

    for (let i = 0; i < reactionInserts.length; i += BATCH_SIZE) {
      const batch = reactionInserts.slice(i, i + BATCH_SIZE);
      executeSql(tmpPath, `BEGIN;\n${batch.join('\n')}\nCOMMIT;`);
    }

    // -- nubase --
    for (let i = 0; i < nubaseRows.length; i += BATCH_SIZE) {
      const batch = nubaseRows.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(r =>
        `INSERT OR REPLACE INTO nubase VALUES(${r.Z},${r.A},'${sqlEscape(r.element)}',${r.isomer_index},${sqlVal(r.mass_excess_keV)},${sqlVal(r.mass_excess_unc_keV)},${sqlVal(r.excitation_energy_keV)},'${sqlEscape(r.half_life)}',${sqlVal(r.half_life_seconds)},${sqlVal(r.half_life_unc_seconds)},'${sqlEscape(r.spin_parity)}','${sqlEscape(r.decay_modes)}',${sqlVal(r.is_estimated)});`
      );
      executeSql(tmpPath, `BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
    }

    // -- charge_radii --
    for (let i = 0; i < radiiRows.length; i += BATCH_SIZE) {
      const batch = radiiRows.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(r =>
        `INSERT OR REPLACE INTO charge_radii VALUES(${r.Z},${r.A},'${sqlEscape(r.element)}',${sqlVal(r.r_charge_fm)},${sqlVal(r.r_charge_unc_fm)},${sqlVal(r.r_charge_preliminary_fm)},${sqlVal(r.r_charge_preliminary_unc_fm)});`
      );
      executeSql(tmpPath, `BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
    }
    radiiCount = radiiRows.length;

    // -- ENSDF --
    const ensdfCounts = ingestEnsdfFiles(tmpPath, path.join(dataDir, 'ensdf'));

    // -- Laser radii (Li et al. 2021) --
    const laserRadiiPath = path.join(dataDir, 'laser_radii', 'Radii.tex');
    const laserCounts = ingestLaserRadii(tmpPath, laserRadiiPath);

    // -- TUNL energy levels (A ≤ 20) --
    const tunlCount = ingestTunlLevels(tmpPath, path.join(dataDir, 'tunl'));

    // -- CODATA constants --
    const codataSource = resolveCodataSource(dataDir);
    const codata = await ingestCodata(tmpPath, codataSource);

    // Indexes
    executeSql(tmpPath, INDEX_SQL);

    // Metadata
    const now = new Date().toISOString();
    executeSql(tmpPath, `
      INSERT OR REPLACE INTO nds_meta VALUES('ame_version','AME2020');
      INSERT OR REPLACE INTO nds_meta VALUES('nubase_version','NUBASE2020');
      INSERT OR REPLACE INTO nds_meta VALUES('radii_version','IAEA-2024');
      INSERT OR REPLACE INTO nds_meta VALUES('build_date','${now}');
      INSERT OR REPLACE INTO nds_meta VALUES('ame_masses_count','${masses.length}');
      INSERT OR REPLACE INTO nds_meta VALUES('ame_reactions_count','${reactionKeys.size}');
      INSERT OR REPLACE INTO nds_meta VALUES('nubase_count','${nubaseRows.length}');
      INSERT OR REPLACE INTO nds_meta VALUES('radii_count','${radiiCount}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_version','ENSDF-2024');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_references_count','${ensdfCounts.references}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_datasets_count','${ensdfCounts.datasets}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_levels_count','${ensdfCounts.levels}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_gammas_count','${ensdfCounts.gammas}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_feedings_count','${ensdfCounts.feedings}');
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_version','Li2021');
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_count','${laserCounts.rows}');
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_refs_count','${laserCounts.refs}');
      INSERT OR REPLACE INTO nds_meta VALUES('tunl_version','TUNL-2024');
      INSERT OR REPLACE INTO nds_meta VALUES('tunl_levels_count','${tunlCount}');
      INSERT OR REPLACE INTO nds_meta VALUES('codata_version','${codata.upstream_version_or_snapshot}');
      INSERT OR REPLACE INTO nds_meta VALUES('codata_count','${codata.constants}');
      INSERT OR REPLACE INTO nds_meta VALUES('codata_source_kind','${codata.source_kind}');
    `);

    // Atomic rename: replace old DB only on complete success
    fs.renameSync(tmpPath, outputPath);

    return {
      masses: masses.length,
      rct1: rct1Rows.length,
      rct2: rct2Rows.length,
      nubase: nubaseRows.length,
      radii: radiiCount,
      laserRadii: laserCounts.rows,
      ensdf: ensdfCounts,
      tunl: tunlCount,
      codata: codata.constants,
    };
  } catch (err) {
    // Clean up partial temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ── ENSDF-only mode: add ENSDF data to an existing database ─────────────────

export function addEnsdfToDatabase(dbPath: string, ensdfDir: string): {
  references: number; datasets: number; levels: number; gammas: number; feedings: number;
} {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  if (!fs.existsSync(ensdfDir)) {
    throw new Error(`ENSDF directory not found: ${ensdfDir}`);
  }

  // Atomic: work on a temp copy, rename on success
  const tmpPath = `${dbPath}.tmp.${Date.now()}`;
  fs.copyFileSync(dbPath, tmpPath);

  try {
    // Create ENSDF tables (IF NOT EXISTS — safe for existing DB)
    executeSql(tmpPath, ENSDF_SCHEMA_SQL);

    // Ingest (clears previous ENSDF data first for idempotency)
    const counts = ingestEnsdfFiles(tmpPath, ensdfDir);

    // Indexes AFTER bulk insert (performance: no B-tree rebalance during inserts)
    executeSql(tmpPath, ENSDF_INDEX_SQL);

    // Update metadata
    const now = new Date().toISOString();
    executeSql(tmpPath, `
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_version','ENSDF-2024');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_build_date','${now}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_references_count','${counts.references}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_datasets_count','${counts.datasets}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_levels_count','${counts.levels}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_gammas_count','${counts.gammas}');
      INSERT OR REPLACE INTO nds_meta VALUES('ensdf_feedings_count','${counts.feedings}');
    `);

    // Atomic replace
    fs.renameSync(tmpPath, dbPath);
    return counts;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ── Laser-radii-only mode: add laser radii to an existing database ──────────

export function addLaserRadiiToDatabase(dbPath: string, texPath: string): { rows: number; refs: number } {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  if (!fs.existsSync(texPath)) {
    throw new Error(`Laser radii file not found: ${texPath}`);
  }

  // Atomic: work on a temp copy, rename on success
  const tmpPath = `${dbPath}.tmp.${Date.now()}`;
  fs.copyFileSync(dbPath, tmpPath);

  try {
    executeSql(tmpPath, LASER_RADII_SCHEMA_SQL);
    const counts = ingestLaserRadii(tmpPath, texPath);
    executeSql(tmpPath, LASER_RADII_INDEX_SQL);

    const now = new Date().toISOString();
    executeSql(tmpPath, `
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_version','Li2021');
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_build_date','${now}');
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_count','${counts.rows}');
      INSERT OR REPLACE INTO nds_meta VALUES('laser_radii_refs_count','${counts.refs}');
    `);

    fs.renameSync(tmpPath, dbPath);
    return counts;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ── TUNL-only mode: add TUNL levels to an existing database ─────────────────

export function addTunlToDatabase(dbPath: string, tunlDir: string): number {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  if (!fs.existsSync(tunlDir)) {
    throw new Error(`TUNL directory not found: ${tunlDir}`);
  }

  const tmpPath = `${dbPath}.tmp.${Date.now()}`;
  fs.copyFileSync(dbPath, tmpPath);

  try {
    // Drop old tunl_levels table (schema may have changed) and recreate
    executeSql(tmpPath, `DROP TABLE IF EXISTS tunl_levels;`);
    executeSql(tmpPath, TUNL_SCHEMA_SQL);
    const count = ingestTunlLevels(tmpPath, tunlDir);
    executeSql(tmpPath, TUNL_INDEX_SQL);

    const now = new Date().toISOString();
    executeSql(tmpPath, `
      INSERT OR REPLACE INTO nds_meta VALUES('tunl_version','TUNL-2024');
      INSERT OR REPLACE INTO nds_meta VALUES('tunl_build_date','${now}');
      INSERT OR REPLACE INTO nds_meta VALUES('tunl_levels_count','${count}');
    `);

    fs.renameSync(tmpPath, dbPath);
    return count;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
if (process.argv[1] && (process.argv[1].endsWith('buildDb.ts') || process.argv[1].endsWith('buildDb.js'))) {
  const args = process.argv.slice(2);
  let dataDir = '';
  let output = '';
  let ensdfOnly = false;
  let laserRadiiOnly = false;
  let tunlOnly = false;
  let db = '';
  let ensdfDir = '';
  let texFile = '';
  let tunlDir = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) { dataDir = args[i + 1]!; i++; }
    else if (args[i] === '--output' && args[i + 1]) { output = args[i + 1]!; i++; }
    else if (args[i] === '--ensdf-only') { ensdfOnly = true; }
    else if (args[i] === '--laser-radii-only') { laserRadiiOnly = true; }
    else if (args[i] === '--tunl-only') { tunlOnly = true; }
    else if (args[i] === '--db' && args[i + 1]) { db = args[i + 1]!; i++; }
    else if (args[i] === '--ensdf-dir' && args[i + 1]) { ensdfDir = args[i + 1]!; i++; }
    else if (args[i] === '--tex-file' && args[i + 1]) { texFile = args[i + 1]!; i++; }
    else if (args[i] === '--tunl-dir' && args[i + 1]) { tunlDir = args[i + 1]!; i++; }
  }

  if (tunlOnly) {
    if (!db || !tunlDir) {
      console.error('Usage: buildDb --tunl-only --db <path> --tunl-dir <dir>');
      process.exit(1);
    }
    console.error(`Adding TUNL levels to ${db} from ${tunlDir}`);
    const count = addTunlToDatabase(db, tunlDir);
    console.error(`TUNL done: ${count} levels`);
    const size = fs.statSync(db).size;
    console.error(`Database size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  } else if (laserRadiiOnly) {
    if (!db || !texFile) {
      console.error('Usage: buildDb --laser-radii-only --db <path> --tex-file <path>');
      process.exit(1);
    }
    console.error(`Adding laser radii to ${db} from ${texFile}`);
    const counts = addLaserRadiiToDatabase(db, texFile);
    console.error(`Laser radii done: rows=${counts.rows}, refs=${counts.refs}`);
    const size = fs.statSync(db).size;
    console.error(`Database size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  } else if (ensdfOnly) {
    if (!db || !ensdfDir) {
      console.error('Usage: buildDb --ensdf-only --db <path> --ensdf-dir <dir>');
      process.exit(1);
    }
    console.error(`Adding ENSDF data to ${db} from ${ensdfDir}`);
    const counts = addEnsdfToDatabase(db, ensdfDir);
    console.error(`ENSDF done: refs=${counts.references}, datasets=${counts.datasets}, levels=${counts.levels}, gammas=${counts.gammas}, feedings=${counts.feedings}`);
    const size = fs.statSync(db).size;
    console.error(`Database size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  } else {
    if (!dataDir || !output) {
      console.error('Usage: buildDb --data-dir <dir> --output <path>');
      process.exit(1);
    }
    console.error(`Building NDS database from ${dataDir} → ${output}`);
    buildDatabase(dataDir, output)
      .then((counts) => {
        console.error(
          `Done: masses=${counts.masses}, rct1=${counts.rct1}, rct2=${counts.rct2}, nubase=${counts.nubase}, ` +
          `radii=${counts.radii}, laserRadii=${counts.laserRadii}, tunl=${counts.tunl}, codata=${counts.codata}`,
        );
        console.error(
          `ENSDF: refs=${counts.ensdf.references}, datasets=${counts.ensdf.datasets}, ` +
          `levels=${counts.ensdf.levels}, gammas=${counts.ensdf.gammas}, feedings=${counts.ensdf.feedings}`,
        );
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  }
}
