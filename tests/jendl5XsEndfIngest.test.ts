import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import { ingestJendl5Xs } from '../src/ingest/buildJendl5Db.js';
import { handleToolCall } from '../src/tools/dispatcher.js';

const REQUIRED_META_KEYS = [
  'schema_version',
  'built_at',
  'generator',
  'generator_version',
  'source_kind',
  'upstream_name',
  'upstream_url',
  'upstream_version_or_snapshot',
] as const;

const MAIN_FIXTURE_DB = path.resolve(__dirname, '..', 'fixtures', 'sample.sqlite');

function endfLine(
  fields: string[],
  mat: number,
  mf: number,
  mt: number,
  ns: number,
): string {
  const sixFields = [...fields];
  while (sixFields.length < 6) sixFields.push('');
  const data = sixFields
    .slice(0, 6)
    .map((field) => field.slice(0, 11).padStart(11, ' '))
    .join('');
  const suffix = `${String(mat).padStart(4, ' ')}${String(mf).padStart(2, ' ')}${String(mt).padStart(3, ' ')}${String(ns).padStart(5, ' ')}`;
  return `${data}${suffix}`;
}

function buildPb208Endf(): string {
  const mat = 8237;
  const lines = [
    endfLine(['8.220800+4', '2.061900+2', '0', '0', '0', '0'], mat, 3, 102, 1),
    endfLine(['0.000000+0', '0.000000+0', '0', '0', '1', '4'], mat, 3, 102, 2),
    endfLine(['4', '5'], mat, 3, 102, 3),
    endfLine(['1.000000-5', '1.157860-2', '1.000000-3', '2.303070-4', '1.000000+0', '8.995420-6'], mat, 3, 102, 4),
    endfLine(['2.000000+7', '0.000000+0'], mat, 3, 102, 5),
    endfLine([], mat, 3, 0, 99999),
    endfLine(['8.220800+4', '2.061900+2', '0', '0', '0', '0'], mat, 3, 2, 1),
    endfLine(['0.000000+0', '0.000000+0', '0', '0', '1', '4'], mat, 3, 2, 2),
    endfLine(['4', '5'], mat, 3, 2, 3),
    endfLine(['1.000000-5', '1.145790+1', '1.000000-3', '1.000000+1', '1.000000+0', '9.000000+0'], mat, 3, 2, 4),
    endfLine(['2.000000+7', '0.000000+0'], mat, 3, 2, 5),
    endfLine([], mat, 3, 0, 99999),
    endfLine([], mat, 0, 0, 0),
  ];
  return `${lines.join('\n')}\n`;
}

function buildNaturalCarbonEndf(): string {
  const mat = 6250;
  const lines = [
    endfLine(['6000.', '1.189690+1', '0', '0', '0', '0'], mat, 3, 102, 1),
    endfLine(['0.', '0.', '0', '0', '1', '2'], mat, 3, 102, 2),
    endfLine(['2', '2'], mat, 3, 102, 3),
    endfLine(['1.000000-5', '2.500000+0', '2.000000+7', '0.000000+0'], mat, 3, 102, 4),
    endfLine([], mat, 3, 0, 99999),
    endfLine([], mat, 0, 0, 0),
  ];
  return `${lines.join('\n')}\n`;
}

