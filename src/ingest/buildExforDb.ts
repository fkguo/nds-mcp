import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { buildRequiredLibraryMeta, detectSourceKind, normalizeMetaValues } from './metaContract.js';

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

function ensureSchema(dbPath: string): void {
  runSql(
    dbPath,
    `
CREATE TABLE IF NOT EXISTS exfor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exfor_entries (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  target_Z INTEGER NOT NULL,
  target_A INTEGER,
  state INTEGER NOT NULL DEFAULT 0,
  projectile TEXT NOT NULL,
  reaction TEXT,
  quantity TEXT NOT NULL,
  reference TEXT,
  year INTEGER,
  PRIMARY KEY(entry_id, subentry_id)
);
CREATE TABLE IF NOT EXISTS exfor_points (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  energy_eV REAL,
  kT_keV REAL,
  value REAL,
  uncertainty REAL,
  FOREIGN KEY(entry_id, subentry_id) REFERENCES exfor_entries(entry_id, subentry_id)
);
CREATE INDEX IF NOT EXISTS idx_exfor_entries_lookup ON exfor_entries(target_Z, target_A, state, projectile, quantity);
CREATE INDEX IF NOT EXISTS idx_exfor_points_lookup ON exfor_points(entry_id, subentry_id, point_index);
`,
  );
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

function importFromSqlite(dbPath: string, sourcePath: string): Record<string, string> {
  const normalized = hasTable(sourcePath, 'exfor_entries') && hasTable(sourcePath, 'exfor_points');
  if (!normalized) {
    throw new Error(
      'Unsupported EXFOR sqlite schema. Expected exfor_entries + exfor_points tables. ' +
      'Inspect schema with: sqlite3 <source> ".schema"',
    );
  }
  const sourceMeta = hasTable(sourcePath, 'exfor_meta') ? readMetaTable(sourcePath, 'exfor_meta') : {};

  runSql(
    dbPath,
    `
ATTACH '${sqlEscape(sourcePath)}' AS src;
DELETE FROM exfor_entries;
DELETE FROM exfor_points;
INSERT INTO exfor_entries SELECT * FROM src.exfor_entries;
INSERT INTO exfor_points SELECT * FROM src.exfor_points;
DETACH src;
`,
  );
  return sourceMeta;
}

function importFromJsonl(dbPath: string, sourcePath: string): void {
  const content = fs.readFileSync(sourcePath, 'utf-8');
  runSql(dbPath, 'BEGIN; DELETE FROM exfor_entries; DELETE FROM exfor_points; COMMIT;');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const record = JSON.parse(line) as {
      entry_id: string;
      subentry_id: string;
      target_Z: number;
      target_A?: number;
      state?: number;
      projectile: string;
      reaction?: string;
      quantity: string;
      reference?: string;
      year?: number;
      points: Array<{ point_index: number; energy_eV?: number; kT_keV?: number; value?: number; uncertainty?: number }>;
    };

    runSql(
      dbPath,
      `INSERT INTO exfor_entries(entry_id, subentry_id, target_Z, target_A, state, projectile, reaction, quantity, reference, year)
       VALUES ('${sqlEscape(record.entry_id)}', '${sqlEscape(record.subentry_id)}', ${record.target_Z},
               ${record.target_A ?? 'NULL'}, ${record.state ?? 0}, '${sqlEscape(record.projectile)}',
               ${record.reaction ? `'${sqlEscape(record.reaction)}'` : 'NULL'},
               '${sqlEscape(record.quantity)}',
               ${record.reference ? `'${sqlEscape(record.reference)}'` : 'NULL'},
               ${record.year ?? 'NULL'});`,
    );

    for (const point of record.points) {
      runSql(
        dbPath,
        `INSERT INTO exfor_points(entry_id, subentry_id, point_index, energy_eV, kT_keV, value, uncertainty)
         VALUES ('${sqlEscape(record.entry_id)}', '${sqlEscape(record.subentry_id)}', ${point.point_index},
                 ${point.energy_eV ?? 'NULL'}, ${point.kT_keV ?? 'NULL'}, ${point.value ?? 'NULL'}, ${point.uncertainty ?? 'NULL'});`,
      );
    }
  }
}

export async function ingestExfor(dbPath: string, sourcePath: string): Promise<{ entries: number }> {
  ensureSchema(dbPath);
  const sourceKind = detectSourceKind(sourcePath);
  let sourceMeta: Record<string, string> = {};

  if (sourceKind === 'imported_sqlite') {
    sourceMeta = importFromSqlite(dbPath, sourcePath);
  } else {
    importFromJsonl(dbPath, sourcePath);
  }

  sourceMeta = normalizeMetaValues(sourceMeta);
  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind,
    upstreamName: 'EXFOR',
    upstreamUrl: 'https://www-nds.iaea.org/exfor/',
    upstreamVersionOrSnapshot: sourceMeta.upstream_version_or_snapshot,
  });
  replaceMetaTable(dbPath, 'exfor_meta', {
    ...sourceMeta,
    ...requiredMeta,
  });

  const count = Number(execFileSync('sqlite3', [dbPath, 'SELECT COUNT(*) FROM exfor_entries;'], { encoding: 'utf-8' }).trim());
  return { entries: count };
}
