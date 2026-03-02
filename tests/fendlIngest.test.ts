import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ingestFendl32c } from '../src/ingest/buildFendlDb.js';
import { handleToolCall } from '../src/tools/dispatcher.js';

const MAIN_FIXTURE_DB = path.resolve(__dirname, '..', 'fixtures', 'sample.sqlite');
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

function endfLine(fields: string[], mat: number, mf: number, mt: number, ns: number): string {
  const sixFields = [...fields];
  while (sixFields.length < 6) sixFields.push('');
  const data = sixFields
    .slice(0, 6)
    .map((field) => field.slice(0, 11).padStart(11, ' '))
    .join('');
  const suffix = `${String(mat).padStart(4, ' ')}${String(mf).padStart(2, ' ')}${String(mt).padStart(3, ' ')}${String(ns).padStart(5, ' ')}`;
  return `${data}${suffix}`;
}

function buildSimpleEndf(za: number, mat: number, mt: number): string {
  const lines = [
    endfLine([`${za}.`, '0.0', '0', '0', '0', '0'], mat, 3, mt, 1),
    endfLine(['0.000000+0', '0.000000+0', '0', '0', '1', '3'], mat, 3, mt, 2),
    endfLine(['3', '2'], mat, 3, mt, 3),
    endfLine(['1.000000-5', '1.000000+0', '1.000000+0', '2.000000+0', '2.000000+7', '3.000000+0'], mat, 3, mt, 4),
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
    ['-separator', '\t', dbPath, 'SELECT key, value FROM fendl_meta ORDER BY key;'],
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

describe('FENDL-3.2c ingest', () => {
  const envBackup = {
    NDS_DB_PATH: process.env.NDS_DB_PATH,
    NDS_FENDL_DB_PATH: process.env.NDS_FENDL_DB_PATH,
  };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-fendl-ingest-'));
  const sourceDir = path.join(tmpRoot, 'fendl-src');
  const dbPath = path.join(tmpRoot, 'fendl32c.sqlite');

  beforeAll(() => {
    fs.mkdirSync(sourceDir, { recursive: true });
    const nDat = path.join(tmpRoot, 'n_082-Pb-208_8237.dat');
    const dDat = path.join(tmpRoot, 'd_026-Fe-56_2631.dat');
    const pDat = path.join(tmpRoot, 'p_026-Fe-56_2631.dat');
    const photoDat = path.join(tmpRoot, 'photo_26-FE_2600.dat');
    fs.writeFileSync(nDat, buildSimpleEndf(82208, 8237, 102), 'utf-8');
    fs.writeFileSync(dDat, buildSimpleEndf(26056, 2631, 5), 'utf-8');
    fs.writeFileSync(pDat, buildSimpleEndf(26056, 2631, 103), 'utf-8');
    fs.writeFileSync(photoDat, buildSimpleEndf(26000, 2600, 502), 'utf-8');

    execFileSync('zip', ['-q', '-j', path.join(sourceDir, 'n_082-Pb-208_8237.zip'), nDat]);
    execFileSync('zip', ['-q', '-j', path.join(sourceDir, 'd_026-Fe-56_2631.zip'), dDat]);
    execFileSync('zip', ['-q', '-j', path.join(sourceDir, 'p_026-Fe-56_2631.zip'), pDat]);
    execFileSync('zip', ['-q', '-j', path.join(sourceDir, 'photo_26-FE_2600.zip'), photoDat]);
  });

  afterAll(() => {
    if (envBackup.NDS_DB_PATH === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = envBackup.NDS_DB_PATH;
    if (envBackup.NDS_FENDL_DB_PATH === undefined) delete process.env.NDS_FENDL_DB_PATH;
    else process.env.NDS_FENDL_DB_PATH = envBackup.NDS_FENDL_DB_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('ingests zipped FENDL-style ENDF files and preserves required meta keys', async () => {
    const summary = await ingestFendl32c(dbPath, sourceDir, 'FENDL-3.2c');
    expect(summary.reactions).toBeGreaterThanOrEqual(4);
    expect(summary.archives).toBe(4);

    const totalRows = Number(runSqlScalar(dbPath, 'SELECT COUNT(*) FROM fendl_xs_meta;'));
    expect(totalRows).toBeGreaterThanOrEqual(4);
    const rawRows = Number(runSqlScalar(dbPath, 'SELECT COUNT(*) FROM fendl_raw_archives;'));
    expect(rawRows).toBe(4);
    const rawBytes = Number(runSqlScalar(dbPath, 'SELECT SUM(size_bytes) FROM fendl_raw_archives;'));
    expect(rawBytes).toBeGreaterThan(0);

    const projectiles = runSqlScalar(
      dbPath,
      "SELECT GROUP_CONCAT(projectile, ',') FROM (SELECT DISTINCT projectile FROM fendl_xs_meta ORDER BY projectile);",
    );
    expect(projectiles).toContain('n');
    expect(projectiles).toContain('p');
    expect(projectiles).toContain('d');
    expect(projectiles).toContain('photo');

    const meta = readMeta(dbPath);
    for (const key of REQUIRED_META_KEYS) {
      expect(meta[key]).toBeDefined();
    }
    expect(meta.fendl_schema_version).toBe('1');
    expect(meta.fendl_version).toBe('FENDL-3.2c');
    expect(meta.upstream_name).toBe('FENDL-3.2c');
    expect(Number(meta.fendl_raw_archive_count)).toBe(4);
    expect(Number(meta.fendl_raw_archive_bytes)).toBeGreaterThan(0);
  });

  it('nds_info exposes fendl_db status and fendl_meta when configured', async () => {
    await ingestFendl32c(dbPath, sourceDir, 'FENDL-3.2c');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_FENDL_DB_PATH = dbPath;

    const result = await handleToolCall('nds_info', {});
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as {
      fendl_db: { status: string };
      fendl_meta: Record<string, string>;
    };

    expect(payload.fendl_db.status).toBe('ok');
    for (const key of REQUIRED_META_KEYS) {
      expect(payload.fendl_meta[key]).toBeDefined();
    }
    expect(payload.fendl_meta.fendl_version).toBe('FENDL-3.2c');
  });
});
