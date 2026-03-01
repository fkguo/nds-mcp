import { invalidParams, sqlite3JsonQuery, sqlStringLiteral } from '../shared/index.js';

export interface DdepDecayQueryParams {
  Z: number;
  A: number;
  state: number;
  radiation_type: 'gamma' | 'xray' | 'beta-' | 'beta+' | 'alpha' | 'all';
  min_intensity?: number;
  limit: number;
}

interface DdepNuclideRow {
  id: number;
  Z: number;
  A: number;
  state: number;
  nuclide: string;
  half_life_value: number | null;
  half_life_uncertainty: number | null;
  half_life_unit: string | null;
  half_life_seconds: number | null;
  decay_mode: string | null;
  source_label: string | null;
  evaluation_date: string | null;
  doi: string | null;
}

interface DdepRadiationRow {
  radiation_type: string;
  energy_keV: number | null;
  energy_unc_keV: number | null;
  intensity: number | null;
  intensity_unc: number | null;
  is_primary: number;
  source_label: string | null;
}

async function requireDdepSchema(dbPath: string): Promise<void> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM ddep_meta WHERE key='ddep_schema_version' LIMIT 1",
  );
  if (rows.length === 0) {
    throw invalidParams('DDEP schema is not initialized. Run: nds-mcp ingest --ddep', {
      how_to: 'nds-mcp ingest --ddep',
    });
  }
}

async function getDdepSource(dbPath: string): Promise<string> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM ddep_meta WHERE key='ddep_release' LIMIT 1",
  );
  if (rows.length === 0) return 'DDEP';
  const release = (rows[0] as { value: string }).value;
  return `DDEP (${release})`;
}

export async function queryDdepDecay(
  dbPath: string,
  params: DdepDecayQueryParams,
): Promise<Record<string, unknown> | null> {
  await requireDdepSchema(dbPath);

  const nuclides = await sqlite3JsonQuery(
    dbPath,
    `SELECT id, Z, A, state, nuclide, half_life_value, half_life_uncertainty, half_life_unit, half_life_seconds,
            decay_mode, source_label, evaluation_date, doi
     FROM ddep_nuclides
     WHERE Z=${params.Z} AND A=${params.A} AND state=${params.state}
     ORDER BY evaluation_date DESC, id ASC`,
  );
  if (nuclides.length === 0) return null;

  const source = await getDdepSource(dbPath);
  const nuclideRows = nuclides as DdepNuclideRow[];
  const nuclideIds = nuclideRows.map((row) => row.id);
  const where: string[] = [`r.nuclide_id IN (${nuclideIds.join(',')})`];
  if (params.radiation_type !== 'all') {
    where.push(`r.radiation_type=${sqlStringLiteral(params.radiation_type)}`);
  }
  if (params.min_intensity !== undefined) {
    where.push(`COALESCE(r.intensity, 0) >= ${params.min_intensity}`);
  }

  const radiation = await sqlite3JsonQuery(
    dbPath,
    `SELECT r.radiation_type, r.energy_keV, r.energy_unc_keV, r.intensity, r.intensity_unc, r.is_primary, n.source_label
     FROM ddep_radiation r
     JOIN ddep_nuclides n ON n.id = r.nuclide_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.is_primary DESC, r.intensity DESC, r.energy_keV ASC
     LIMIT ${params.limit}`,
  );

  const halfLifeValues = nuclideRows.map((row) => ({
    source: row.source_label ?? source,
    source_tag: 'DDEP',
    value: row.half_life_value,
    uncertainty: row.half_life_uncertainty,
    unit: row.half_life_unit,
    seconds: row.half_life_seconds,
    decay_mode: row.decay_mode,
    evaluation_date: row.evaluation_date,
    doi: row.doi,
  }));

  return {
    Z: nuclideRows[0]!.Z,
    A: nuclideRows[0]!.A,
    state: nuclideRows[0]!.state,
    nuclide: nuclideRows[0]!.nuclide,
    source,
    half_life_values: halfLifeValues,
    recommended_half_life: halfLifeValues[0] ?? null,
    radiation: (radiation as DdepRadiationRow[]).map((row) => ({
      source: row.source_label ?? source,
      source_tag: 'DDEP',
      type: row.radiation_type,
      energy_keV: row.energy_keV,
      energy_unc_keV: row.energy_unc_keV,
      intensity: row.intensity,
      intensity_unc: row.intensity_unc,
      is_primary: row.is_primary === 1,
    })),
  };
}
