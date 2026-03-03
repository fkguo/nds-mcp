import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleToolCall } from '../src/tools/dispatcher.js';
import { sqlite3JsonQuery } from '../src/shared/index.js';

const FIXTURE_DB = path.resolve(__dirname, '..', 'fixtures', 'sample.sqlite');

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

describe('universal query tools (nds_schema, nds_query)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-universal-query-'));
  const testDb = path.join(tmpRoot, 'universal.sqlite');
  let originalEnv: string | undefined;

  beforeAll(() => {
    fs.copyFileSync(FIXTURE_DB, testDb);
    runSql(
      testDb,
      `
CREATE TABLE IF NOT EXISTS test_raw_archives (
  rel_path TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL
);
INSERT OR REPLACE INTO test_raw_archives VALUES ('a.zip', 3, 'deadbeef', X'001122');

CREATE TABLE IF NOT EXISTS test_points (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL,
  point_index INTEGER NOT NULL,
  e_eV REAL NOT NULL,
  sigma_b REAL NOT NULL,
  UNIQUE(xs_id, point_index)
);
INSERT OR REPLACE INTO test_points(xs_id, point_index, e_eV, sigma_b) VALUES (1, 0, 1.0, 10.0);
INSERT OR REPLACE INTO test_points(xs_id, point_index, e_eV, sigma_b) VALUES (1, 1, 2.0, 20.0);
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

  it('nds_schema returns tables + columns (no indexes by default)', async () => {
    const result = await handleToolCall('nds_schema', { library: 'nds' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);

    const tables = data.tables as any[];
    const raw = tables.find(t => t.name === 'test_raw_archives');
    expect(raw).toBeDefined();
    expect(raw.indexes).toBeUndefined();

    const contentCol = raw.columns.find((c: any) => c.name === 'content');
    expect(contentCol).toBeDefined();
    expect(String(contentCol.type).toUpperCase()).toContain('BLOB');
  });

  it('nds_schema include_indexes returns index metadata', async () => {
    const result = await handleToolCall('nds_schema', { library: 'nds', include_indexes: true });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    const tables = data.tables as any[];
    const points = tables.find(t => t.name === 'test_points');
    expect(points).toBeDefined();
    expect(Array.isArray(points.indexes)).toBe(true);
    expect(points.indexes.length).toBeGreaterThan(0);
  });

  it('standard mode rejects DDEP library', async () => {
    const schema = await handleToolCall('nds_schema', { library: 'ddep' }, 'standard');
    expect(schema.isError).toBe(true);
    expect(JSON.parse(schema.content[0]!.text).error.code).toBe('INVALID_PARAMS');

    const query = await handleToolCall(
      'nds_query',
      { library: 'ddep', table: 'ddep_nuclides', limit: 1 },
      'standard',
    );
    expect(query.isError).toBe(true);
    expect(JSON.parse(query.content[0]!.text).error.code).toBe('INVALID_PARAMS');
  });

  it('nds_query excludes BLOB columns from default select', async () => {
    const result = await handleToolCall('nds_query', {
      library: 'nds',
      table: 'test_raw_archives',
      limit: 10,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows.length).toBe(1);
    expect(data.rows[0].content).toBeUndefined();
    expect(String(data.note)).toContain('Excluded BLOB columns');
  });

  it('nds_query forbids explicit BLOB selection', async () => {
    const result = await handleToolCall('nds_query', {
      library: 'nds',
      table: 'test_raw_archives',
      select: ['content'],
      limit: 10,
    });
    expect(result.isError).toBe(true);
    const err = JSON.parse(result.content[0]!.text);
    expect(err.error.code).toBe('INVALID_PARAMS');
  });

  it('nds_query requires limit', async () => {
    const result = await handleToolCall('nds_query', { library: 'nds', table: 'ame_masses' } as any);
    expect(result.isError).toBe(true);
    const err = JSON.parse(result.content[0]!.text);
    expect(err.error.code).toBe('INVALID_PARAMS');
  });

  it('*_points requires high-selectivity equality filter', async () => {
    const result = await handleToolCall('nds_query', {
      library: 'nds',
      table: 'test_points',
      limit: 10,
    });
    expect(result.isError).toBe(true);
    const err = JSON.parse(result.content[0]!.text);
    expect(err.error.code).toBe('INVALID_PARAMS');
  });

  it('*_points query works with where.eq.xs_id', async () => {
    const result = await handleToolCall('nds_query', {
      library: 'nds',
      table: 'test_points',
      where: { eq: { xs_id: 1 } },
      order_by: [{ col: 'point_index', dir: 'asc' }],
      limit: 10,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.page.limit).toBe(10);
    expect(data.rows.length).toBe(2);
  });

  it('limit is capped server-side', async () => {
    const result = await handleToolCall('nds_query', {
      library: 'nds',
      table: 'ame_masses',
      limit: 999999,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.page.limit).toBe(5000);
    expect(String(data.note)).toContain('Capped limit');
  });

  it('identifier allowlist rejects injection-like table names', async () => {
    const result = await handleToolCall('nds_query', {
      library: 'nds',
      table: 'ame_masses; drop table ame_masses;',
      limit: 1,
    });
    expect(result.isError).toBe(true);
    const err = JSON.parse(result.content[0]!.text);
    expect(err.error.code).toBe('INVALID_PARAMS');
  });

  it('sqlite3JsonQuery enforces wall-time timeout', async () => {
    await expect(
      sqlite3JsonQuery(
        testDb,
        `WITH RECURSIVE cnt(x) AS (
           SELECT 1
           UNION ALL
           SELECT x+1 FROM cnt LIMIT 100000000
         )
         SELECT sum(x) AS s FROM cnt`,
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});

