import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { buildRequiredLibraryMeta, detectSourceKind, normalizeMetaValues } from './metaContract.js';

interface DdepHalfLifeInput {
  value?: number;
  uncertainty?: number;
  unit?: string;
  seconds?: number;
}

interface DdepLineInput {
  type: string;
  energy_keV?: number;
  energy_unc_keV?: number;
  intensity?: number;
  intensity_unc?: number;
  is_primary?: boolean;
}

interface DdepRecordInput {
  Z: number;
  A: number;
  state?: number;
  nuclide?: string;
  half_life?: DdepHalfLifeInput;
  half_life_value?: number;
  half_life_uncertainty?: number;
  half_life_unit?: string;
  half_life_seconds?: number;
  decay_mode?: string;
  source_label?: string;
  evaluation_date?: string;
  doi?: string;
  lines?: DdepLineInput[];
  radiation?: DdepLineInput[];
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlNum(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return 'NULL';
  return String(value);
}

function sqlText(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) return 'NULL';
  return `'${sqlEscape(value.trim())}'`;
}

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

function hasTable(dbPath: string, tableName: string): boolean {
  const result = execFileSync(
    'sqlite3',
    [dbPath, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${tableName.replaceAll("'", "''")}';`],
    { encoding: 'utf-8' },
  ).trim();
  return Number(result) > 0;
}

function readMetaTable(dbPath: string, tableName: string): Record<string, string> {
  const output = execFileSync(
    'sqlite3',
    ['-separator', '\t', dbPath, `SELECT key, value FROM ${tableName} ORDER BY key;`],
    { encoding: 'utf-8' },
  ).trim();
  const rows = output.length === 0 ? [] : output.split('\n');
  const meta: Record<string, string> = {};
  for (const row of rows) {
    const [key, value = ''] = row.split('\t');
    meta[key!] = value;
  }
  return meta;
}

function replaceMetaTable(dbPath: string, tableName: string, meta: Record<string, string>): void {
  const inserts = Object.entries(meta)
    .map(([key, value]) => (
      `INSERT OR REPLACE INTO ${tableName}(key, value) VALUES ('${sqlEscape(key)}', '${sqlEscape(value)}');`
    ))
    .join('\n');
  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM ${tableName};
${inserts}
COMMIT;
`,
  );
}

function ensureSchema(dbPath: string): void {
  runSql(
    dbPath,
    `
CREATE TABLE IF NOT EXISTS ddep_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ddep_nuclides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  nuclide TEXT NOT NULL,
  half_life_value REAL,
  half_life_uncertainty REAL,
  half_life_unit TEXT,
  half_life_seconds REAL,
  decay_mode TEXT,
  source_label TEXT,
  evaluation_date TEXT,
  doi TEXT
);
CREATE TABLE IF NOT EXISTS ddep_radiation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nuclide_id INTEGER NOT NULL,
  radiation_type TEXT NOT NULL,
  energy_keV REAL,
  energy_unc_keV REAL,
  intensity REAL,
  intensity_unc REAL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(nuclide_id) REFERENCES ddep_nuclides(id)
);
CREATE INDEX IF NOT EXISTS idx_ddep_nuclides_za_state ON ddep_nuclides(Z, A, state);
CREATE INDEX IF NOT EXISTS idx_ddep_radiation_nuclide ON ddep_radiation(nuclide_id);
CREATE INDEX IF NOT EXISTS idx_ddep_radiation_type ON ddep_radiation(radiation_type);
`,
  );
}

function normalizeNuclideLabel(record: DdepRecordInput): string {
  if (record.nuclide && record.nuclide.trim().length > 0) return record.nuclide.trim();
  return `Z${record.Z}-A${record.A}`;
}

function importFromJsonl(dbPath: string, sourcePath: string): { nuclides: number; lines: number } {
  const content = fs.readFileSync(sourcePath, 'utf-8');
  runSql(dbPath, 'BEGIN; DELETE FROM ddep_radiation; DELETE FROM ddep_nuclides; COMMIT;');

  let nuclides = 0;
  let lines = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const record = JSON.parse(line) as DdepRecordInput;
    if (!Number.isInteger(record.Z) || !Number.isInteger(record.A)) {
      throw new Error('Invalid DDEP JSONL record: Z/A must be integers');
    }
    const state = record.state ?? 0;
    const halfLife = record.half_life;
    const halfLifeValue = halfLife?.value ?? record.half_life_value;
    const halfLifeUncertainty = halfLife?.uncertainty ?? record.half_life_uncertainty;
    const halfLifeUnit = halfLife?.unit ?? record.half_life_unit;
    const halfLifeSeconds = halfLife?.seconds ?? record.half_life_seconds;

    runSql(
      dbPath,
      `INSERT INTO ddep_nuclides(
        Z, A, state, nuclide, half_life_value, half_life_uncertainty, half_life_unit, half_life_seconds,
        decay_mode, source_label, evaluation_date, doi
      ) VALUES (
        ${record.Z}, ${record.A}, ${state}, '${sqlEscape(normalizeNuclideLabel(record))}',
        ${sqlNum(halfLifeValue)}, ${sqlNum(halfLifeUncertainty)}, ${sqlText(halfLifeUnit)}, ${sqlNum(halfLifeSeconds)},
        ${sqlText(record.decay_mode)}, ${sqlText(record.source_label)}, ${sqlText(record.evaluation_date)}, ${sqlText(record.doi)}
      );`,
    );

    const nuclideId = Number(
      execFileSync(
        'sqlite3',
        [dbPath, 'SELECT id FROM ddep_nuclides ORDER BY id DESC LIMIT 1;'],
        { encoding: 'utf-8' },
      ).trim(),
    );
    nuclides += 1;

    const radiation = record.lines ?? record.radiation ?? [];
    for (const item of radiation) {
      if (!item.type || item.type.trim().length === 0) {
        throw new Error('Invalid DDEP JSONL line: radiation type is required');
      }
      runSql(
        dbPath,
        `INSERT INTO ddep_radiation(
          nuclide_id, radiation_type, energy_keV, energy_unc_keV, intensity, intensity_unc, is_primary
        ) VALUES (
          ${nuclideId}, '${sqlEscape(item.type.trim())}', ${sqlNum(item.energy_keV)}, ${sqlNum(item.energy_unc_keV)},
          ${sqlNum(item.intensity)}, ${sqlNum(item.intensity_unc)}, ${item.is_primary ? 1 : 0}
        );`,
      );
      lines += 1;
    }
  }

  return { nuclides, lines };
}

function importFromSqlite(dbPath: string, sourcePath: string): { nuclides: number; lines: number; meta: Record<string, string> } {
  const normalized = hasTable(sourcePath, 'ddep_nuclides') && hasTable(sourcePath, 'ddep_radiation');
  if (!normalized) {
    throw new Error(
      'Unsupported DDEP sqlite schema. Expected ddep_nuclides + ddep_radiation tables. ' +
      'Inspect schema with: sqlite3 <source> ".schema"',
    );
  }
  const sourceMeta = hasTable(sourcePath, 'ddep_meta') ? readMetaTable(sourcePath, 'ddep_meta') : {};

  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM ddep_radiation;
DELETE FROM ddep_nuclides;
ATTACH '${sqlEscape(sourcePath)}' AS src;
INSERT INTO ddep_nuclides(id, Z, A, state, nuclide, half_life_value, half_life_uncertainty, half_life_unit, half_life_seconds, decay_mode, source_label, evaluation_date, doi)
SELECT id, Z, A, state, nuclide, half_life_value, half_life_uncertainty, half_life_unit, half_life_seconds, decay_mode, source_label, evaluation_date, doi
FROM src.ddep_nuclides;
INSERT INTO ddep_radiation(id, nuclide_id, radiation_type, energy_keV, energy_unc_keV, intensity, intensity_unc, is_primary)
SELECT id, nuclide_id, radiation_type, energy_keV, energy_unc_keV, intensity, intensity_unc, is_primary
FROM src.ddep_radiation;
DETACH src;
COMMIT;
`,
  );

  const nuclides = Number(execFileSync('sqlite3', [dbPath, 'SELECT COUNT(*) FROM ddep_nuclides;'], { encoding: 'utf-8' }).trim());
  const lines = Number(execFileSync('sqlite3', [dbPath, 'SELECT COUNT(*) FROM ddep_radiation;'], { encoding: 'utf-8' }).trim());
  return { nuclides, lines, meta: sourceMeta };
}

export async function ingestDdep(
  dbPath: string,
  sourcePath: string,
  ddepRelease: string,
): Promise<{ nuclides: number; lines: number }> {
  ensureSchema(dbPath);
  const sourceKind = detectSourceKind(sourcePath);
  let sourceMeta: Record<string, string> = {};
  let stats: { nuclides: number; lines: number };

  if (sourceKind === 'imported_sqlite') {
    const result = importFromSqlite(dbPath, sourcePath);
    stats = { nuclides: result.nuclides, lines: result.lines };
    sourceMeta = result.meta;
  } else {
    stats = importFromJsonl(dbPath, sourcePath);
  }

  sourceMeta = normalizeMetaValues(sourceMeta);
  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind,
    upstreamName: 'DDEP',
    upstreamUrl: 'https://www.lnhb.fr/ddep-wg/',
    upstreamVersionOrSnapshot: sourceMeta.upstream_version_or_snapshot ?? ddepRelease,
  });

  replaceMetaTable(dbPath, 'ddep_meta', {
    ...sourceMeta,
    ...requiredMeta,
    ddep_schema_version: '1',
    ddep_release: ddepRelease,
  });

  return stats;
}
