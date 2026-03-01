import { invalidParams, sqlite3JsonQuery, sqlStringLiteral } from '../shared/index.js';

export interface GetCodataConstantParams {
  name: string;
  case_sensitive?: boolean;
}

export interface ListCodataConstantsParams {
  query?: string;
  limit: number;
  offset: number;
  exact_only?: boolean;
}

interface CodataRow {
  quantity: string;
  value_text: string;
  uncertainty_text: string;
  unit: string;
  is_exact: number;
  is_truncated: number;
}

function normalizeQuantityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function requireCodataSchema(dbPath: string): Promise<void> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM codata_meta WHERE key='schema_version' LIMIT 1",
  );
  if (rows.length === 0) {
    throw invalidParams('CODATA schema is not initialized. Run: nds-mcp ingest --codata', {
      how_to: 'nds-mcp ingest --codata',
    });
  }
}

async function getCodataSource(dbPath: string): Promise<string> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM codata_meta WHERE key='upstream_version_or_snapshot' LIMIT 1",
  );
  const version = rows.length === 0
    ? 'unknown'
    : ((rows[0] as { value: string }).value || 'unknown');
  return `CODATA ${version}`;
}

function formatCodataRow(row: CodataRow, source: string): Record<string, unknown> {
  return {
    quantity: row.quantity,
    value: row.value_text,
    uncertainty: row.uncertainty_text,
    unit: row.unit,
    is_exact: row.is_exact === 1,
    is_truncated: row.is_truncated === 1,
    source,
  };
}

export async function getCodataConstant(
  dbPath: string,
  params: GetCodataConstantParams,
): Promise<Record<string, unknown> | null> {
  await requireCodataSchema(dbPath);
  const where = params.case_sensitive
    ? `quantity=${sqlStringLiteral(params.name.trim())}`
    : `quantity_key=${sqlStringLiteral(normalizeQuantityKey(params.name))}`;
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT quantity, value_text, uncertainty_text, unit, is_exact, is_truncated
     FROM codata_constants
     WHERE ${where}
     LIMIT 1`,
  );
  if (rows.length === 0) return null;
  return formatCodataRow(rows[0] as CodataRow, await getCodataSource(dbPath));
}

export async function listCodataConstants(
  dbPath: string,
  params: ListCodataConstantsParams,
): Promise<Record<string, unknown>> {
  await requireCodataSchema(dbPath);
  const conditions: string[] = [];
  if (params.query && params.query.trim().length > 0) {
    const normalized = normalizeQuantityKey(params.query);
    conditions.push(`quantity_key LIKE ${sqlStringLiteral(`%${normalized}%`)}`);
  }
  if (params.exact_only) {
    conditions.push('is_exact=1');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRows = await sqlite3JsonQuery(
    dbPath,
    `SELECT COUNT(*) AS total FROM codata_constants ${where}`,
  );
  const total = Number((countRows[0] as { total: number | string } | undefined)?.total ?? 0);

  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT quantity, value_text, uncertainty_text, unit, is_exact, is_truncated
     FROM codata_constants
     ${where}
     ORDER BY quantity
     LIMIT ${params.limit}
     OFFSET ${params.offset}`,
  );

  const source = await getCodataSource(dbPath);
  return {
    total,
    limit: params.limit,
    offset: params.offset,
    items: (rows as CodataRow[]).map(row => formatCodataRow(row, source)),
  };
}
