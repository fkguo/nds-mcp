import { sqlite3JsonQuery } from '../shared/index.js';

export interface MassResult {
  Z: number;
  A: number;
  element: string;
  mass_excess_keV: number | null;
  mass_excess_unc_keV: number | null;
  binding_energy_per_A_keV: number | null;
  binding_energy_per_A_unc_keV: number | null;
  beta_decay_energy_keV: number | null;
  beta_decay_energy_unc_keV: number | null;
  atomic_mass_micro_u: number | null;
  atomic_mass_unc_micro_u: number | null;
  is_estimated: boolean;
}

export async function getMass(dbPath: string, Z: number, A: number): Promise<MassResult | null> {
  const rows = await sqlite3JsonQuery(dbPath, `SELECT * FROM ame_masses WHERE Z=${Z} AND A=${A}`);
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    Z: r.Z as number,
    A: r.A as number,
    element: r.element as string,
    mass_excess_keV: r.mass_excess_keV as number | null,
    mass_excess_unc_keV: r.mass_excess_unc_keV as number | null,
    binding_energy_per_A_keV: r.binding_energy_per_A_keV as number | null,
    binding_energy_per_A_unc_keV: r.binding_energy_per_A_unc_keV as number | null,
    beta_decay_energy_keV: r.beta_decay_energy_keV as number | null,
    beta_decay_energy_unc_keV: r.beta_decay_energy_unc_keV as number | null,
    atomic_mass_micro_u: r.atomic_mass_micro_u as number | null,
    atomic_mass_unc_micro_u: r.atomic_mass_unc_micro_u as number | null,
    is_estimated: (r.is_estimated as number) === 1,
  };
}