import { sqlite3JsonQuery, sqlStringLiteral } from '../shared/index.js';

export interface EnsdfReferenceResult {
  A: number;
  keynumber: string;
  type: string | null;
  reference: string | null;
}

function mapReferenceRow(r: Record<string, unknown>): EnsdfReferenceResult {
  return {
    A: r.A as number,
    keynumber: r.keynumber as string,
    type: r.type as string | null,
    reference: r.reference as string | null,
  };
}

export async function lookupReference(
  dbPath: string,
  params: { keynumber?: string; A?: number }
): Promise<EnsdfReferenceResult[]> {
  const conditions: string[] = [];

  if (params.keynumber) {
    conditions.push(`keynumber=${sqlStringLiteral(params.keynumber)}`);
  }
  if (params.A !== undefined) {
    conditions.push(`A=${params.A}`);
  }

  if (conditions.length === 0) return [];

  const sql = `SELECT * FROM ensdf_references WHERE ${conditions.join(' AND ')} ORDER BY keynumber`;
  const rows = await sqlite3JsonQuery(dbPath, sql);
  return rows.map(r => mapReferenceRow(r as Record<string, unknown>));
}
