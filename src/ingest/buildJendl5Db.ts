import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ensureJendl5Schema, loadDecayRecords, loadXsRecords, runSql, sqlEscape, sqlNum } from './jendl5DbCore.js';
import { buildRequiredLibraryMeta, detectSourceKind } from './metaContract.js';

function buildMetaUpsertSql(tableName: string, meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([key, value]) => (
      `INSERT OR REPLACE INTO ${tableName}(key, value) VALUES ('${sqlEscape(key)}', '${sqlEscape(value)}');`
    ))
    .join('\n');
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
  const records = await loadXsRecords(sourcePath);
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

  for (const record of records) {
    runSql(
      dbPath,
      `INSERT INTO jendl5_xs_meta(Z, A, state, projectile, mt, reaction, e_min_eV, e_max_eV, n_points)
       VALUES (${record.Z}, ${record.A}, ${record.state}, '${record.projectile}', ${record.mt}, '${sqlEscape(record.reaction)}',
               ${record.e_min_eV}, ${record.e_max_eV}, ${record.points.length});`,
    );

    const xsId = Number(
      execFileSync(
        'sqlite3',
        [dbPath, `SELECT id FROM jendl5_xs_meta WHERE Z=${record.Z} AND A=${record.A} AND state=${record.state} AND projectile='${record.projectile}' AND mt=${record.mt} LIMIT 1;`],
        { encoding: 'utf-8' },
      ).trim(),
    );

    for (const point of record.points) {
      runSql(
        dbPath,
        `INSERT INTO jendl5_xs_points(xs_id, point_index, e_eV, sigma_b)
         VALUES (${xsId}, ${point.point_index}, ${point.e_eV}, ${point.sigma_b});`,
      );
    }
    for (const segment of record.interp) {
      runSql(
        dbPath,
        `INSERT INTO jendl5_xs_interp(xs_id, nbt, int_law)
         VALUES (${xsId}, ${segment.nbt}, ${segment.int_law});`,
      );
    }
  }

  return { reactions: records.length };
}

export function atomicWriteSqlite(
  outputPath: string,
  mutator: (tmpPath: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp.${process.pid}`;
  if (fs.existsSync(outputPath)) {
    fs.copyFileSync(outputPath, tmpPath);
  } else {
    runSql(tmpPath, 'PRAGMA journal_mode=WAL;');
  }

  return mutator(tmpPath).then((result) => {
    fs.renameSync(tmpPath, outputPath);
    return result;
  }).catch((error) => {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  });
}
