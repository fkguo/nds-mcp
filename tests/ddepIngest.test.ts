import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ingestDdep } from '../src/ingest/buildDdepDb.js';

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

describe('DDEP ingest metadata contract', () => {
  it('writes required metadata keys and DDEP-specific meta', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-ddep-ingest-'));
    const dbPath = path.join(tmpRoot, 'ddep.sqlite');
    const sourcePath = path.join(tmpRoot, 'ddep.jsonl');

    try {
      fs.writeFileSync(
        sourcePath,
        `${JSON.stringify({
          Z: 27,
          A: 60,
          state: 0,
          nuclide: '60Co',
          half_life: {
            value: 5.2713,
            uncertainty: 0.0008,
            unit: 'y',
            seconds: 166322000,
          },
          decay_mode: 'beta-',
          source_label: 'DDEP 2026',
          release: '2026-01',
          lines: [
            { type: 'gamma', energy_keV: 1173.228, intensity: 0.9985, is_primary: true },
            { type: 'gamma', energy_keV: 1332.492, intensity: 0.9998, is_primary: true },
          ],
        })}\n`,
      );

      const result = await ingestDdep(dbPath, sourcePath, '2026-01');
      expect(result.nuclides).toBe(1);
      expect(result.lines).toBe(2);

      const meta = readMeta(dbPath, 'ddep_meta');
      for (const key of REQUIRED_META_KEYS) {
        expect(meta[key]).toBeDefined();
      }
      expect(meta.schema_version).toBe('1');
      expect(meta.upstream_name).toBe('DDEP');
      expect(meta.ddep_schema_version).toBe('1');
      expect(meta.ddep_release).toBe('2026-01');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
