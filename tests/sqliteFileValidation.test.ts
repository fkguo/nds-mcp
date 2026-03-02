import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertSqliteHeader,
  validateSqliteFile,
} from '../src/db/sqliteFileValidation.js';

function createTempFile(content: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-sqlite-check-'));
  const file = path.join(dir, 'db.sqlite');
  fs.writeFileSync(file, content);
  return file;
}

function cleanupTempFile(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.unlinkSync(filePath);
  fs.rmdirSync(dir);
}

describe('sqliteFileValidation', () => {
  it('accepts sqlite header', () => {
    const filePath = createTempFile(Buffer.concat([
      Buffer.from('SQLite format 3\0', 'utf8'),
      Buffer.alloc(64),
    ]));
    expect(() => assertSqliteHeader(filePath)).not.toThrow();
    cleanupTempFile(filePath);
  });

  it('rejects non-sqlite header', () => {
    const filePath = createTempFile(Buffer.from('not-a-sqlite-file'));
    expect(() => assertSqliteHeader(filePath)).toThrow(/Invalid SQLite file header/);
    cleanupTempFile(filePath);
  });

  it('validates sqlite file (size + header)', async () => {
    const filePath = createTempFile(Buffer.concat([
      Buffer.from('SQLite format 3\0', 'utf8'),
      Buffer.from('payload'),
    ]));
    await expect(validateSqliteFile(filePath)).resolves.toBeUndefined();
    cleanupTempFile(filePath);
  });
});
