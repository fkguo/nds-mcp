import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleToolCall } from '../src/tools/dispatcher.js';

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

const FIXTURE_DB = path.resolve(__dirname, '..', 'fixtures', 'sample.sqlite');

describe('charge radius source comparison rules', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-charge-compare-'));
  const ndsDb = path.join(tmpRoot, 'nds.sqlite');
  const backupEnv = {
    NDS_DB_PATH: process.env.NDS_DB_PATH,
  };

  beforeAll(() => {
    fs.copyFileSync(FIXTURE_DB, ndsDb);
    runSql(
      ndsDb,
      `
CREATE TABLE codata_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE codata_constants (
  id INTEGER PRIMARY KEY,
  quantity TEXT NOT NULL,
  quantity_key TEXT NOT NULL,
  value_text TEXT NOT NULL,
  uncertainty_text TEXT NOT NULL,
  unit TEXT NOT NULL,
  is_exact INTEGER NOT NULL,
  is_truncated INTEGER NOT NULL
);
INSERT INTO codata_meta VALUES ('schema_version', '1');
INSERT INTO codata_meta VALUES ('upstream_version_or_snapshot', '2022');
INSERT INTO codata_constants(quantity, quantity_key, value_text, uncertainty_text, unit, is_exact, is_truncated) VALUES
  ('proton rms charge radius', 'proton rms charge radius', '8.4075 e-16', '0.0064 e-16', 'm', 0, 0);
`,
    );

    process.env.NDS_DB_PATH = ndsDb;
  });

  afterAll(() => {
    if (backupEnv.NDS_DB_PATH === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = backupEnv.NDS_DB_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('mode=compare returns all sources and marks CODATA as recommended for proton', async () => {
    const result = await handleToolCall('nds_get_charge_radius', { Z: 1, A: 1, mode: 'compare' });
    expect(result.isError).toBeUndefined();
    const rows = JSON.parse(result.content[0]!.text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.recommended_source).toBe('CODATA fundamental constants');
    expect(row.recommended_source_version).toBe('2022');
    expect(row.recommended_r_charge_fm).toBeCloseTo(0.84075, 6);
    expect(row.max_source_diff_fm).toBeCloseTo(0.03755, 5);
    const sources = row.source_values as Array<Record<string, unknown>>;
    const names = sources.map(source => source.source_name);
    expect(names).toContain('CODATA fundamental constants');
    expect(names).toContain('IAEA charge radii');
  });

  it('mode=best keeps only recommended source in source_values', async () => {
    const result = await handleToolCall('nds_get_charge_radius', { Z: 1, A: 1, mode: 'best' });
    expect(result.isError).toBeUndefined();
    const rows = JSON.parse(result.content[0]!.text) as Array<Record<string, unknown>>;
    const row = rows[0]!;
    const sources = row.source_values as Array<Record<string, unknown>>;
    expect(sources).toHaveLength(1);
    expect(sources[0]!.source_name).toBe('CODATA fundamental constants');
  });
});
