import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ingestCodata } from '../src/ingest/buildCodataDb.js';

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

function readMeta(dbPath: string): Record<string, string> {
  const output = execFileSync(
    'sqlite3',
    ['-separator', '\t', dbPath, 'SELECT key, value FROM codata_meta ORDER BY key;'],
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

function queryRows(dbPath: string, sql: string): Array<Record<string, unknown>> {
  const output = execFileSync(
    'sqlite3',
    ['-json', dbPath, sql],
    { encoding: 'utf-8' },
  ).trim();
  if (!output) return [];
  return JSON.parse(output) as Array<Record<string, unknown>>;
}

describe('CODATA ingest', () => {
  it('ingests CODATA into nds.sqlite with normalized metadata and parsed constants', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-codata-ingest-'));
    const dbPath = path.join(tmpRoot, 'nds.sqlite');
    const sourcePath = path.join(tmpRoot, 'codata-allscii.txt');
    try {
      runSql(dbPath, "CREATE TABLE IF NOT EXISTS nds_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      runSql(dbPath, "INSERT OR REPLACE INTO nds_meta(key, value) VALUES('ame_version', 'AME2020');");

      const formatRow = (quantity: string, value: string, uncertainty: string, unit: string): string => (
        `${quantity.padEnd(60)}${value.padEnd(25)}${uncertainty.padEnd(25)}${unit}`
      );
      fs.writeFileSync(sourcePath, [
        '             Fundamental Physical Constants --- Complete Listing',
        '             2022 CODATA adjustment',
        '',
        '  Quantity                                                       Value                 Uncertainty           Unit',
        '-----------------------------------------------------------------------------------------------------------------------------',
        formatRow('speed of light in vacuum', '299 792 458', '(exact)', 'm s^-1'),
        formatRow('Planck constant in eV/Hz', '4.135 667 696... e-15', '(exact)', 'eV Hz^-1'),
      ].join('\n'));

      const result = await ingestCodata(dbPath, sourcePath);
      expect(result.constants).toBe(2);

      const meta = readMeta(dbPath);
      expect(meta.schema_version).toBe('1');
      expect(meta.generator).toBe('nds-mcp');
      expect(meta.generator_version).toBeDefined();
      expect(meta.source_kind).toBe('built_from_upstream');
      expect(meta.upstream_name).toBe('CODATA');
      expect(meta.upstream_url).toContain('physics.nist.gov');
      expect(meta.upstream_version_or_snapshot).toBe('2022');
      expect(Number.isNaN(Date.parse(meta.built_at))).toBe(false);

      const constants = queryRows(
        dbPath,
        "SELECT quantity, value_text, uncertainty_text, unit, is_exact, is_truncated FROM codata_constants ORDER BY quantity;",
      );
      expect(constants).toHaveLength(2);
      expect(constants[0]).toMatchObject({
        quantity: 'Planck constant in eV/Hz',
        is_exact: 1,
        is_truncated: 1,
      });
      expect(constants[1]).toMatchObject({
        quantity: 'speed of light in vacuum',
        is_exact: 1,
        is_truncated: 0,
      });

      const ndsMeta = queryRows(dbPath, "SELECT value FROM nds_meta WHERE key='ame_version';");
      expect(ndsMeta).toHaveLength(1);
      expect((ndsMeta[0] as { value: string }).value).toBe('AME2020');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
