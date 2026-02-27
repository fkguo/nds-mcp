import { sqlite3JsonQuery } from '../shared/index.js';

export interface LaserSourceInfo {
  delta_r2_fm2: number;
  delta_r2_unc_fm2: number | null;
  r_charge_fm: number;
  r_charge_unc_fm: number;
  is_reference: boolean;
  ref_A: number;
  in_angeli_2013: boolean;
  citations: string[];
}

export interface ChargeRadiusResult {
  Z: number;
  A: number;
  element: string;
  r_charge_fm: number | null;
  r_charge_unc_fm: number | null;
  r_charge_preliminary_fm: number | null;
  r_charge_preliminary_unc_fm: number | null;
  laser_spectroscopy: LaserSourceInfo | null;
}

function mapChargeRow(r: Record<string, unknown>): ChargeRadiusResult {
  return {
    Z: r.Z as number,
    A: r.A as number,
    element: r.element as string,
    r_charge_fm: r.r_charge_fm as number | null,
    r_charge_unc_fm: r.r_charge_unc_fm as number | null,
    r_charge_preliminary_fm: r.r_charge_preliminary_fm as number | null,
    r_charge_preliminary_unc_fm: r.r_charge_preliminary_unc_fm as number | null,
    laser_spectroscopy: null,
  };
}

interface LaserRow {
  Z: number;
  A: number;
  element: string;
  delta_r2_fm2: number;
  delta_r2_unc_fm2: number | null;
  r_charge_fm: number;
  r_charge_unc_fm: number;
  is_reference: number;
  in_angeli_2013: number;
  ref_A: number;
  citekeys: string | null;
}

function mapLaserInfo(r: LaserRow): LaserSourceInfo {
  return {
    delta_r2_fm2: r.delta_r2_fm2,
    delta_r2_unc_fm2: r.delta_r2_unc_fm2,
    r_charge_fm: r.r_charge_fm,
    r_charge_unc_fm: r.r_charge_unc_fm,
    is_reference: r.is_reference === 1,
    ref_A: r.ref_A,
    in_angeli_2013: r.in_angeli_2013 === 1,
    citations: r.citekeys ? r.citekeys.split(',') : [],
  };
}

export async function getChargeRadius(dbPath: string, Z: number, A?: number): Promise<ChargeRadiusResult[]> {
  // Query 1: charge_radii (IAEA)
  const chargeSql = A !== undefined
    ? `SELECT * FROM charge_radii WHERE Z=${Z} AND A=${A}`
    : `SELECT * FROM charge_radii WHERE Z=${Z} ORDER BY A`;
  const chargeRows = await sqlite3JsonQuery(dbPath, chargeSql);

  // Query 2: laser_radii with citations (Li et al. 2021)
  const laserSql = A !== undefined
    ? `SELECT lr.*, GROUP_CONCAT(lrr.citekey) as citekeys FROM laser_radii lr LEFT JOIN laser_radii_refs lrr ON lr.Z=lrr.Z AND lr.A=lrr.A WHERE lr.Z=${Z} AND lr.A=${A} GROUP BY lr.Z, lr.A`
    : `SELECT lr.*, GROUP_CONCAT(lrr.citekey) as citekeys FROM laser_radii lr LEFT JOIN laser_radii_refs lrr ON lr.Z=lrr.Z AND lr.A=lrr.A WHERE lr.Z=${Z} GROUP BY lr.Z, lr.A ORDER BY lr.A`;

  let laserRows: LaserRow[] = [];
  try {
    laserRows = (await sqlite3JsonQuery(dbPath, laserSql)) as unknown as LaserRow[];
  } catch {
    // laser_radii table may not exist in older DBs — silently ignore
  }

  // Build laser lookup by A
  const laserByA = new Map<number, LaserRow>();
  for (const lr of laserRows) {
    laserByA.set(lr.A, lr);
  }

  // Merge: start with charge_radii results
  const resultMap = new Map<number, ChargeRadiusResult>();

  for (const cr of chargeRows) {
    const row = mapChargeRow(cr as Record<string, unknown>);
    const laser = laserByA.get(row.A);
    if (laser) {
      row.laser_spectroscopy = mapLaserInfo(laser);
      laserByA.delete(row.A);
    }
    resultMap.set(row.A, row);
  }

  // Add isotopes that exist only in laser_radii (not in charge_radii)
  for (const [a, lr] of laserByA) {
    resultMap.set(a, {
      Z: lr.Z,
      A: lr.A,
      element: lr.element,
      r_charge_fm: null,
      r_charge_unc_fm: null,
      r_charge_preliminary_fm: null,
      r_charge_preliminary_unc_fm: null,
      laser_spectroscopy: mapLaserInfo(lr),
    });
  }

  // Sort by A
  return [...resultMap.values()].sort((a, b) => a.A - b.A);
}
