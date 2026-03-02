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

interface ExforAvailabilityOverview {
  Z: number;
  projectiles: string[];
  quantities: string[];
  A_values: number[];
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

async function listAvailableForZ(dbPath: string, Z: number): Promise<ExforAvailabilityOverview | null> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT DISTINCT projectile, quantity, target_A
     FROM exfor_entries
     WHERE target_Z=${Z}
     ORDER BY projectile, quantity, target_A`,
  );
  if (rows.length === 0) return null;

  const projectiles = [...new Set(rows
    .map((row) => (row as { projectile?: unknown }).projectile)
    .filter((value): value is string => typeof value === 'string'))];
  const quantities = [...new Set(rows
    .map((row) => (row as { quantity?: unknown }).quantity)
    .filter((value): value is string => typeof value === 'string'))];
  const AValues = [...new Set(rows
    .map((row) => (row as { target_A?: unknown }).target_A)
    .filter((value): value is number => typeof value === 'number'))];

  return {
    Z,
    projectiles,
    quantities,
    A_values: AValues,
  };
}

function buildInvalidGuidance(
  params: SearchExforParams,
  violation: string,
  availableForZ: ExforAvailabilityOverview | null,
): Record<string, unknown> {
  const sampleA = params.A ?? availableForZ?.A_values[0] ?? 56;
  return {
    violation,
    parameter_rules: [
      {
        rule: 'quantity=MACS uses kT_min_keV/kT_max_keV and forbids e_min_eV/e_max_eV',
        type: 'mutual_exclusion',
      },
      {
        rule: 'quantity!=MACS allows e_min_eV/e_max_eV and forbids kT_min_keV/kT_max_keV',
        type: 'dependency',
      },
      {
        rule: 'e_min_eV must be <= e_max_eV when both are set',
        type: 'range',
      },
      {
        rule: 'kT_min_keV must be <= kT_max_keV when both are set',
        type: 'range',
      },
    ],
    example_calls: [
      {
        tool: 'nds_search_exfor',
        args: {
          Z: params.Z,
          A: sampleA,
          projectile: params.projectile,
          quantity: 'SIG',
          e_min_eV: 1e3,
          e_max_eV: 1e6,
          limit: 20,
        },
      },
      {
        tool: 'nds_search_exfor',
        args: {
          Z: params.Z,
          A: sampleA,
          projectile: params.projectile,
          quantity: 'MACS',
          kT_min_keV: 5,
          kT_max_keV: 100,
          limit: 20,
        },
      },
    ],
    available_for_Z: availableForZ,
  };
}

async function validateSearchExforParams(dbPath: string, params: SearchExforParams): Promise<void> {
  const hasEnergyWindow = params.e_min_eV !== undefined || params.e_max_eV !== undefined;
  const hasKTWindow = params.kT_min_keV !== undefined || params.kT_max_keV !== undefined;

  if (params.quantity === 'MACS' && hasEnergyWindow) {
    const availableForZ = await listAvailableForZ(dbPath, params.Z);
    throw invalidParams(
      'For MACS quantity, use kT_min_keV/kT_max_keV, not e_min_eV/e_max_eV',
      buildInvalidGuidance(params, 'macs_forbids_energy_window', availableForZ),
    );
  }
  if (params.quantity !== 'MACS' && hasKTWindow) {
    const availableForZ = await listAvailableForZ(dbPath, params.Z);
    throw invalidParams(
      'kT_min_keV/kT_max_keV are only valid when quantity=MACS',
      buildInvalidGuidance(params, 'non_macs_forbids_kt_window', availableForZ),
    );
  }
  if (params.e_min_eV !== undefined && params.e_max_eV !== undefined && params.e_min_eV > params.e_max_eV) {
    const availableForZ = await listAvailableForZ(dbPath, params.Z);
    throw invalidParams(
      'e_min_eV must be <= e_max_eV',
      buildInvalidGuidance(params, 'invalid_energy_window', availableForZ),
    );
  }
  if (params.kT_min_keV !== undefined && params.kT_max_keV !== undefined && params.kT_min_keV > params.kT_max_keV) {
    const availableForZ = await listAvailableForZ(dbPath, params.Z);
    throw invalidParams(
      'kT_min_keV must be <= kT_max_keV',
      buildInvalidGuidance(params, 'invalid_kt_window', availableForZ),
    );
  }
}

export async function searchExfor(dbPath: string, params: SearchExforParams): Promise<unknown[]> {
  await requireExforSchema(dbPath);
  await validateSearchExforParams(dbPath, params);

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
