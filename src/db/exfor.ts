import { invalidParams, sqlite3JsonQuery } from '../shared/index.js';

export interface SearchExforParams {
  Z: number;
  A?: number;
  state: number;
  projectile: 'n' | 'p' | 'g' | 'd' | 'a' | 'h';
  reaction?: string;
  quantity: 'SIG' | 'MACS' | 'DA' | 'DE' | 'FY';
  e_min_eV?: number;
  e_max_eV?: number;
  kT_min_keV?: number;
  kT_max_keV?: number;
  limit: number;
}

export interface GetExforEntryParams {
  entry_id: string;
}

async function requireExforSchema(dbPath: string): Promise<void> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='exfor_entries'",
  );
  if (rows.length === 0) {
    throw invalidParams('EXFOR schema is not initialized. Run: nds-mcp ingest --exfor', {
      how_to: 'nds-mcp ingest --exfor',
    });
  }
}

export async function searchExfor(dbPath: string, params: SearchExforParams): Promise<unknown[]> {
  await requireExforSchema(dbPath);

  const conditions: string[] = [
    `e.target_Z=${params.Z}`,
    `e.state=${params.state}`,
    `e.projectile='${params.projectile}'`,
    `e.quantity='${params.quantity}'`,
  ];
  if (params.A !== undefined) conditions.push(`e.target_A=${params.A}`);
  if (params.reaction !== undefined) {
    conditions.push(`e.reaction='${params.reaction.replaceAll("'", "''")}'`);
  }

  if (params.quantity === 'MACS') {
    if (params.kT_min_keV !== undefined) conditions.push(`p.kT_keV >= ${params.kT_min_keV}`);
    if (params.kT_max_keV !== undefined) conditions.push(`p.kT_keV <= ${params.kT_max_keV}`);
  } else {
    if (params.e_min_eV !== undefined) conditions.push(`p.energy_eV >= ${params.e_min_eV}`);
    if (params.e_max_eV !== undefined) conditions.push(`p.energy_eV <= ${params.e_max_eV}`);
  }

  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT
       e.entry_id,
       e.subentry_id,
       e.reaction,
       e.quantity,
       e.reference,
       e.year,
       p.point_index,
       p.energy_eV,
       p.kT_keV,
       p.value,
       p.uncertainty
     FROM exfor_entries e
     JOIN exfor_points p ON p.entry_id=e.entry_id AND p.subentry_id=e.subentry_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.entry_id, e.subentry_id, p.point_index
     LIMIT ${params.limit}`,
  );
  return rows;
}

export async function getExforEntry(dbPath: string, params: GetExforEntryParams): Promise<Record<string, unknown> | null> {
  await requireExforSchema(dbPath);

  const safeEntryId = params.entry_id.replaceAll("'", "''");
  const entries = await sqlite3JsonQuery(
    dbPath,
    `SELECT *
     FROM exfor_entries
     WHERE entry_id='${safeEntryId}'
     ORDER BY subentry_id`,
  );
  if (entries.length === 0) return null;

  const points = await sqlite3JsonQuery(
    dbPath,
    `SELECT *
     FROM exfor_points
     WHERE entry_id='${safeEntryId}'
     ORDER BY subentry_id, point_index`,
  );

  return { entry_id: params.entry_id, entries, points };
}
