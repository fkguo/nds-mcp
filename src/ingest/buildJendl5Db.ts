import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ensureJendl5Schema, loadDecayRecords, runSql, sqlEscape, sqlNum, streamXsRecords } from './jendl5DbCore.js';
import { buildRequiredLibraryMeta, detectSourceKind } from './metaContract.js';

function buildMetaUpsertSql(tableName: string, meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([key, value]) => (
      `INSERT OR REPLACE INTO ${tableName}(key, value) VALUES ('${sqlEscape(key)}', '${sqlEscape(value)}');`
    ))
    .join('\n');
}

function validateXsRecord(record: {
  Z: number;
  A: number;
  state: number;
  projectile: 'n' | 'p';
  mt: number;
  reaction: string;
  points: Array<{ point_index: number; e_eV: number; sigma_b: number }>;
  interp: Array<{ nbt: number; int_law: number }>;
}): { eMin: number; eMax: number } {
  if (!Number.isInteger(record.Z) || record.Z < 0) throw new Error(`Invalid XS record Z=${record.Z}`);
  if (!Number.isInteger(record.A) || record.A < 0) throw new Error(`Invalid XS record A=${record.A}`);
  if (!Number.isInteger(record.state) || record.state < 0) throw new Error(`Invalid XS record state=${record.state}`);
  if (record.projectile !== 'n' && record.projectile !== 'p') {
    throw new Error(`Invalid XS projectile=${record.projectile}`);
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

export async function ingestJendl5Decay(
  dbPath: string,
  sourcePath: string,
  jendlVersion: string,
): Promise<{ nuclides: number }> {
  ensureJendl5Schema(dbPath);
  const records = await loadDecayRecords(sourcePath);
  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind: detectSourceKind(sourcePath),
    upstreamName: 'JENDL-5',
    upstreamUrl: 'https://wwwndc.jaea.go.jp/jendl/j5/j5.html',
    upstreamVersionOrSnapshot: jendlVersion,
  });

  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM jendl5_decays;
DELETE FROM jendl5_decay_modes;
DELETE FROM jendl5_radiation;
${buildMetaUpsertSql('jendl5_meta', requiredMeta)}
INSERT OR REPLACE INTO jendl5_meta(key, value) VALUES ('dec_schema_version', '1');
INSERT OR REPLACE INTO jendl5_meta(key, value) VALUES ('jendl5_dec_version', '${sqlEscape(jendlVersion)}');
COMMIT;
`,
  );

  for (const record of records) {
    const Z = Math.floor(record.ZA / 1000);
    const A = record.ZA - Z * 1000;
    runSql(
      dbPath,
      `INSERT INTO jendl5_decays(Z, A, state, half_life_s, stable, ndk)
       VALUES (${Z}, ${A}, ${record.LIS}, ${sqlNum(record.halfLifeS)}, ${record.NST === 1 ? 1 : 0}, ${record.decayModes.length});`,
    );
    const idRows = execFileSync(
      'sqlite3',
      [dbPath, `SELECT id FROM jendl5_decays WHERE Z=${Z} AND A=${A} AND state=${record.LIS} LIMIT 1;`],
      { encoding: 'utf-8' },
    ).trim();
    const decayId = Number(idRows);

    for (const mode of record.decayModes) {
      runSql(
        dbPath,
        `INSERT INTO jendl5_decay_modes(decay_id, rtyp, mode_label, q_keV, br)
         VALUES (${decayId}, ${mode.rtyp}, '${sqlEscape(mode.mode_label)}', ${sqlNum(mode.q_keV)}, ${sqlNum(mode.br)});`,
      );
    }
    for (const line of record.spectra) {
      runSql(
        dbPath,
        `INSERT INTO jendl5_radiation(decay_id, styp, type_label, lcon, component_kind, energy_keV, energy_unc_keV, endpoint_keV, intensity, intensity_unc)
         VALUES (${decayId}, ${line.styp}, '${sqlEscape(line.type_label)}', ${line.lcon}, '${sqlEscape(line.component_kind)}',
                 ${sqlNum(line.energy_keV)}, ${sqlNum(line.energy_unc_keV)}, ${sqlNum(line.endpoint_keV)}, ${sqlNum(line.intensity)}, ${sqlNum(line.intensity_unc)});`,
      );
    }
  }

  return { nuclides: records.length };
}

export async function ingestJendl5Xs(
  dbPath: string,
  sourcePath: string,
  xsVersion: string,
): Promise<{ reactions: number }> {
  ensureJendl5Schema(dbPath);
  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind: detectSourceKind(sourcePath),
    upstreamName: 'JENDL-5',
    upstreamUrl: 'https://wwwndc.jaea.go.jp/jendl/j5/j5.html',
    upstreamVersionOrSnapshot: xsVersion,
  });

  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM jendl5_xs_meta;
DELETE FROM jendl5_xs_points;
DELETE FROM jendl5_xs_interp;
${buildMetaUpsertSql('jendl5_meta', requiredMeta)}
INSERT OR REPLACE INTO jendl5_meta(key, value) VALUES ('xs_schema_version', '1');
INSERT OR REPLACE INTO jendl5_meta(key, value) VALUES ('jendl5_xs_version', '${sqlEscape(xsVersion)}');
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
        `INSERT INTO jendl5_xs_meta(Z, A, state, projectile, mt, reaction, e_min_eV, e_max_eV, n_points)
         VALUES (${record.Z}, ${record.A}, ${record.state}, '${record.projectile}', ${record.mt}, '${sqlEscape(record.reaction)}',
                 ${validated.eMin}, ${validated.eMax}, ${record.points.length});
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
        `INSERT INTO jendl5_xs_points(xs_id, point_index, e_eV, sigma_b) VALUES\n${values};`,
      );
    }

    const interpValues = record.interp
      .map((segment) => `(${xsId}, ${segment.nbt}, ${segment.int_law})`)
      .join(',\n');
    runSql(
      dbPath,
      `INSERT INTO jendl5_xs_interp(xs_id, nbt, int_law) VALUES\n${interpValues};`,
    );

    reactions += 1;
    if (reactions % 200 === 0) {
      console.error(`[nds-mcp] JENDL-5 XS ingest progress: ${reactions} reactions`);
    }
  }
  if (reactions === 0) {
    throw new Error(`No XS records were ingested from source: ${sourcePath}`);
  }

  return { reactions };
}

