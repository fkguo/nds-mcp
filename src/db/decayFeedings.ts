import { sqlite3JsonQuery } from '../shared/index.js';

export interface EnsdfFeedingResult {
  feeding_id: number;
  dataset_id: number;
  parent_Z: number;
  parent_A: number;
  parent_element: string;
  decay_mode: string;
  daughter_level_keV: number | null;
  daughter_level_id: number | null;
  ib_percent: number | null;
  ib_percent_unc: number | null;
  ie_percent: number | null;
  ie_percent_unc: number | null;
  ti_percent: number | null;
  ti_percent_unc: number | null;
  log_ft: number | null;
  log_ft_unc: number | null;
  endpoint_keV: number | null;
  endpoint_unc_keV: number | null;
  forbiddenness: string | null;
  comment_flag: string | null;
  dataset_type: string;
  dsid: string;
  parent_half_life: string | null;
}

function mapFeedingRow(r: Record<string, unknown>): EnsdfFeedingResult {
  return {
    feeding_id: r.feeding_id as number,
    dataset_id: r.dataset_id as number,
    parent_Z: r.parent_Z as number,
    parent_A: r.parent_A as number,
    parent_element: r.parent_element as string,
    decay_mode: r.decay_mode as string,
    daughter_level_keV: r.daughter_level_keV as number | null,
    daughter_level_id: r.daughter_level_id as number | null,
    ib_percent: r.ib_percent as number | null,
    ib_percent_unc: r.ib_percent_unc as number | null,
    ie_percent: r.ie_percent as number | null,
    ie_percent_unc: r.ie_percent_unc as number | null,
    ti_percent: r.ti_percent as number | null,
    ti_percent_unc: r.ti_percent_unc as number | null,
    log_ft: r.log_ft as number | null,
    log_ft_unc: r.log_ft_unc as number | null,
    endpoint_keV: r.endpoint_keV as number | null,
    endpoint_unc_keV: r.endpoint_unc_keV as number | null,
    forbiddenness: r.forbiddenness as string | null,
    comment_flag: r.comment_flag as string | null,
    dataset_type: r.dataset_type as string,
    dsid: r.dsid as string,
    parent_half_life: r.parent_half_life as string | null,
  };
}

export async function queryDecayFeedings(
  dbPath: string,
  params: {
    Z: number;
    A: number;
    decay_mode?: string;
  }
): Promise<EnsdfFeedingResult[]> {
  const conditions: string[] = [
    `f.parent_Z=${params.Z}`,
    `f.parent_A=${params.A}`,
  ];

  if (params.decay_mode) {
    conditions.push(`f.decay_mode='${params.decay_mode}'`);
  }

  const sql = `SELECT f.*, d.dataset_type, d.dsid, d.parent_half_life FROM ensdf_decay_feedings f JOIN ensdf_datasets d ON f.dataset_id = d.dataset_id WHERE ${conditions.join(' AND ')} ORDER BY f.daughter_level_keV`;

  const rows = await sqlite3JsonQuery(dbPath, sql);
  return rows.map(r => mapFeedingRow(r as Record<string, unknown>));
}
