import { sqlite3JsonQuery } from '../shared/index.js';

export interface EnsdfGammaResult {
  gamma_id: number;
  dataset_id: number;
  level_id: number;
  Z: number;
  A: number;
  element: string;
  level_energy_keV: number;
  gamma_energy_keV: number;
  gamma_energy_raw: string;
  gamma_energy_unc_keV: number | null;
  rel_intensity: number | null;
  rel_intensity_unc: number | null;
  total_intensity: number | null;
  total_intensity_unc: number | null;
  multipolarity: string | null;
  mixing_ratio: number | null;
  mixing_ratio_unc: number | null;
  total_conv_coeff: number | null;
  total_conv_coeff_unc: number | null;
  comment_flag: string | null;
  coin_flag: string | null;
  questionable: boolean;
  be2w: number | null;
  be2w_unc: number | null;
  bm1w: number | null;
  bm1w_unc: number | null;
  dataset_type: string;
  dsid: string;
}

function mapGammaRow(r: Record<string, unknown>): EnsdfGammaResult {
  return {
    gamma_id: r.gamma_id as number,
    dataset_id: r.dataset_id as number,
    level_id: r.level_id as number,
    Z: r.Z as number,
    A: r.A as number,
    element: r.element as string,
    level_energy_keV: r.level_energy_keV as number,
    gamma_energy_keV: r.gamma_energy_keV as number,
    gamma_energy_raw: r.gamma_energy_raw as string,
    gamma_energy_unc_keV: r.gamma_energy_unc_keV as number | null,
    rel_intensity: r.rel_intensity as number | null,
    rel_intensity_unc: r.rel_intensity_unc as number | null,
    total_intensity: r.total_intensity as number | null,
    total_intensity_unc: r.total_intensity_unc as number | null,
    multipolarity: r.multipolarity as string | null,
    mixing_ratio: r.mixing_ratio as number | null,
    mixing_ratio_unc: r.mixing_ratio_unc as number | null,
    total_conv_coeff: r.total_conv_coeff as number | null,
    total_conv_coeff_unc: r.total_conv_coeff_unc as number | null,
    comment_flag: r.comment_flag as string | null,
    coin_flag: r.coin_flag as string | null,
    questionable: (r.questionable as number) === 1,
    be2w: r.be2w as number | null,
    be2w_unc: r.be2w_unc as number | null,
    bm1w: r.bm1w as number | null,
    bm1w_unc: r.bm1w_unc as number | null,
    dataset_type: r.dataset_type as string,
    dsid: r.dsid as string,
  };
}

export async function queryGammas(
  dbPath: string,
  params: {
    Z: number;
    A: number;
    level_energy?: number;
    gamma_energy_min?: number;
    gamma_energy_max?: number;
    limit?: number;
  }
): Promise<EnsdfGammaResult[]> {
  const conditions: string[] = [
    `g.Z=${params.Z}`,
    `g.A=${params.A}`,
  ];

  if (params.level_energy !== undefined) {
    conditions.push(`ABS(g.level_energy_keV - ${params.level_energy}) < 0.1`);
  }
  if (params.gamma_energy_min !== undefined) {
    conditions.push(`g.gamma_energy_keV >= ${params.gamma_energy_min}`);
  }
  if (params.gamma_energy_max !== undefined) {
    conditions.push(`g.gamma_energy_keV <= ${params.gamma_energy_max}`);
  }

  const limit = params.limit ?? 100;
  const sql = `SELECT g.*, d.dataset_type, d.dsid FROM ensdf_gammas g JOIN ensdf_datasets d ON g.dataset_id = d.dataset_id WHERE ${conditions.join(' AND ')} ORDER BY g.level_energy_keV, g.gamma_energy_keV LIMIT ${limit}`;

  const rows = await sqlite3JsonQuery(dbPath, sql);
  return rows.map(r => mapGammaRow(r as Record<string, unknown>));
}
