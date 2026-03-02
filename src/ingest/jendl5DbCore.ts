import * as fs from 'fs';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import { parseJendl5DecArchive, parseJendl5DecJsonl, type Jendl5DecayRecord } from './parseJendl5Dec.js';
import {
  parseJendl5XsArchiveFile,
  parseJendl5XsDirectoryRecords,
  parseJendl5XsFile,
  parseJendl5XsEndfText,
  parseJendl5XsJsonl,
  type Jendl5XsRecord,
} from './parseJendl5Xs.js';

export function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function sqlNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return Number.isFinite(value) ? String(value) : 'NULL';
}

export function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', ['-bail', dbPath], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

export function ensureJendl5Schema(dbPath: string): void {
  runSql(
    dbPath,
    `
CREATE TABLE IF NOT EXISTS jendl5_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jendl5_decays (
  id INTEGER PRIMARY KEY,
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  half_life_s REAL,
  stable INTEGER NOT NULL DEFAULT 0,
  ndk INTEGER NOT NULL,
  UNIQUE(Z, A, state)
);
CREATE TABLE IF NOT EXISTS jendl5_decay_modes (
  id INTEGER PRIMARY KEY,
  decay_id INTEGER NOT NULL REFERENCES jendl5_decays(id),
  rtyp REAL NOT NULL,
  mode_label TEXT NOT NULL,
  q_keV REAL,
  br REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS jendl5_radiation (
  id INTEGER PRIMARY KEY,
  decay_id INTEGER NOT NULL REFERENCES jendl5_decays(id),
  styp REAL NOT NULL,
  type_label TEXT NOT NULL,
  lcon INTEGER NOT NULL,
  component_kind TEXT NOT NULL,
  energy_keV REAL,
  energy_unc_keV REAL,
  endpoint_keV REAL,
  intensity REAL,
  intensity_unc REAL
);
CREATE TABLE IF NOT EXISTS jendl5_xs_meta (
  id INTEGER PRIMARY KEY,
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  projectile TEXT NOT NULL,
  mt INTEGER NOT NULL,
  reaction TEXT NOT NULL,
  e_min_eV REAL NOT NULL,
  e_max_eV REAL NOT NULL,
  n_points INTEGER NOT NULL,
  UNIQUE(Z, A, state, projectile, mt)
);
CREATE TABLE IF NOT EXISTS jendl5_xs_points (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL REFERENCES jendl5_xs_meta(id),
  point_index INTEGER NOT NULL,
  e_eV REAL NOT NULL,
  sigma_b REAL NOT NULL,
  UNIQUE(xs_id, point_index)
);
CREATE TABLE IF NOT EXISTS jendl5_xs_interp (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL REFERENCES jendl5_xs_meta(id),
  nbt INTEGER NOT NULL,
  int_law INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jendl5_decays_za ON jendl5_decays(Z, A, state);
CREATE INDEX IF NOT EXISTS idx_jendl5_radiation_decay ON jendl5_radiation(decay_id);
CREATE INDEX IF NOT EXISTS idx_jendl5_decay_modes_decay ON jendl5_decay_modes(decay_id);
CREATE INDEX IF NOT EXISTS idx_jendl5_xs_meta_za ON jendl5_xs_meta(Z, A, projectile, state);
CREATE INDEX IF NOT EXISTS idx_jendl5_xs_points_xs ON jendl5_xs_points(xs_id, e_eV);
`,
  );
}

export async function loadDecayRecords(sourcePath: string): Promise<Jendl5DecayRecord[]> {
  const content = fs.readFileSync(sourcePath);
  if (sourcePath.endsWith('.tar.gz') || sourcePath.endsWith('.tgz')) {
    const records: Jendl5DecayRecord[] = [];
    for await (const record of parseJendl5DecArchive(content)) {
      records.push(record);
    }
    return records;
  }
  return parseJendl5DecJsonl(content.toString('utf-8'));
}

export async function loadXsRecords(sourcePath: string): Promise<Jendl5XsRecord[]> {
  const records: Jendl5XsRecord[] = [];
  for await (const record of streamXsRecords(sourcePath)) {
    records.push(record);
  }
  return records;
}

export async function* streamXsRecords(sourcePath: string): AsyncIterable<Jendl5XsRecord> {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    for (const record of parseJendl5XsDirectoryRecords(sourcePath)) {
      yield record;
    }
    return;
  }
  if (sourcePath.endsWith('.tar.gz') || sourcePath.endsWith('.tgz')) {
    for await (const record of parseJendl5XsArchiveFile(sourcePath)) {
      yield record;
    }
    return;
  }
  const content = fs.readFileSync(sourcePath);
  if (sourcePath.endsWith('.jsonl')) {
    for (const record of parseJendl5XsJsonl(content.toString('utf-8'))) {
      yield record;
    }
    return;
  }
  if (sourcePath.endsWith('.json')) {
    yield parseJendl5XsFile(content.toString('utf-8'));
    return;
  }
  if (sourcePath.endsWith('.gz')) {
    for (const record of parseJendl5XsEndfText(zlib.gunzipSync(content).toString('utf-8'), { sourceName: sourcePath })) {
      yield record;
    }
    return;
  }
  if (/\.(dat|endf|txt)$/i.test(sourcePath)) {
    for (const record of parseJendl5XsEndfText(content.toString('utf-8'), { sourceName: sourcePath })) {
      yield record;
    }
    return;
  }
  for (const record of parseJendl5XsJsonl(content.toString('utf-8'))) {
    yield record;
  }
}
