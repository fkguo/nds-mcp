import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ingestExfor } from '../src/ingest/buildExforDb.js';
import { ingestJendl5Decay, ingestJendl5Xs } from '../src/ingest/buildJendl5Db.js';
import { handleToolCall } from '../src/tools/dispatcher.js';

const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'),
) as { version: string };

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

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

function readMeta(dbPath: string, tableName: string): Record<string, string> {
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

function expectRequiredMeta(
  meta: Record<string, string>,
  expected: {
    sourceKind: 'built_from_upstream' | 'imported_sqlite' | 'imported_jsonl';
    upstreamName: 'JENDL-5' | 'EXFOR';
    upstreamUrl: string;
    upstreamVersionOrSnapshot: string;
  },
): void {
  for (const key of REQUIRED_META_KEYS) {
    expect(meta[key]).toBeDefined();
  }
  expect(meta.generator).toBe('nds-mcp');
  expect(meta.generator_version).toBe(PACKAGE_VERSION.version);
  expect(meta.source_kind).toBe(expected.sourceKind);
  expect(meta.upstream_name).toBe(expected.upstreamName);
  expect(meta.upstream_url).toBe(expected.upstreamUrl);
  expect(meta.upstream_version_or_snapshot).toBe(expected.upstreamVersionOrSnapshot);
  expect(Number.isNaN(Date.parse(meta.built_at))).toBe(false);
}

describe('ingest optional DB metadata contract', () => {
  it('JENDL decay/xs ingests always write required normalized metadata keys', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-jendl-meta-'));
    try {
      const jendlDecayDb = path.join(tmpRoot, 'jendl-dec.sqlite');
      const jendlXsDb = path.join(tmpRoot, 'jendl-xs.sqlite');
      const decJsonl = path.join(tmpRoot, 'jendl-dec.jsonl');
      const xsJsonl = path.join(tmpRoot, 'jendl-xs.jsonl');
      const xsTar = path.join(tmpRoot, 'jendl-xs.tar.gz');

      fs.writeFileSync(
        decJsonl,
        `${JSON.stringify({
          ZA: 27060,
          LIS: 0,
          NST: 0,
          halfLifeS: 166322000,
          decayModes: [{ rtyp: 1, mode_label: 'beta-', q_keV: 2823.1, br: 1 }],
          spectra: [{
            styp: 0,
            type_label: 'gamma',
            lcon: 0,
            component_kind: 'discrete_line',
            energy_keV: 1173.228,
            energy_unc_keV: null,
            endpoint_keV: null,
            intensity: 0.9985,
            intensity_unc: null,
          }],
        })}\n`,
      );
      fs.writeFileSync(
        xsJsonl,
        `${JSON.stringify({
          Z: 26,
          A: 56,
          state: 0,
          projectile: 'n',
          mt: 102,
          reaction: 'n,gamma',
          e_min_eV: 1e-5,
          e_max_eV: 1,
          points: [
            { point_index: 1, e_eV: 1e-5, sigma_b: 10 },
            { point_index: 2, e_eV: 1, sigma_b: 1 },
          ],
          interp: [{ nbt: 2, int_law: 5 }],
        })}\n`,
      );
      execFileSync('tar', ['-czf', xsTar, '-C', tmpRoot, path.basename(xsJsonl)]);

      await ingestJendl5Decay(jendlDecayDb, decJsonl, 'upd-5');
      await ingestJendl5Xs(jendlXsDb, xsTar, '300K');

      const decayMeta = readMeta(jendlDecayDb, 'jendl5_meta');
      expectRequiredMeta(decayMeta, {
        sourceKind: 'imported_jsonl',
        upstreamName: 'JENDL-5',
        upstreamUrl: 'https://wwwndc.jaea.go.jp/jendl/j5/j5.html',
        upstreamVersionOrSnapshot: 'upd-5',
      });
      expect(decayMeta.dec_schema_version).toBe('1');
      expect(decayMeta.jendl5_dec_version).toBe('upd-5');

      const xsMeta = readMeta(jendlXsDb, 'jendl5_meta');
      expectRequiredMeta(xsMeta, {
        sourceKind: 'built_from_upstream',
        upstreamName: 'JENDL-5',
        upstreamUrl: 'https://wwwndc.jaea.go.jp/jendl/j5/j5.html',
        upstreamVersionOrSnapshot: '300K',
      });
      expect(xsMeta.xs_schema_version).toBe('1');
      expect(xsMeta.jendl5_xs_version).toBe('300K');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('EXFOR sqlite import preserves source metadata and overlays required keys', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-exfor-meta-'));
    const sourceDb = path.join(tmpRoot, 'source.sqlite');
    const targetDb = path.join(tmpRoot, 'target.sqlite');
    try {
      runSql(
        sourceDb,
        `
CREATE TABLE exfor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE exfor_entries (
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
CREATE TABLE exfor_points (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  energy_eV REAL,
  kT_keV REAL,
  value REAL,
  uncertainty REAL
);
INSERT INTO exfor_entries VALUES ('E001', '001', 26, 56, 0, 'n', 'n,gamma', 'SIG', 'Paper A', 2001);
INSERT INTO exfor_points VALUES ('E001', '001', 1, 1000.0, NULL, 0.5, 0.01);
INSERT INTO exfor_meta VALUES ('schema_version', '1');
INSERT INTO exfor_meta VALUES ('source_kind', 'built_from_upstream');
INSERT INTO exfor_meta VALUES ('upstream_version_or_snapshot', 'x4sqlite-20231008-a');
INSERT INTO exfor_meta VALUES ('x4i3_version', '4.2.3');
INSERT INTO exfor_meta VALUES ('candidate_rows', '25000');
INSERT INTO exfor_meta VALUES ('custom_note', 'keep-me');
`,
      );

      await ingestExfor(targetDb, sourceDb);

      const meta = readMeta(targetDb, 'exfor_meta');
      expectRequiredMeta(meta, {
        sourceKind: 'imported_sqlite',
        upstreamName: 'EXFOR',
        upstreamUrl: 'https://www-nds.iaea.org/exfor/',
        upstreamVersionOrSnapshot: 'x4sqlite-20231008-a',
      });
      expect(meta.custom_note).toBe('keep-me');
      expect(meta.x4i3_version).toBe('4.2.3');
      expect(meta.candidate_rows).toBe('25000');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('nds_info returns normalized meta keys and preserved source extras after ingest', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-info-meta-'));
    const jendlDb = path.join(tmpRoot, 'jendl5.sqlite');
    const exforSourceDb = path.join(tmpRoot, 'exfor-source.sqlite');
    const exforDb = path.join(tmpRoot, 'exfor.sqlite');
    const decJsonl = path.join(tmpRoot, 'jendl-dec.jsonl');
    const envBackup = {
      NDS_DB_PATH: process.env.NDS_DB_PATH,
      NDS_JENDL5_DB_PATH: process.env.NDS_JENDL5_DB_PATH,
      NDS_EXFOR_DB_PATH: process.env.NDS_EXFOR_DB_PATH,
    };
    try {
      fs.writeFileSync(
        decJsonl,
        `${JSON.stringify({
          ZA: 27060,
          LIS: 0,
          NST: 0,
          halfLifeS: 166322000,
          decayModes: [{ rtyp: 1, mode_label: 'beta-', q_keV: 2823.1, br: 1 }],
          spectra: [],
        })}\n`,
      );
      await ingestJendl5Decay(jendlDb, decJsonl, 'upd-5');

      runSql(
        exforSourceDb,
        `
CREATE TABLE exfor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE exfor_entries (
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
CREATE TABLE exfor_points (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  energy_eV REAL,
  kT_keV REAL,
  value REAL,
  uncertainty REAL
);
INSERT INTO exfor_entries VALUES ('E001', '001', 26, 56, 0, 'n', 'n,gamma', 'SIG', 'Paper A', 2001);
INSERT INTO exfor_points VALUES ('E001', '001', 1, 1000.0, NULL, 0.5, 0.01);
INSERT INTO exfor_meta VALUES ('upstream_version_or_snapshot', 'x4sqlite-20231008-a');
INSERT INTO exfor_meta VALUES ('custom_note', 'preserve-in-nds-info');
`,
      );
      await ingestExfor(exforDb, exforSourceDb);

      process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
      process.env.NDS_JENDL5_DB_PATH = jendlDb;
      process.env.NDS_EXFOR_DB_PATH = exforDb;

      const result = await handleToolCall('nds_info', {});
      expect(result.isError).toBeUndefined();
      const info = JSON.parse(result.content[0]!.text) as {
        jendl5_meta: Record<string, string>;
        exfor_meta: Record<string, string>;
      };
      expectRequiredMeta(info.jendl5_meta, {
        sourceKind: 'imported_jsonl',
        upstreamName: 'JENDL-5',
        upstreamUrl: 'https://wwwndc.jaea.go.jp/jendl/j5/j5.html',
        upstreamVersionOrSnapshot: 'upd-5',
      });
      expectRequiredMeta(info.exfor_meta, {
        sourceKind: 'imported_sqlite',
        upstreamName: 'EXFOR',
        upstreamUrl: 'https://www-nds.iaea.org/exfor/',
        upstreamVersionOrSnapshot: 'x4sqlite-20231008-a',
      });
      expect(info.exfor_meta.custom_note).toBe('preserve-in-nds-info');
    } finally {
      if (envBackup.NDS_DB_PATH === undefined) delete process.env.NDS_DB_PATH;
      else process.env.NDS_DB_PATH = envBackup.NDS_DB_PATH;
      if (envBackup.NDS_JENDL5_DB_PATH === undefined) delete process.env.NDS_JENDL5_DB_PATH;
      else process.env.NDS_JENDL5_DB_PATH = envBackup.NDS_JENDL5_DB_PATH;
      if (envBackup.NDS_EXFOR_DB_PATH === undefined) delete process.env.NDS_EXFOR_DB_PATH;
      else process.env.NDS_EXFOR_DB_PATH = envBackup.NDS_EXFOR_DB_PATH;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
