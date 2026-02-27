import { sqlite3JsonQuery } from '../shared/index.js';

export interface EnsdfLevelResult {
  level_id: number;
  dataset_id: number;
  Z: number;
  A: number;
  element: string;
  energy_keV: number;
  energy_raw: string;
  energy_unc_keV: number | null;
  spin_parity: string | null;
  half_life: string | null;
  half_life_seconds: number | null;
  half_life_unc_seconds: number | null;
  isomer_flag: string | null;
  questionable: boolean;
  comment_flag: string | null;
  dataset_type: string;
  dsid: string;
}

export interface TunlLevelResult {
  tunl_level_id: number;
  Z: number;
  A: number;
  element: string;
  energy_keV: number;
  energy_unc_keV: number | null;
  energy_raw: string | null;
  spin_parity: string | null;
  isospin: string | null;
  width_keV: number | null;
  width_unc_keV: number | null;
  width_raw: string | null;
  width_relation: string | null;
  half_life: string | null;
  decay_modes: string | null;
  evaluation: string;
  table_label: string | null;
}

export type UnifiedLevelResult =
  | (EnsdfLevelResult & { source: 'ENSDF' })
  | (TunlLevelResult & { source: 'TUNL' });

function mapLevelRow(r: Record<string, unknown>): EnsdfLevelResult {
  return {
    level_id: r.level_id as number,
    dataset_id: r.dataset_id as number,
    Z: r.Z as number,
    A: r.A as number,
    element: r.element as string,
    energy_keV: r.energy_keV as number,
    energy_raw: r.energy_raw as string,
    energy_unc_keV: r.energy_unc_keV as number | null,
    spin_parity: r.spin_parity as string | null,
    half_life: r.half_life as string | null,
    half_life_seconds: r.half_life_seconds as number | null,
    half_life_unc_seconds: r.half_life_unc_seconds as number | null,
    isomer_flag: r.isomer_flag as string | null,
    questionable: (r.questionable as number) === 1,
    comment_flag: r.comment_flag as string | null,
    dataset_type: r.dataset_type as string,
    dsid: r.dsid as string,
  };
}

export async function queryLevels(
  dbPath: string,
  params: {
    Z: number;
    A: number;
    energy_min?: number;
    energy_max?: number;
    include_decay_datasets?: boolean;
    limit?: number;
  }
): Promise<EnsdfLevelResult[]> {
  const conditions: string[] = [
    `l.Z=${params.Z}`,
    `l.A=${params.A}`,
  ];

  if (!params.include_decay_datasets) {
    conditions.push(`d.dataset_type LIKE 'ADOPTED%'`);
  }
  if (params.energy_min !== undefined) {
    conditions.push(`l.energy_keV >= ${params.energy_min}`);
  }
  if (params.energy_max !== undefined) {
    conditions.push(`l.energy_keV <= ${params.energy_max}`);
  }

  const limit = params.limit ?? 100;
  const sql = `SELECT l.*, d.dataset_type, d.dsid FROM ensdf_levels l JOIN ensdf_datasets d ON l.dataset_id = d.dataset_id WHERE ${conditions.join(' AND ')} ORDER BY l.energy_keV, l.level_id LIMIT ${limit}`;

  const rows = await sqlite3JsonQuery(dbPath, sql);
  return rows.map(r => mapLevelRow(r as Record<string, unknown>));
}

// ── TUNL levels query ──────────────────────────────────────────────────────

function mapTunlRow(r: Record<string, unknown>): TunlLevelResult {
  return {
    tunl_level_id: r.tunl_level_id as number,
    Z: r.Z as number,
    A: r.A as number,
    element: r.element as string,
    energy_keV: r.energy_keV as number,
    energy_unc_keV: r.energy_unc_keV as number | null,
    energy_raw: (r.energy_raw as string | null) ?? null,
    spin_parity: r.spin_parity as string | null,
    isospin: r.isospin as string | null,
    width_keV: r.width_keV as number | null,
    width_unc_keV: r.width_unc_keV as number | null,
    width_raw: r.width_raw as string | null,
    width_relation: r.width_relation as string | null,
    half_life: r.half_life as string | null,
    decay_modes: r.decay_modes as string | null,
    evaluation: r.evaluation as string,
    table_label: (r.table_label as string | null) ?? null,
  };
}

export async function queryTunlLevels(
  dbPath: string,
  params: {
    Z: number;
    A: number;
    energy_min?: number;
    energy_max?: number;
    limit?: number;
  }
): Promise<TunlLevelResult[]> {
  const conditions: string[] = [
    `Z=${params.Z}`,
    `A=${params.A}`,
  ];
  if (params.energy_min !== undefined) {
    conditions.push(`energy_keV >= ${params.energy_min}`);
  }
  if (params.energy_max !== undefined) {
    conditions.push(`energy_keV <= ${params.energy_max}`);
  }

  const limit = params.limit ?? 100;
  const sql = `SELECT * FROM tunl_levels WHERE ${conditions.join(' AND ')} ORDER BY energy_keV, tunl_level_id LIMIT ${limit}`;

  try {
    const rows = await sqlite3JsonQuery(dbPath, sql);
    return rows.map(r => mapTunlRow(r as Record<string, unknown>));
  } catch (err: unknown) {
    // Only swallow "no such table" errors for backward compatibility with older DBs
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table:\s*tunl_levels/i.test(msg)) {
      return [];
    }
    throw err;
  }
}

// ── Unified levels query (ENSDF + TUNL merged) ────────────────────────────

export async function queryAllLevels(
  dbPath: string,
  params: {
    Z: number;
    A: number;
    energy_min?: number;
    energy_max?: number;
    include_decay_datasets?: boolean;
    include_tunl?: boolean;
    limit?: number;
  }
): Promise<UnifiedLevelResult[]> {
  const results: UnifiedLevelResult[] = [];

  // ENSDF levels
  const ensdfRows = await queryLevels(dbPath, params);
  for (const r of ensdfRows) {
    results.push({ ...r, source: 'ENSDF' as const });
  }

  // TUNL levels (only for A ≤ 20 by default, or when explicitly requested)
  const includeTunl = params.include_tunl ?? (params.A <= 20);
  if (includeTunl) {
    const tunlRows = await queryTunlLevels(dbPath, params);
    for (const r of tunlRows) {
      results.push({ ...r, source: 'TUNL' as const });
    }
  }

  // Sort by energy, with source as tie-breaker for stable ordering
  // WARNING: This fetch-N-from-each-then-sort-and-slice strategy is correct for
  // limit-only queries but will break if offset/pagination is ever added.
  // Adding pagination requires either SQL UNION ALL or fetching all rows in
  // the energy window before limiting.
  results.sort((a, b) =>
    a.energy_keV - b.energy_keV
    || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
    || ('level_id' in a ? (a as EnsdfLevelResult).level_id : 0)
      - ('level_id' in b ? (b as EnsdfLevelResult).level_id : 0)
    || ('tunl_level_id' in a ? (a as TunlLevelResult).tunl_level_id : 0)
      - ('tunl_level_id' in b ? (b as TunlLevelResult).tunl_level_id : 0)
  );

  // Apply limit
  const limit = params.limit ?? 100;
  return results.slice(0, limit);
}
