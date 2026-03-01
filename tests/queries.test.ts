import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleToolCall } from '../src/tools/dispatcher.js';

const FIXTURE_DB = path.resolve(__dirname, '..', 'fixtures', 'sample.sqlite');

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

describe('NDS MCP tool queries', () => {
  let originalEnv: string | undefined;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-queries-fixture-'));
  const testDb = path.join(tmpRoot, 'sample-with-codata.sqlite');

  beforeAll(() => {
    fs.copyFileSync(FIXTURE_DB, testDb);
    runSql(
      testDb,
      `
CREATE TABLE IF NOT EXISTS codata_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codata_constants (
  id INTEGER PRIMARY KEY,
  quantity TEXT NOT NULL,
  quantity_key TEXT NOT NULL UNIQUE,
  value_text TEXT NOT NULL,
  uncertainty_text TEXT NOT NULL,
  unit TEXT NOT NULL,
  is_exact INTEGER NOT NULL DEFAULT 0,
  is_truncated INTEGER NOT NULL DEFAULT 0
);
INSERT OR REPLACE INTO codata_meta VALUES ('schema_version', '1');
INSERT OR REPLACE INTO codata_meta VALUES ('upstream_version_or_snapshot', '2022');
`,
    );

    originalEnv = process.env.NDS_DB_PATH;
    process.env.NDS_DB_PATH = testDb;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.NDS_DB_PATH;
    } else {
      process.env.NDS_DB_PATH = originalEnv;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('nds_info returns metadata', async () => {
    const result = await handleToolCall('nds_info', {});
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.ame_version).toBe('AME2020');
    expect(data.nubase_version).toBe('NUBASE2020');
    expect(data.sha256).toBeDefined();
    expect(data.main_db.status).toBe('ok');
    expect(data.jendl5_db.status).toBeDefined();
    expect(data.exfor_db.status).toBeDefined();
    expect(data.codata_meta === null || typeof data.codata_meta === 'object').toBe(true);
  });

  it('nds_get_mass returns Pb-208 mass data', async () => {
    const result = await handleToolCall('nds_get_mass', { Z: 82, A: 208 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.element).toBe('Pb');
    expect(data.mass_excess_keV).toBeCloseTo(-21748.5, 0);
    expect(data.binding_energy_per_A_keV).toBeCloseTo(7867.45, 1);
  });

  it('nds_get_mass returns NOT_FOUND for nonexistent nuclide', async () => {
    const result = await handleToolCall('nds_get_mass', { Z: 999, A: 999 });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('nds_get_separation_energy returns Pb-208 S2n', async () => {
    const result = await handleToolCall('nds_get_separation_energy', { Z: 82, A: 208, type: 'S2n' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.type).toBe('S2n');
    expect(data.value_keV).toBeCloseTo(14105.6, 0);
  });

  it('nds_get_separation_energy returns all types when type omitted', async () => {
    const result = await handleToolCall('nds_get_separation_energy', { Z: 82, A: 208 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.S2n).toBeDefined();
    expect(data.Sn).toBeDefined();
  });

  it('nds_get_q_value returns Pb-208 Q(alpha)', async () => {
    const result = await handleToolCall('nds_get_q_value', { Z: 82, A: 208, type: 'Qa' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.type).toBe('Qa');
    expect(data.value_keV).toBeCloseTo(516.7, 0);
  });

  it('nds_get_decay returns Pb-208 decay info', async () => {
    const result = await handleToolCall('nds_get_decay', { Z: 82, A: 208 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const gs = data.find((r: any) => r.isomer_index === 0);
    expect(gs).toBeDefined();
    expect(gs.half_life).toBe('stable');
    expect(gs.spin_parity).toContain('0+');
  });

  it('nds_get_charge_radius returns Pb-208 radius', async () => {
    const result = await handleToolCall('nds_get_charge_radius', { Z: 82, A: 208 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].r_charge_fm).toBeCloseTo(5.501, 2);
  });

  it('nds_get_charge_radius returns all isotopes when A omitted', async () => {
    const result = await handleToolCall('nds_get_charge_radius', { Z: 1 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.length).toBeGreaterThanOrEqual(2); // H-1, H-2
  });

  it('nds_find_nuclide finds by Z+A', async () => {
    const result = await handleToolCall('nds_find_nuclide', { Z: 82, A: 208 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it('nds_find_nuclide finds by element', async () => {
    const result = await handleToolCall('nds_find_nuclide', { element: 'He' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
  });

  it('nds_find_nuclide resolves lowercase element', async () => {
    const result = await handleToolCall('nds_find_nuclide', { element: 'he' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].element).toBe('He');
  });

  it('nds_find_nuclide rejects conflicting element and Z', async () => {
    const result = await handleToolCall('nds_find_nuclide', { element: 'He', Z: 82 });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error.code).toBe('INVALID_PARAMS');
  });

  it('nds_find_nuclide rejects unknown element symbol', async () => {
    const result = await handleToolCall('nds_find_nuclide', { element: 'Xx' });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error.code).toBe('INVALID_PARAMS');
  });

  it('nds_search finds by half_life range', async () => {
    const result = await handleToolCall('nds_search', {
      property: 'half_life_seconds',
      min: 1,
      max: 1000,
      limit: 10,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── Integration tests for TUNL merge (requires production DB with TUNL data) ──

const PROD_DB = path.join(process.env.HOME || '~', '.nds-mcp', 'nds.sqlite');
const hasProdDb = fs.existsSync(PROD_DB);

describe.skipIf(!hasProdDb)('nds_query_levels (TUNL merge)', () => {
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.NDS_DB_PATH;
    process.env.NDS_DB_PATH = PROD_DB;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.NDS_DB_PATH;
    } else {
      process.env.NDS_DB_PATH = originalEnv;
    }
  });

  it('results include source field for light nuclide', async () => {
    const result = await handleToolCall('nds_query_levels', { Z: 6, A: 12, limit: 20 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row.source).toMatch(/^(ENSDF|TUNL)$/);
    }
  });

  it('include_tunl: false excludes TUNL results', async () => {
    const result = await handleToolCall('nds_query_levels', { Z: 6, A: 12, include_tunl: false, limit: 50 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    for (const row of data) {
      expect(row.source).toBe('ENSDF');
    }
  });

  it('heavy nuclide (A > 20) excludes TUNL by default', async () => {
    const result = await handleToolCall('nds_query_levels', { Z: 82, A: 208, limit: 50 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    for (const row of data) {
      expect(row.source).toBe('ENSDF');
    }
  });

  it('deterministic ordering: two identical queries produce same output', async () => {
    const params = { Z: 6, A: 12, limit: 30 };
    const r1 = await handleToolCall('nds_query_levels', params);
    const r2 = await handleToolCall('nds_query_levels', params);
    expect(r1.content[0]!.text).toBe(r2.content[0]!.text);
  });

  it('TUNL results have table_label and energy_raw fields', async () => {
    const result = await handleToolCall('nds_query_levels', { Z: 6, A: 12, limit: 100 });
    const data = JSON.parse(result.content[0]!.text);
    const tunlRows = data.filter((r: any) => r.source === 'TUNL');
    expect(tunlRows.length).toBeGreaterThan(0);
    for (const row of tunlRows) {
      expect(row.table_label).toBeDefined();
      expect(row.energy_raw).toBeDefined();
    }
  });
});
