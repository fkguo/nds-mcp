import { invalidParams, sqlite3JsonQuery } from '../shared/index.js';

export interface RadiationQueryParams {
  Z: number;
  A: number;
  state: number;
  type: 'gamma' | 'beta-' | 'beta+' | 'alpha' | 'xray' | 'all';
  energy_min_keV?: number;
  energy_max_keV?: number;
  min_intensity?: number;
}

interface DecayRow {
  id: number;
  Z: number;
  A: number;
  state: number;
  half_life_s: number | null;
  stable: number;
}

interface DecayModeRow {
  mode_label: string;
  q_keV: number | null;
  br: number;
}

interface RadiationRow {
  type_label: string;
  component_kind: 'discrete_line' | 'continuous_summary';
  lcon: number;
  energy_keV: number | null;
  energy_unc_keV: number | null;
  endpoint_keV: number | null;
  intensity: number | null;
  intensity_unc: number | null;
}

function escapeSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function requireDecaySchema(dbPath: string): Promise<void> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM jendl5_meta WHERE key='dec_schema_version' LIMIT 1",
  );
  if (rows.length === 0) {
    throw invalidParams('JENDL-5 decay data not installed. Run: nds-mcp ingest --jendl5-dec', {
      how_to: 'nds-mcp ingest --jendl5-dec',
    });
  }
}

function buildRadiationWhere(params: RadiationQueryParams): string {
  const conditions: string[] = [];
  if (params.type !== 'all') {
    conditions.push(`r.type_label=${escapeSqlString(params.type)}`);
  }

  if (params.min_intensity !== undefined) {
    conditions.push(`COALESCE(r.intensity, 0) >= ${params.min_intensity}`);
  }

  if (params.energy_min_keV !== undefined) {
    conditions.push(
      `(
        (r.component_kind='continuous_summary' AND ((r.energy_keV IS NOT NULL AND r.energy_keV >= ${params.energy_min_keV}) OR (r.endpoint_keV IS NOT NULL AND r.endpoint_keV >= ${params.energy_min_keV})))
        OR
        (r.component_kind!='continuous_summary' AND r.energy_keV IS NOT NULL AND r.energy_keV >= ${params.energy_min_keV})
      )`,
    );
  }

  if (params.energy_max_keV !== undefined) {
    conditions.push(`r.energy_keV IS NOT NULL AND r.energy_keV <= ${params.energy_max_keV}`);
  }

  return conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
}

async function getSourceLabel(dbPath: string): Promise<string> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM jendl5_meta WHERE key='jendl5_dec_version' LIMIT 1",
  );
  if (rows.length === 0) return 'JENDL-5 Decay';
  const version = (rows[0] as { value: string }).value;
  return `JENDL-5 Decay (${version})`;
}

function formatHalfLife(stable: number, halfLifeS: number | null): string | null {
  if (stable === 1) return 'stable';
  if (halfLifeS === null) return null;
  const years = halfLifeS / (365.25 * 24 * 3600);
  if (years >= 1) return `${years.toFixed(4)} y`;
  if (halfLifeS >= 1) return `${halfLifeS.toFixed(3)} s`;
  return `${halfLifeS.toExponential(3)} s`;
}

export async function queryRadiationSpectrum(
  dbPath: string,
  params: RadiationQueryParams,
): Promise<Record<string, unknown> | null> {
  await requireDecaySchema(dbPath);

  const decayRows = await sqlite3JsonQuery(
    dbPath,
    `SELECT id, Z, A, state, half_life_s, stable
     FROM jendl5_decays
     WHERE Z=${params.Z} AND A=${params.A} AND state=${params.state}
     LIMIT 1`,
  );
  if (decayRows.length === 0) return null;

  const decay = decayRows[0] as DecayRow;
  const modes = await sqlite3JsonQuery(
    dbPath,
    `SELECT mode_label, q_keV, br
     FROM jendl5_decay_modes
     WHERE decay_id=${decay.id}
     ORDER BY mode_label`,
  );
  const radiation = await sqlite3JsonQuery(
    dbPath,
    `SELECT type_label, component_kind, lcon, energy_keV, energy_unc_keV, endpoint_keV, intensity, intensity_unc
     FROM jendl5_radiation r
     WHERE decay_id=${decay.id}
     ${buildRadiationWhere(params)}
     ORDER BY
       CASE type_label WHEN 'gamma' THEN 1 WHEN 'xray' THEN 2 WHEN 'beta-' THEN 3 WHEN 'beta+' THEN 4 WHEN 'alpha' THEN 5 ELSE 9 END,
       energy_keV`,
  );

  return {
    Z: decay.Z,
    A: decay.A,
    state: decay.state,
    half_life: formatHalfLife(decay.stable, decay.half_life_s),
    half_life_seconds: decay.half_life_s,
    decay_modes: (modes as DecayModeRow[]).map((row) => ({
      mode: row.mode_label,
      branching_ratio: row.br,
      q_keV: row.q_keV,
    })),
    radiation: (radiation as RadiationRow[]).map((row) => ({
      type: row.type_label,
      component_kind: row.component_kind,
      lcon: row.lcon,
      energy_keV: row.energy_keV,
      energy_unc_keV: row.energy_unc_keV,
      endpoint_keV: row.endpoint_keV,
      intensity: row.intensity,
      intensity_unc: row.intensity_unc,
    })),
    source: await getSourceLabel(dbPath),
  };
}