export function atomicWriteSqlite(
  outputPath: string,
  mutator: (tmpPath: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const sqliteQuote = (value: string): string => value.replaceAll("'", "''");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp.${process.pid}`;
  try {
    if (fs.existsSync(outputPath)) {
      execFileSync(
        'sqlite3',
        [outputPath, `.backup '${sqliteQuote(tmpPath)}'`],
        { stdio: 'inherit' },
      );
    } else {
      runSql(tmpPath, 'PRAGMA journal_mode=WAL;');
    }
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    fs.rmSync(`${tmpPath}-wal`, { force: true });
    fs.rmSync(`${tmpPath}-shm`, { force: true });
    throw error;
  }

  return mutator(tmpPath).then((result) => {
    // Ensure DB state is fully materialized in the main file before rename.
    runSql(tmpPath, 'PRAGMA wal_checkpoint(FULL); PRAGMA journal_mode=DELETE;');
    fs.rmSync(`${tmpPath}-wal`, { force: true });
    fs.rmSync(`${tmpPath}-shm`, { force: true });

    // Old sidecars may linger from previous WAL sessions; remove before swap.
    fs.rmSync(`${outputPath}-wal`, { force: true });
    fs.rmSync(`${outputPath}-shm`, { force: true });
    fs.renameSync(tmpPath, outputPath);
    return result;
  }).catch((error) => {
    fs.rmSync(tmpPath, { force: true });
    fs.rmSync(`${tmpPath}-wal`, { force: true });
    fs.rmSync(`${tmpPath}-shm`, { force: true });
    throw error;
  });
}
