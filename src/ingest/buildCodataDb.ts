import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { buildRequiredLibraryMeta, detectSourceKind, normalizeMetaValues } from './metaContract.js';
import { downloadFile } from '../db/download.js';

export const DEFAULT_CODATA_ASCII_URL = 'https://physics.nist.gov/cuu/Constants/Table/allascii.txt';
const CODATA_UPSTREAM_URL = 'https://physics.nist.gov/cuu/Constants/index.html';
export const CODATA_SCHEMA_SQL = `
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
`;
export const CODATA_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_codata_quantity ON codata_constants(quantity);
`;

interface CodataRecord {
  quantity: string;
  quantity_key: string;
  value_text: string;
  uncertainty_text: string;
  unit: string;
  is_exact: 0 | 1;
  is_truncated: 0 | 1;
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

function ensureSchema(dbPath: string): void {
  runSql(dbPath, CODATA_SCHEMA_SQL);
  runSql(dbPath, CODATA_INDEX_SQL);
}

function normalizeQuantityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isHttpUrl(sourcePath: string): boolean {
  return /^https?:\/\//i.test(sourcePath);
}

async function loadSourceText(sourcePath: string): Promise<string> {
  if (!isHttpUrl(sourcePath)) {
    return fs.readFileSync(sourcePath, 'utf-8');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-codata-src-'));
  const tmpFile = path.join(tmpRoot, 'codata-allscii.txt');
  try {
    await downloadFile(sourcePath, tmpFile, 'CODATA allascii', { timeoutMs: 2 * 60 * 1000 });
    return fs.readFileSync(tmpFile, 'utf-8');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function parseCodataAscii(content: string): { version: string; records: CodataRecord[] } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const versionMatch = normalized.match(/\b(\d{4})\s+CODATA adjustment\b/i);
  const version = versionMatch?.[1] ?? 'unknown';

  let dataStart = -1;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index]?.includes('Quantity') && lines[index]?.includes('Uncertainty')) {
      const next = lines[index + 1] ?? '';
      if (/^-{20,}$/.test(next.trim())) {
        dataStart = index + 2;
        break;
      }
    }
  }
  if (dataStart < 0) {
    throw new Error('Unsupported CODATA allascii format: data header not found');
  }

  const records: CodataRecord[] = [];
  for (const line of lines.slice(dataStart)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const quantity = line.slice(0, 60).trim();
    const valueText = line.slice(60, 85).trim();
    const uncertaintyText = line.slice(85, 110).trim();
    const unit = line.slice(110).trim();

    if (!quantity || !valueText || !uncertaintyText) continue;

    records.push({
      quantity,
      quantity_key: normalizeQuantityKey(quantity),
      value_text: valueText,
      uncertainty_text: uncertaintyText,
      unit,
      is_exact: uncertaintyText.toLowerCase() === '(exact)' ? 1 : 0,
      is_truncated: valueText.includes('...') || uncertaintyText.includes('...') ? 1 : 0,
    });
  }
  return { version, records };
}

function replaceMetaTable(dbPath: string, tableName: string, meta: Record<string, string>): void {
  const inserts = Object.entries(meta)
    .map(([key, value]) => (
      `INSERT OR REPLACE INTO ${tableName}(key, value) VALUES ('${sqlEscape(key)}', '${sqlEscape(value)}');`
    ))
    .join('\n');
  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM ${tableName};
${inserts}
COMMIT;
`,
  );
}

export async function ingestCodata(
  dbPath: string,
  sourcePath: string = DEFAULT_CODATA_ASCII_URL,
): Promise<{
  constants: number;
  upstream_version_or_snapshot: string;
  source_kind: 'built_from_upstream' | 'imported_sqlite' | 'imported_jsonl';
}> {
  ensureSchema(dbPath);

  const content = await loadSourceText(sourcePath);
  const parsed = parseCodataAscii(content);
  const sourceKind = detectSourceKind(sourcePath);

  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM codata_constants;
COMMIT;
`,
  );

  const inserts = parsed.records.map((record) => (
    `INSERT INTO codata_constants(quantity, quantity_key, value_text, uncertainty_text, unit, is_exact, is_truncated)
     VALUES ('${sqlEscape(record.quantity)}', '${sqlEscape(record.quantity_key)}',
             '${sqlEscape(record.value_text)}', '${sqlEscape(record.uncertainty_text)}',
             '${sqlEscape(record.unit)}', ${record.is_exact}, ${record.is_truncated});`
  )).join('\n');
  runSql(
    dbPath,
    `
BEGIN;
${inserts}
COMMIT;
`,
  );

  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind,
    upstreamName: 'CODATA',
    upstreamUrl: CODATA_UPSTREAM_URL,
    upstreamVersionOrSnapshot: parsed.version,
  });
  const extraMeta = normalizeMetaValues({
    codata_release: parsed.version,
    codata_source_url: sourcePath,
  });
  replaceMetaTable(dbPath, 'codata_meta', {
    ...extraMeta,
    ...requiredMeta,
  });

  return {
    constants: parsed.records.length,
    upstream_version_or_snapshot: parsed.version,
    source_kind: sourceKind,
  };
}
