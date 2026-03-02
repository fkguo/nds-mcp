import { execFileSync } from 'child_process';
import { buildRequiredLibraryMeta, detectSourceKind } from './metaContract.js';
import { runSql, sqlEscape, streamXsRecords } from './jendl5DbCore.js';

function buildMetaUpsertSql(tableName: string, meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([key, value]) => (
      `INSERT OR REPLACE INTO ${tableName}(key, value) VALUES ('${sqlEscape(key)}', '${sqlEscape(value)}');`
    ))
    .join('\n');
}

export function ensureIrdffSchema(dbPath: string): void {
  runSql(
    dbPath,
    `
CREATE TABLE IF NOT EXISTS irdff_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS irdff_xs_meta (
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
CREATE TABLE IF NOT EXISTS irdff_xs_points (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL REFERENCES irdff_xs_meta(id),
  point_index INTEGER NOT NULL,
  e_eV REAL NOT NULL,
  sigma_b REAL NOT NULL,
  UNIQUE(xs_id, point_index)
);
CREATE TABLE IF NOT EXISTS irdff_xs_interp (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL REFERENCES irdff_xs_meta(id),
  nbt INTEGER NOT NULL,
  int_law INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_irdff_xs_meta_za ON irdff_xs_meta(Z, A, projectile, state);
CREATE INDEX IF NOT EXISTS idx_irdff_xs_points_xs ON irdff_xs_points(xs_id, e_eV);
`,
  );
}

function validateXsRecord(record: {
  Z: number;
  A: number;
  state: number;
  projectile: string;
  mt: number;
  reaction: string;
  points: Array<{ point_index: number; e_eV: number; sigma_b: number }>;
  interp: Array<{ nbt: number; int_law: number }>;
}): { eMin: number; eMax: number } {
  if (!Number.isInteger(record.Z) || record.Z < 0) throw new Error(`Invalid XS record Z=${record.Z}`);
  if (!Number.isInteger(record.A) || record.A < 0) throw new Error(`Invalid XS record A=${record.A}`);
  if (!Number.isInteger(record.state) || record.state < 0) throw new Error(`Invalid XS record state=${record.state}`);
  if (record.projectile !== 'n') {
    throw new Error(`Invalid IRDFF projectile=${record.projectile}; only neutron data are expected`);
  }
  if (!Number.isInteger(record.mt) || record.mt <= 0) throw new Error(`Invalid XS MT=${record.mt}`);
  if (record.reaction.trim().length === 0) throw new Error('Invalid XS reaction label (empty)');
  if (record.points.length < 2) throw new Error(`Invalid XS points for MT=${record.mt}: need at least 2`);
  if (record.interp.length < 1) throw new Error(`Invalid XS interpolation for MT=${record.mt}: need at least 1 segment`);

  let prevE = Number.NEGATIVE_INFINITY;
  for (const point of record.points) {
    if (!Number.isFinite(point.e_eV) || !Number.isFinite(point.sigma_b)) {
      throw new Error(`Invalid XS point in MT=${record.mt}: non-finite value`);
    }
    if (point.e_eV < prevE) {
      throw new Error(`Invalid XS energy grid in MT=${record.mt}: non-monotonic`);
    }
    prevE = point.e_eV;
  }

  const eMin = record.points[0]!.e_eV;
  const eMax = record.points[record.points.length - 1]!.e_eV;
  if (eMax < eMin) throw new Error(`Invalid XS energy range in MT=${record.mt}`);
  return { eMin, eMax };
}

export async function ingestIrdff2(
  dbPath: string,
  sourcePath: string,
  version = 'IRDFF-II',
): Promise<{ reactions: number }> {
  ensureIrdffSchema(dbPath);
  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind: detectSourceKind(sourcePath),
    upstreamName: 'IRDFF-II',
    upstreamUrl: 'https://www-nds.iaea.org/IRDFF/',
    upstreamVersionOrSnapshot: version,
  });

  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM irdff_xs_meta;
DELETE FROM irdff_xs_points;
DELETE FROM irdff_xs_interp;
${buildMetaUpsertSql('irdff_meta', requiredMeta)}
INSERT OR REPLACE INTO irdff_meta(key, value) VALUES ('irdff_schema_version', '1');
INSERT OR REPLACE INTO irdff_meta(key, value) VALUES ('irdff_version', '${sqlEscape(version)}');
COMMIT;
`,
  );

  let reactions = 0;
  for await (const record of streamXsRecords(sourcePath)) {
    const validated = validateXsRecord(record);
    const xsId = Number(execFileSync(
      'sqlite3',
      [
        dbPath,
        `INSERT INTO irdff_xs_meta(Z, A, state, projectile, mt, reaction, e_min_eV, e_max_eV, n_points)
         VALUES (${record.Z}, ${record.A}, ${record.state}, '${sqlEscape(record.projectile)}', ${record.mt},
                 '${sqlEscape(record.reaction)}', ${validated.eMin}, ${validated.eMax}, ${record.points.length});
         SELECT last_insert_rowid();`,
      ],
      { encoding: 'utf-8' },
    ).trim());

    const pointChunkSize = 5000;
    for (let start = 0; start < record.points.length; start += pointChunkSize) {
      const chunk = record.points.slice(start, start + pointChunkSize);
      const values = chunk
        .map((point) => `(${xsId}, ${point.point_index}, ${point.e_eV}, ${point.sigma_b})`)
        .join(',\n');
      runSql(
        dbPath,
        `INSERT INTO irdff_xs_points(xs_id, point_index, e_eV, sigma_b) VALUES\n${values};`,
      );
    }

    const interpValues = record.interp
      .map((segment) => `(${xsId}, ${segment.nbt}, ${segment.int_law})`)
      .join(',\n');
    runSql(
      dbPath,
      `INSERT INTO irdff_xs_interp(xs_id, nbt, int_law) VALUES\n${interpValues};`,
    );

    reactions += 1;
    if (reactions % 200 === 0) {
      console.error(`[nds-mcp] IRDFF ingest progress: ${reactions} reactions`);
    }
  }

  if (reactions === 0) {
    throw new Error(`No IRDFF XS records were ingested from source: ${sourcePath}`);
  }

  return { reactions };
}
