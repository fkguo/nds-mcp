import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleToolCall } from '../src/tools/dispatcher.js';

const MAIN_FIXTURE_DB = path.resolve(__dirname, '..', 'fixtures', 'sample.sqlite');

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

describe('DDEP tools', () => {
  const requiredMetaKeys = [
    'schema_version',
    'built_at',
    'generator',
    'generator_version',
    'source_kind',
    'upstream_name',
    'upstream_url',
    'upstream_version_or_snapshot',
  ] as const;

  const envBackup = {
    NDS_DB_PATH: process.env.NDS_DB_PATH,
    NDS_DDEP_DB_PATH: process.env.NDS_DDEP_DB_PATH,
  };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-ddep-tools-'));
  const ddepDb = path.join(tmpRoot, 'ddep.sqlite');

  beforeAll(() => {
    runSql(
      ddepDb,
      `
CREATE TABLE ddep_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE ddep_nuclides (
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
CREATE TABLE ddep_radiation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nuclide_id INTEGER NOT NULL,
  radiation_type TEXT NOT NULL,
  energy_keV REAL,
  energy_unc_keV REAL,
  intensity REAL,
  intensity_unc REAL,
  is_primary INTEGER NOT NULL DEFAULT 0
);
INSERT INTO ddep_meta VALUES ('schema_version', '1');
INSERT INTO ddep_meta VALUES ('built_at', '2026-03-01T00:00:00.000Z');
INSERT INTO ddep_meta VALUES ('generator', 'nds-mcp');
INSERT INTO ddep_meta VALUES ('generator_version', '0.2.0');
INSERT INTO ddep_meta VALUES ('source_kind', 'imported_jsonl');
INSERT INTO ddep_meta VALUES ('upstream_name', 'DDEP');
INSERT INTO ddep_meta VALUES ('upstream_url', 'https://www.lnhb.fr/ddep-wg/');
INSERT INTO ddep_meta VALUES ('upstream_version_or_snapshot', '2026-01');
INSERT INTO ddep_meta VALUES ('ddep_schema_version', '1');
INSERT INTO ddep_meta VALUES ('ddep_release', '2026-01');
INSERT INTO ddep_nuclides
  (id, Z, A, state, nuclide, half_life_value, half_life_uncertainty, half_life_unit, half_life_seconds, decay_mode, source_label)
VALUES
  (1, 27, 60, 0, '60Co', 5.2713, 0.0008, 'y', 166322000, 'beta-', 'DDEP 2026-01');
INSERT INTO ddep_radiation
  (nuclide_id, radiation_type, energy_keV, intensity, is_primary)
VALUES
  (1, 'gamma', 1173.228, 0.9985, 1),
  (1, 'gamma', 1332.492, 0.9998, 1),
  (1, 'gamma', 320.0, 0.001, 0);
`,
    );

    process.env.NDS_DB_PATH = MAIN_FIXTURE_DB;
    process.env.NDS_DDEP_DB_PATH = ddepDb;
  });

  afterAll(() => {
    if (envBackup.NDS_DB_PATH === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = envBackup.NDS_DB_PATH;
    if (envBackup.NDS_DDEP_DB_PATH === undefined) delete process.env.NDS_DDEP_DB_PATH;
    else process.env.NDS_DDEP_DB_PATH = envBackup.NDS_DDEP_DB_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('nds_info returns ddep_db status and ddep_meta', async () => {
    const result = await handleToolCall('nds_info', {});
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.ddep_db.status).toBe('ok');
    for (const key of requiredMetaKeys) {
      expect(data.ddep_meta[key]).toBeDefined();
    }
    expect(data.ddep_meta.upstream_name).toBe('DDEP');
    expect(data.ddep_meta.ddep_release).toBe('2026-01');
  });

  it('nds_get_ddep_decay returns half-life and filtered key radiation lines', async () => {
    const result = await handleToolCall('nds_get_ddep_decay', {
      Z: 27,
      A: 60,
      min_intensity: 0.9,
      limit: 5,
    }, 'full');
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.Z).toBe(27);
    expect(data.A).toBe(60);
    expect(Array.isArray(data.half_life_values)).toBe(true);
    expect(data.half_life_values[0].source).toContain('DDEP');
    expect(data.recommended_half_life.source).toContain('DDEP');
    expect(data.radiation.length).toBe(2);
    expect(data.radiation[0].source).toContain('DDEP');
  });
});