function runSqlScalar(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

function readMeta(dbPath: string): Record<string, string> {
  const output = execFileSync(
    'sqlite3',
    ['-separator', '\t', dbPath, 'SELECT key, value FROM jendl5_meta ORDER BY key;'],
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

describe('JENDL-5 XS ENDF-6 ingest', () => {
  const envBackup = {
    NDS_DB_PATH: process.env.NDS_DB_PATH,
    NDS_JENDL5_DB_PATH: process.env.NDS_JENDL5_DB_PATH,
  };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-jendl-xs-endf-'));
  const endfPath = path.join(tmpRoot, 'n_082-Pb-208_300K.dat');
  const naturalEndfPath = path.join(tmpRoot, 'n_006-C-0_300K.dat');
  const jsonPath = path.join(tmpRoot, 'pb208-n-gamma.json');
  const auxTxtPath = path.join(tmpRoot, 'README.txt');
  const gzPath = path.join(tmpRoot, 'n_082-Pb-208_300K.dat.gz');
  const tarPath = path.join(tmpRoot, 'jendl5-n-300K-mini.tar.gz');
  const jendlDb = path.join(tmpRoot, 'jendl5.sqlite');

  beforeAll(() => {
    fs.writeFileSync(endfPath, buildPb208Endf(), 'utf-8');
    fs.writeFileSync(naturalEndfPath, buildNaturalCarbonEndf(), 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify({
      Z: 82,
      A: 208,
      state: 0,
      projectile: 'n',
      mt: 102,
      reaction: 'n,gamma',
      e_min_eV: 1e-5,
      e_max_eV: 2e7,
      points: [
        { point_index: 1, e_eV: 1e-5, sigma_b: 1.15786e-2 },
        { point_index: 2, e_eV: 1e-3, sigma_b: 2.30307e-4 },
      ],
      interp: [{ nbt: 2, int_law: 2 }],
    }, null, 2), 'utf-8');
    fs.writeFileSync(auxTxtPath, 'This is not ENDF data.', 'utf-8');
    fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(endfPath)));
    execFileSync('tar', ['-czf', tarPath, '-C', tmpRoot, path.basename(gzPath), path.basename(auxTxtPath)]);
  });

  afterAll(() => {
    if (envBackup.NDS_DB_PATH === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = envBackup.NDS_DB_PATH;
    if (envBackup.NDS_JENDL5_DB_PATH === undefined) delete process.env.NDS_JENDL5_DB_PATH;
    else process.env.NDS_JENDL5_DB_PATH = envBackup.NDS_JENDL5_DB_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('ingests ENDF-6 .dat.gz records from tar archive into jendl5_xs tables', async () => {
    const summary = await ingestJendl5Xs(jendlDb, tarPath, '300K');
    expect(summary.reactions).toBeGreaterThanOrEqual(2);

    const totalMetaRows = Number(runSqlScalar(jendlDb, 'SELECT COUNT(*) FROM jendl5_xs_meta;'));
    expect(totalMetaRows).toBeGreaterThanOrEqual(2);
    const pbCaptureRows = Number(runSqlScalar(
      jendlDb,
      "SELECT COUNT(*) FROM jendl5_xs_meta WHERE Z=82 AND A=208 AND state=0 AND projectile='n' AND mt=102 AND reaction='n,gamma';",
    ));
    expect(pbCaptureRows).toBe(1);
    const badMetaRows = Number(runSqlScalar(
      jendlDb,
      "SELECT COUNT(*) FROM jendl5_xs_meta WHERE projectile='' OR reaction='' OR n_points < 2 OR e_max_eV < e_min_eV;",
    ));
    expect(badMetaRows).toBe(0);

    const meta = readMeta(jendlDb);
    for (const key of REQUIRED_META_KEYS) {
      expect(meta[key]).toBeDefined();
    }
    expect(meta.xs_schema_version).toBe('1');
    expect(meta.jendl5_xs_version).toBe('300K');
  });

  it('accepts ENDF natural-element records (A=0) and trailing-dot float fields', async () => {
    const summary = await ingestJendl5Xs(jendlDb, naturalEndfPath, '300K');
    expect(summary.reactions).toBeGreaterThanOrEqual(1);

    const naturalRows = Number(runSqlScalar(
      jendlDb,
      "SELECT COUNT(*) FROM jendl5_xs_meta WHERE Z=6 AND A=0 AND state=0 AND projectile='n' AND mt=102;",
    ));
    expect(naturalRows).toBe(1);
  });

  it('accepts a multi-line .json single-record source (non-JSONL path)', async () => {
    const summary = await ingestJendl5Xs(jendlDb, jsonPath, '300K');
    expect(summary.reactions).toBe(1);

    const pbCaptureRows = Number(runSqlScalar(
      jendlDb,
      "SELECT COUNT(*) FROM jendl5_xs_meta WHERE Z=82 AND A=208 AND state=0 AND projectile='n' AND mt=102 AND reaction='n,gamma';",
    ));
    expect(pbCaptureRows).toBe(1);
  });

  it('nds_info includes required jendl5_meta keys after XS ingest', async () => {
    await ingestJendl5Xs(jendlDb, tarPath, '300K');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_JENDL5_DB_PATH = jendlDb;

    const infoResult = await handleToolCall('nds_info', {});
    expect(infoResult.isError).toBeUndefined();
    const info = JSON.parse(infoResult.content[0]!.text) as { jendl5_meta: Record<string, string> };
    for (const key of REQUIRED_META_KEYS) {
      expect(info.jendl5_meta[key]).toBeDefined();
    }
    expect(info.jendl5_meta.source_kind).toBe('built_from_upstream');
    expect(info.jendl5_meta.upstream_version_or_snapshot).toBe('300K');
  });

  it('serves Pb-208 n,gamma XS via tools (raw table + interpolation)', async () => {
    await ingestJendl5Xs(jendlDb, tarPath, '300K');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_JENDL5_DB_PATH = jendlDb;

    const table = await handleToolCall('nds_get_cross_section_table', {
      Z: 82, A: 208, state: 0, projectile: 'n', mt: 102, mode: 'raw', limit: 10, offset: 0,
    });
    expect(table.isError).toBeUndefined();
    const tableData = JSON.parse(table.content[0]!.text);
    expect(tableData.reaction).toBe('n,gamma');
    expect(tableData.points.length).toBe(4);

    const interpolated = await handleToolCall('nds_interpolate_cross_section', {
      Z: 82, A: 208, state: 0, projectile: 'n', mt: 102, energy_eV: 1e-4,
    });
    expect(interpolated.isError).toBeUndefined();
    const interpolationData = JSON.parse(interpolated.content[0]!.text);
    expect(interpolationData.reaction).toBe('n,gamma');
    expect(interpolationData.sigma_b).toBeGreaterThan(0);
  });

  it('clips partially overlapping energy windows instead of failing', async () => {
    await ingestJendl5Xs(jendlDb, tarPath, '300K');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_JENDL5_DB_PATH = jendlDb;

    const result = await handleToolCall('nds_get_cross_section_table', {
      Z: 82, A: 208, state: 0, projectile: 'n', mt: 102, mode: 'raw',
      e_min_eV: 1e-7, e_max_eV: 1e-3, limit: 20, offset: 0,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.requested_e_min_eV).toBe(1e-7);
    expect(data.e_min_eV).toBe(1e-5);
    expect(data.range_clipped).toBe(true);
    expect(data.points.length).toBeGreaterThan(0);
  });

  it('returns structured INVALID_PARAMS for one-sided out-of-range table windows', async () => {
    await ingestJendl5Xs(jendlDb, tarPath, '300K');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_JENDL5_DB_PATH = jendlDb;

    const result = await handleToolCall('nds_get_cross_section_table', {
      Z: 82, A: 208, state: 0, projectile: 'n', mt: 102, mode: 'raw',
      e_min_eV: 3e8, limit: 20, offset: 0,
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error.code).toBe('INVALID_PARAMS');
    expect(payload.error.data.requested_e_min_eV).toBe(3e8);
    expect(payload.error.data.tabulated_e_min_eV).toBe(1e-5);
    expect(payload.error.data.tabulated_e_max_eV).toBe(2e7);
  });

  it('returns INVALID_PARAMS with available MT list when requested reaction is missing', async () => {
    await ingestJendl5Xs(jendlDb, tarPath, '300K');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_JENDL5_DB_PATH = jendlDb;

    const miss = await handleToolCall('nds_get_cross_section_table', {
      Z: 82, A: 208, state: 0, projectile: 'n', mt: 999, mode: 'raw', limit: 10, offset: 0,
    });
    expect(miss.isError).toBe(true);
    const payload = JSON.parse(miss.content[0]!.text);
    expect(payload.error.code).toBe('INVALID_PARAMS');
    expect(Array.isArray(payload.error.data.available_mts)).toBe(true);
    expect(payload.error.data.available_mts).toContain(2);
    expect(payload.error.data.available_mts).toContain(102);
  });

  it('returns INVALID_PARAMS when interpolation energy is outside tabulated range', async () => {
    await ingestJendl5Xs(jendlDb, tarPath, '300K');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_JENDL5_DB_PATH = jendlDb;

    const miss = await handleToolCall('nds_interpolate_cross_section', {
      Z: 82, A: 208, state: 0, projectile: 'n', mt: 102, energy_eV: 1e-8,
    });
    expect(miss.isError).toBe(true);
    const payload = JSON.parse(miss.content[0]!.text);
    expect(payload.error.code).toBe('INVALID_PARAMS');
    expect(payload.error.data.requested_energy_eV).toBe(1e-8);
    expect(payload.error.data.tabulated_e_min_eV).toBe(1e-5);
    expect(payload.error.data.tabulated_e_max_eV).toBe(2e7);
  });
});
