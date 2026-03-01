import { sqlite3JsonQuery } from '../shared/index.js';

export type ChargeRadiusMode = 'best' | 'all' | 'compare';

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
  observable_id: string;
  mode: ChargeRadiusMode;
  recommended_source: string | null;
  recommended_source_version: string | null;
  recommended_r_charge_fm: number | null;
  recommended_r_charge_unc_fm: number | null;
  source_values: RadiusSourceValue[];
  max_source_diff_fm: number | null;
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
    observable_id: 'nuclear_rms_charge_radius',
    mode: 'best',
    recommended_source: null,
    recommended_source_version: null,
    recommended_r_charge_fm: null,
    recommended_r_charge_unc_fm: null,
    source_values: [],
    max_source_diff_fm: null,
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

export interface RadiusSourceValue {
  source_name: string;
  source_version: string;
  as_of: string;
  method: string;
  value_fm: number | null;
  uncertainty_fm: number | null;
  unit: 'fm';
}

interface CodataRadiusRow {
  quantity_key: string;
  value_text: string;
  uncertainty_text: string;
  unit: string;
}

function parseCodataNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('...')) return null;
  if (trimmed.toLowerCase() === '(exact)') return 0;
  const normalized = trimmed.replace(/\s+/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function codataMeterToFm(valueMeters: number | null, unit: string): number | null {
  if (valueMeters === null) return null;
  const normalizedUnit = unit.trim().toLowerCase();
  if (normalizedUnit === 'm') return valueMeters * 1e15;
  if (normalizedUnit === 'fm') return valueMeters;
  return null;
}

async function loadCodataChargeRadiusByIsotope(dbPath: string): Promise<Map<string, RadiusSourceValue>> {
  const keyToIsotope: Record<string, { Z: number; A: number }> = {
    'proton rms charge radius': { Z: 1, A: 1 },
    'deuteron rms charge radius': { Z: 1, A: 2 },
    'alpha particle rms charge radius': { Z: 2, A: 4 },
  };
  const quantityKeys = Object.keys(keyToIsotope).map((k) => `'${k.replaceAll("'", "''")}'`).join(',');

  let codataVersion = 'unknown';
  const versionRows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM codata_meta WHERE key='upstream_version_or_snapshot' LIMIT 1",
  );
  if (versionRows.length > 0) {
    const value = (versionRows[0] as { value?: unknown }).value;
    if (typeof value === 'string' && value.trim().length > 0) codataVersion = value.trim();
  }

  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT quantity_key, value_text, uncertainty_text, unit
     FROM codata_constants
     WHERE quantity_key IN (${quantityKeys})`,
  ) as unknown as CodataRadiusRow[];

  const map = new Map<string, RadiusSourceValue>();
  for (const row of rows) {
    const isotope = keyToIsotope[row.quantity_key];
    if (!isotope) continue;
    const valueFm = codataMeterToFm(parseCodataNumber(row.value_text), row.unit);
    const uncFm = codataMeterToFm(parseCodataNumber(row.uncertainty_text), row.unit);
    map.set(`${isotope.Z}:${isotope.A}`, {
      source_name: 'CODATA fundamental constants',
      source_version: codataVersion,
      as_of: codataVersion === 'unknown' ? 'unknown' : `${codataVersion}-01-01`,
      method: 'CODATA least-squares adjustment',
      value_fm: valueFm,
      uncertainty_fm: uncFm,
      unit: 'fm',
    });
  }
  return map;
}

function sourcePriority(source: RadiusSourceValue): number {
  if (source.source_name.startsWith('CODATA')) return 1;
  if (source.source_name.startsWith('Li et al.')) return 2;
  if (source.source_name.startsWith('IAEA')) return 3;
  return 9;
}

function selectRecommendedSource(sources: RadiusSourceValue[]): RadiusSourceValue | null {
  if (sources.length === 0) return null;
  const sorted = [...sources].sort((a, b) => sourcePriority(a) - sourcePriority(b));
  return sorted[0]!;
}

function computeMaxSourceDiffFm(sources: RadiusSourceValue[]): number | null {
  const values = sources
    .map(source => source.value_fm)
    .filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Number((max - min).toPrecision(8));
}

function buildSourceValues(
  row: ChargeRadiusResult,
  codataValue: RadiusSourceValue | undefined,
  mode: ChargeRadiusMode,
): {
  sources: RadiusSourceValue[];
  recommended: RadiusSourceValue | null;
  maxSourceDiffFm: number | null;
} {
  const all: RadiusSourceValue[] = [];
  if (row.r_charge_fm !== null) {
    all.push({
      source_name: 'IAEA charge radii',
      source_version: 'Angeli-Marinova-2013',
      as_of: '2013-01-01',
      method: 'IAEA evaluated compilation',
      value_fm: row.r_charge_fm,
      uncertainty_fm: row.r_charge_unc_fm,
      unit: 'fm',
    });
  } else if (row.r_charge_preliminary_fm !== null) {
    all.push({
      source_name: 'IAEA charge radii (preliminary)',
      source_version: 'Angeli-Marinova-2013',
      as_of: '2013-01-01',
      method: 'IAEA preliminary compilation',
      value_fm: row.r_charge_preliminary_fm,
      uncertainty_fm: row.r_charge_preliminary_unc_fm,
      unit: 'fm',
    });
  }
  if (row.laser_spectroscopy) {
    all.push({
      source_name: 'Li et al. laser spectroscopy',
      source_version: 'Li2021',
      as_of: '2021-01-01',
      method: 'Laser spectroscopy compilation',
      value_fm: row.laser_spectroscopy.r_charge_fm,
      uncertainty_fm: row.laser_spectroscopy.r_charge_unc_fm,
      unit: 'fm',
    });
  }
  if (codataValue) {
    all.push(codataValue);
  }

  const sorted = all.sort((a, b) => sourcePriority(a) - sourcePriority(b));
  const recommended = selectRecommendedSource(sorted);
  const sources = mode === 'best' && recommended ? [recommended] : sorted;
  const maxSourceDiffFm = mode === 'compare' ? computeMaxSourceDiffFm(sorted) : null;
  return { sources, recommended, maxSourceDiffFm };
}

export async function getChargeRadius(
  dbPath: string,
  Z: number,
  A?: number,
  mode: ChargeRadiusMode = 'best',
): Promise<ChargeRadiusResult[]> {
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
      observable_id: 'nuclear_rms_charge_radius',
      mode: 'best',
      recommended_source: null,
      recommended_source_version: null,
      recommended_r_charge_fm: null,
      recommended_r_charge_unc_fm: null,
      source_values: [],
      max_source_diff_fm: null,
    });
  }

  const shouldLoadCodata = (
    (Z === 1 && (A === undefined || A === 1 || A === 2))
    || (Z === 2 && (A === undefined || A === 4))
  );
  const codataByIsotope = shouldLoadCodata
    ? await loadCodataChargeRadiusByIsotope(dbPath)
    : new Map<string, RadiusSourceValue>();

  // Sort by A
  const rows = [...resultMap.values()].sort((a, b) => a.A - b.A);
  for (const row of rows) {
    row.mode = mode;
    const { sources, recommended, maxSourceDiffFm } = buildSourceValues(
      row,
      codataByIsotope.get(`${row.Z}:${row.A}`),
      mode,
    );
    row.source_values = sources;
    row.recommended_source = recommended?.source_name ?? null;
    row.recommended_source_version = recommended?.source_version ?? null;
    row.recommended_r_charge_fm = recommended?.value_fm ?? null;
    row.recommended_r_charge_unc_fm = recommended?.uncertainty_fm ?? null;
    row.max_source_diff_fm = maxSourceDiffFm;
  }

  return rows;
}
