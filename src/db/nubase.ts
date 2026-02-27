import { sqlite3JsonQuery, sqlStringLiteral, invalidParams } from '../shared/index.js';

export interface NubaseResult {
  Z: number;
  A: number;
  element: string;
  isomer_index: number;
  mass_excess_keV: number | null;
  mass_excess_unc_keV: number | null;
  excitation_energy_keV: number | null;
  half_life: string;
  half_life_seconds: number | null;
  half_life_unc_seconds: number | null;
  spin_parity: string;
  decay_modes: string;
  is_estimated: boolean;
}

function mapRow(r: Record<string, unknown>): NubaseResult {
  return {
    Z: r.Z as number,
    A: r.A as number,
    element: r.element as string,
    isomer_index: r.isomer_index as number,
    mass_excess_keV: r.mass_excess_keV as number | null,
    mass_excess_unc_keV: r.mass_excess_unc_keV as number | null,
    excitation_energy_keV: r.excitation_energy_keV as number | null,
    half_life: r.half_life as string,
    half_life_seconds: r.half_life_seconds as number | null,
    half_life_unc_seconds: r.half_life_unc_seconds as number | null,
    spin_parity: r.spin_parity as string,
    decay_modes: r.decay_modes as string,
    is_estimated: (r.is_estimated as number) === 1,
  };
}

export async function getDecay(dbPath: string, Z: number, A: number): Promise<NubaseResult[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT * FROM nubase WHERE Z=${Z} AND A=${A} ORDER BY isomer_index`
  );
  return rows.map(r => mapRow(r as Record<string, unknown>));
}

export async function findNuclidesByElement(dbPath: string, element: string): Promise<NubaseResult[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT * FROM nubase WHERE element=${sqlStringLiteral(element)} ORDER BY A, isomer_index`
  );
  return rows.map(r => mapRow(r as Record<string, unknown>));
}

export async function findNuclideByZA(dbPath: string, Z: number, A: number): Promise<NubaseResult[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT * FROM nubase WHERE Z=${Z} AND A=${A} ORDER BY isomer_index`
  );
  return rows.map(r => mapRow(r as Record<string, unknown>));
}

export async function findNuclidesByA(dbPath: string, A: number): Promise<NubaseResult[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT * FROM nubase WHERE A=${A} ORDER BY Z, isomer_index`
  );
  return rows.map(r => mapRow(r as Record<string, unknown>));
}

const ALLOWED_SEARCH_COLUMNS: Record<string, string> = {
  half_life: 'half_life_seconds',
  mass_excess: 'mass_excess_keV',
  half_life_seconds: 'half_life_seconds',
  mass_excess_keV: 'mass_excess_keV',
};

export async function searchNuclides(
  dbPath: string,
  property: string,
  min?: number,
  max?: number,
  Z_min?: number,
  Z_max?: number,
  limit: number = 50
): Promise<NubaseResult[]> {
  const column = ALLOWED_SEARCH_COLUMNS[property];
  if (!column) {
    throw invalidParams(`Unknown search property: ${property}`);
  }

  const conditions: string[] = [];

  if (Z_min !== undefined) conditions.push(`Z >= ${Z_min}`);
  if (Z_max !== undefined) conditions.push(`Z <= ${Z_max}`);

  if (min !== undefined) conditions.push(`${column} >= ${min}`);
  if (max !== undefined) conditions.push(`${column} <= ${max}`);

  // Only ground states for search
  conditions.push('isomer_index = 0');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT * FROM nubase ${where} ORDER BY Z, A LIMIT ${limit}`
  );
  return rows.map(r => mapRow(r as Record<string, unknown>));
}
