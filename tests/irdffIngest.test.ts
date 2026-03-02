import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ingestIrdff2 } from '../src/ingest/buildIrdffDb.js';
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
    ['-separator', '\t', dbPath, 'SELECT key, value FROM irdff_meta ORDER BY key;'],
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

describe('IRDFF-II ingest', () => {
  const envBackup = {
    NDS_DB_PATH: process.env.NDS_DB_PATH,
    NDS_IRDFF_DB_PATH: process.env.NDS_IRDFF_DB_PATH,
  };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-irdff-ingest-'));
  const sourceDir = path.join(tmpRoot, 'irdff-src');
  const dbPath = path.join(tmpRoot, 'irdff2.sqlite');

  beforeAll(() => {
    fs.mkdirSync(sourceDir, { recursive: true });
    const nDat = path.join(tmpRoot, 'n_026-Fe-56_2631.dat');
    fs.writeFileSync(nDat, buildSimpleEndf(26056, 2631, 102), 'utf-8');
    execFileSync('zip', ['-q', '-j', path.join(sourceDir, 'n_026-Fe-56_2631.zip'), nDat]);
  });

  afterAll(() => {
    if (envBackup.NDS_DB_PATH === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = envBackup.NDS_DB_PATH;
    if (envBackup.NDS_IRDFF_DB_PATH === undefined) delete process.env.NDS_IRDFF_DB_PATH;
    else process.env.NDS_IRDFF_DB_PATH = envBackup.NDS_IRDFF_DB_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('ingests zipped IRDFF-style neutron ENDF and writes required metadata', async () => {
    const summary = await ingestIrdff2(dbPath, sourceDir, 'IRDFF-II');
    expect(summary.reactions).toBeGreaterThanOrEqual(1);

    const totalRows = Number(runSqlScalar(dbPath, 'SELECT COUNT(*) FROM irdff_xs_meta;'));
    expect(totalRows).toBeGreaterThanOrEqual(1);

    const projectile = runSqlScalar(dbPath, 'SELECT projectile FROM irdff_xs_meta LIMIT 1;');
    expect(projectile).toBe('n');

    const meta = readMeta(dbPath);
    for (const key of REQUIRED_META_KEYS) {
      expect(meta[key]).toBeDefined();
    }
    expect(meta.irdff_schema_version).toBe('1');
    expect(meta.irdff_version).toBe('IRDFF-II');
    expect(meta.upstream_name).toBe('IRDFF-II');
  });

  it('nds_info exposes irdff_db status and irdff_meta when configured', async () => {
    await ingestIrdff2(dbPath, sourceDir, 'IRDFF-II');
    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_IRDFF_DB_PATH = dbPath;

    const result = await handleToolCall('nds_info', {});
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as {
      irdff_db: { status: string };
      irdff_meta: Record<string, string>;
    };

    expect(payload.irdff_db.status).toBe('ok');
    for (const key of REQUIRED_META_KEYS) {
      expect(payload.irdff_meta[key]).toBeDefined();
    }
    expect(payload.irdff_meta.irdff_version).toBe('IRDFF-II');
  });
});
