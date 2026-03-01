import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleToolCall } from '../src/tools/dispatcher.js';

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

describe('CODATA tools', () => {
  const savedNdsDbPath = process.env.NDS_DB_PATH;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-codata-tools-'));
  const ndsDb = path.join(tmpRoot, 'nds.sqlite');

  beforeAll(() => {
    runSql(
      ndsDb,
      `
CREATE TABLE nds_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
  ('speed of light in vacuum', 'speed of light in vacuum', '299 792 458', '(exact)', 'm s^-1', 1, 0),
  ('Planck constant', 'planck constant', '6.626 070 15 e-34', '(exact)', 'J Hz^-1', 1, 0),
  ('Planck constant in eV/Hz', 'planck constant in ev/hz', '4.135 667 696... e-15', '(exact)', 'eV Hz^-1', 1, 1);
`,
    );
    process.env.NDS_DB_PATH = ndsDb;
  });

  afterAll(() => {
    if (savedNdsDbPath === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = savedNdsDbPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('nds_get_constant resolves name case-insensitively', async () => {
    const result = await handleToolCall('nds_get_constant', { name: 'Planck CONSTANT' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.quantity).toBe('Planck constant');
    expect(data.value).toBe('6.626 070 15 e-34');
    expect(data.is_exact).toBe(true);
  });

  it('nds_list_constants supports keyword filter and pagination', async () => {
    const result = await handleToolCall('nds_list_constants', { query: 'planck', limit: 1, offset: 1 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.items).toHaveLength(1);
    expect(data.total).toBe(2);
    expect(data.items[0].quantity).toContain('Planck');
  });
});
