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

describe('catalog + raw-archive tools (nds_catalog, nds_list_raw_archives)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-catalog-raw-'));
  const testDb = path.join(tmpRoot, 'catalog.sqlite');

  let originalNdsDbPath: string | undefined;
  let originalFendlDbPath: string | undefined;
  let originalIrdffDbPath: string | undefined;

  beforeAll(() => {
    fs.copyFileSync(FIXTURE_DB, testDb);

    runSql(
      testDb,
      `
CREATE TABLE IF NOT EXISTS fendl_raw_archives (
  rel_path TEXT PRIMARY KEY,
  projectile TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL
);
INSERT OR REPLACE INTO fendl_raw_archives VALUES ('n1.zip', 'n', 1, 'aaa', X'00');
INSERT OR REPLACE INTO fendl_raw_archives VALUES ('p1.zip', 'p', 1, 'bbb', X'00');
INSERT OR REPLACE INTO fendl_raw_archives VALUES ('n2.zip', 'n', 1, 'ccc', X'00');

CREATE TABLE IF NOT EXISTS irdff_raw_archives (
  rel_path TEXT PRIMARY KEY,
  projectile TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL
);
INSERT OR REPLACE INTO irdff_raw_archives VALUES ('irdff_n1.zip', 'n', 2, 'ddd', X'00');
`,
    );

    originalNdsDbPath = process.env.NDS_DB_PATH;
    originalFendlDbPath = process.env.NDS_FENDL_DB_PATH;
    originalIrdffDbPath = process.env.NDS_IRDFF_DB_PATH;

    process.env.NDS_DB_PATH = testDb;
    process.env.NDS_FENDL_DB_PATH = testDb;
    process.env.NDS_IRDFF_DB_PATH = testDb;
  });

  afterAll(() => {
    if (originalNdsDbPath === undefined) delete process.env.NDS_DB_PATH;
    else process.env.NDS_DB_PATH = originalNdsDbPath;

    if (originalFendlDbPath === undefined) delete process.env.NDS_FENDL_DB_PATH;
    else process.env.NDS_FENDL_DB_PATH = originalFendlDbPath;

    if (originalIrdffDbPath === undefined) delete process.env.NDS_IRDFF_DB_PATH;
    else process.env.NDS_IRDFF_DB_PATH = originalIrdffDbPath;

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('nds_catalog hides ddep in standard mode', async () => {
    const res = await handleToolCall('nds_catalog', {}, 'standard');
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0]!.text);
    expect(data.tool_mode).toBe('standard');
    expect(data.libraries.ddep).toBeUndefined();
  });

  it('nds_catalog includes ddep in full mode', async () => {
    const res = await handleToolCall('nds_catalog', {}, 'full');
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0]!.text);
    expect(data.tool_mode).toBe('full');
    expect(data.libraries.ddep).toBeDefined();
  });

  it('nds_list_raw_archives returns metadata only (no content blob)', async () => {
    const res = await handleToolCall('nds_list_raw_archives', { library: 'fendl32c', limit: 10 }, 'standard');
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0]!.text);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows.length).toBe(3);
    expect(data.rows[0].content).toBeUndefined();
  });

  it('nds_list_raw_archives supports projectile filter, q filter, and pagination', async () => {
    const onlyN = await handleToolCall(
      'nds_list_raw_archives',
      { library: 'fendl32c', projectile: 'n', limit: 10 },
      'standard',
    );
    expect(onlyN.isError).toBeUndefined();
    const onlyNData = JSON.parse(onlyN.content[0]!.text);
    expect(onlyNData.rows.length).toBe(2);
    for (const row of onlyNData.rows) expect(row.projectile).toBe('n');

    const q = await handleToolCall(
      'nds_list_raw_archives',
      { library: 'fendl32c', q: 'p1', limit: 10 },
      'standard',
    );
    expect(q.isError).toBeUndefined();
    const qData = JSON.parse(q.content[0]!.text);
    expect(qData.rows.length).toBe(1);
    expect(qData.rows[0].rel_path).toBe('p1.zip');

    const page = await handleToolCall(
      'nds_list_raw_archives',
      { library: 'fendl32c', limit: 1, offset: 1 },
      'standard',
    );
    expect(page.isError).toBeUndefined();
    const pageData = JSON.parse(page.content[0]!.text);
    expect(pageData.page.offset).toBe(1);
    expect(pageData.rows.length).toBe(1);
    expect(pageData.rows[0].rel_path).toBe('n2.zip');
  });

  it('nds_list_raw_archives caps limit server-side', async () => {
    const res = await handleToolCall(
      'nds_list_raw_archives',
      { library: 'irdff2', limit: 999999 },
      'standard',
    );
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0]!.text);
    expect(data.page.limit).toBe(5000);
    expect(String(data.note)).toContain('Capped limit');
  });
});

