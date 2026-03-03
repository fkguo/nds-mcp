import { invalidParams, sqlite3JsonQuery, sqlStringLiteral } from '../shared/index.js';
import { ensureDdepDb } from './ddepDb.js';
import { ensureExforDb } from './exforDb.js';
import { ensureFendlDb } from './fendlDb.js';
import { ensureIrdffDb } from './irdffDb.js';
import { ensureJendl5Db } from './jendl5Db.js';
import { requireNdsDbPathFromEnv } from './ndsDb.js';

export type UniversalQueryLibrary =
  | 'nds'
  | 'jendl5'
  | 'exfor'
  | 'fendl32c'
  | 'irdff2'
  | 'ddep';

export interface UniversalQueryColumn {
  name: string;
  type: string;
  notnull: boolean;
  pk: number;
  default: string | null;
}

export interface UniversalQueryIndex {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface UniversalQueryForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

export interface UniversalQueryTableSchema {
  name: string;
  type: 'table' | 'view';
  columns: UniversalQueryColumn[];
  foreign_keys: UniversalQueryForeignKey[];
  indexes?: UniversalQueryIndex[];
}

const IDENT_RE = /^[A-Za-z0-9_]+$/;

export function assertSafeIdentifier(identifier: string, kind: 'table' | 'column'): void {
  if (!IDENT_RE.test(identifier)) {
    throw invalidParams(`Invalid ${kind} identifier: ${identifier}`, {
      rule: 'Identifiers must match /^[A-Za-z0-9_]+$/',
      identifier,
      kind,
    });
  }
}

export async function resolveDbPathForLibrary(library: UniversalQueryLibrary): Promise<string> {
  switch (library) {
    case 'nds':
      return requireNdsDbPathFromEnv();
    case 'jendl5':
      return await ensureJendl5Db();
    case 'exfor':
      return await ensureExforDb();
    case 'fendl32c':
      return await ensureFendlDb();
    case 'irdff2':
      return await ensureIrdffDb();
    case 'ddep':
      return await ensureDdepDb();
    default: {
      const _exhaustive: never = library;
      throw invalidParams(`Unknown library: ${String(_exhaustive)}`);
    }
  }
}

export async function listTables(dbPath: string): Promise<Array<{ name: string; type: 'table' | 'view' }>> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT name, type
     FROM sqlite_master
     WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  );
  return rows
    .map((row) => {
      const r = row as { name?: unknown; type?: unknown };
      if (typeof r.name !== 'string') return null;
      if (r.type !== 'table' && r.type !== 'view') return null;
      return { name: r.name, type: r.type };
    })
    .filter((x): x is { name: string; type: 'table' | 'view' } => x !== null);
}

export async function getTableColumns(dbPath: string, table: string): Promise<UniversalQueryColumn[]> {
  const rows = await sqlite3JsonQuery(dbPath, `PRAGMA table_info(${sqlStringLiteral(table)})`);
  return rows
    .map((row) => {
      const r = row as {
        name?: unknown;
        type?: unknown;
        notnull?: unknown;
        pk?: unknown;
        dflt_value?: unknown;
      };
      if (typeof r.name !== 'string') return null;
      return {
        name: r.name,
        type: typeof r.type === 'string' ? r.type : '',
        notnull: Boolean(r.notnull),
        pk: typeof r.pk === 'number' ? r.pk : 0,
        default: typeof r.dflt_value === 'string' ? r.dflt_value : null,
      } satisfies UniversalQueryColumn;
    })
    .filter((x): x is UniversalQueryColumn => x !== null);
}

export async function getTableForeignKeys(dbPath: string, table: string): Promise<UniversalQueryForeignKey[]> {
  const rows = await sqlite3JsonQuery(dbPath, `PRAGMA foreign_key_list(${sqlStringLiteral(table)})`);
  return rows
    .map((row) => {
      const r = row as {
        id?: unknown;
        seq?: unknown;
        table?: unknown;
        from?: unknown;
        to?: unknown;
        on_update?: unknown;
        on_delete?: unknown;
        match?: unknown;
      };
      if (
        typeof r.id !== 'number'
        || typeof r.seq !== 'number'
        || typeof r.table !== 'string'
        || typeof r.from !== 'string'
        || typeof r.to !== 'string'
      ) {
        return null;
      }
      return {
        id: r.id,
        seq: r.seq,
        table: r.table,
        from: r.from,
        to: r.to,
        on_update: typeof r.on_update === 'string' ? r.on_update : '',
        on_delete: typeof r.on_delete === 'string' ? r.on_delete : '',
        match: typeof r.match === 'string' ? r.match : '',
      } satisfies UniversalQueryForeignKey;
    })
    .filter((x): x is UniversalQueryForeignKey => x !== null);
}

async function getIndexColumns(dbPath: string, indexName: string): Promise<string[]> {
  const rows = await sqlite3JsonQuery(dbPath, `PRAGMA index_info(${sqlStringLiteral(indexName)})`);
  return rows
    .map((row) => {
      const r = row as { name?: unknown };
      return typeof r.name === 'string' ? r.name : null;
    })
    .filter((x): x is string => x !== null);
}

export async function getTableIndexes(dbPath: string, table: string): Promise<UniversalQueryIndex[]> {
  const rows = await sqlite3JsonQuery(dbPath, `PRAGMA index_list(${sqlStringLiteral(table)})`);
  const indexes = rows
    .map((row) => {
      const r = row as { name?: unknown; unique?: unknown; origin?: unknown; partial?: unknown };
      if (typeof r.name !== 'string') return null;
      return {
        name: r.name,
        unique: Boolean(r.unique),
        origin: typeof r.origin === 'string' ? r.origin : '',
        partial: Boolean(r.partial),
      };
    })
    .filter((x): x is { name: string; unique: boolean; origin: string; partial: boolean } => x !== null);

  const withCols = await Promise.all(indexes.map(async (idx) => ({
    ...idx,
    columns: await getIndexColumns(dbPath, idx.name),
  })));

  return withCols;
}

export function isBlobColumn(col: UniversalQueryColumn): boolean {
  return /\bblob\b/i.test(col.type);
}
