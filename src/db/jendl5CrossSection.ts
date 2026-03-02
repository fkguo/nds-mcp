import { invalidParams, sqlite3JsonQuery } from '../shared/index.js';
import { interpolateTab1, type XsInterpSegment, type XsPoint } from './jendl5Interpolation.js';

export interface CrossSectionLookup {
  Z: number;
  A: number;
  state: number;
  projectile: 'n' | 'p';
  mt?: number;
  reaction?: string;
}

export interface CrossSectionTableParams extends CrossSectionLookup {
  mode: 'raw' | 'sampled';
  e_min_eV?: number;
  e_max_eV?: number;
  n_points: number;
  limit: number;
  offset: number;
}

export interface CrossSectionInterpolationParams extends CrossSectionLookup {
  energy_eV: number;
  on_out_of_range?: 'error' | 'clamp';
}

interface XsMetaRow {
  id: number;
  Z: number;
  A: number;
  state: number;
  projectile: string;
  mt: number;
  reaction: string;
  e_min_eV: number;
  e_max_eV: number;
  n_points: number;
}

interface AvailableXsRow {
  mt: number;
  reaction: string;
  e_min_eV: number;
  e_max_eV: number;
  n_points: number;
}

interface AvailableTargetRow {
  A: number;
  state: number;
  n_reactions: number;
  e_min_eV: number;
  e_max_eV: number;
}

export interface ListAvailableTargetsParams {
  Z: number;
  projectile: 'n' | 'p';
}

export interface ReactionInfoParams {
  Z: number;
  A: number;
  state: number;
  projectile: 'n' | 'p';
  reaction?: string;
}

function normalizeReactionLabel(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, '');
}

function buildReactionAliasSuggestion(
  params: CrossSectionLookup,
  availableReactions: string[],
  requestedReaction?: string,
): Record<string, unknown> | null {
  if (!requestedReaction) return null;
  const normalized = normalizeReactionLabel(requestedReaction);
  const available = new Set(availableReactions.map((v) => normalizeReactionLabel(v)));

  // Li-6 special-case: ENDF/JENDL uses MT=105 label n,t for n + Li-6 -> alpha + t.
  if (
    params.projectile === 'n'
    && params.Z === 3
    && params.A === 6
    && (normalized === 'n,a' || normalized === 'n,alpha')
    && available.has('n,t')
  ) {
    return {
      suggested_reaction: 'n,t',
      suggestion_reason: 'For Li-6 in ENDF/JENDL, MT=105 is labeled n,t (n + Li-6 -> alpha + t).',
    };
  }

  if ((normalized === 'capture' || normalized === 'n,capture') && available.has('n,gamma')) {
    return {
      suggested_reaction: 'n,gamma',
      suggestion_reason: 'Use n,gamma (MT=102) for neutron capture.',
    };
  }
  if ((normalized === 'n,f' || normalized === 'fission') && available.has('n,fission')) {
    return {
      suggested_reaction: 'n,fission',
      suggestion_reason: 'Use n,fission (MT=18) for neutron-induced fission.',
    };
  }
  return null;
}

async function requireXsSchema(dbPath: string): Promise<void> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM jendl5_meta WHERE key='xs_schema_version' LIMIT 1",
  );
  if (rows.length === 0) {
    throw invalidParams('JENDL-5 cross section data not installed. Run: nds-mcp ingest --jendl5-xs', {
      how_to: 'nds-mcp ingest --jendl5-xs',
    });
  }
}

async function resolveXsMeta(dbPath: string, params: CrossSectionLookup): Promise<XsMetaRow | null> {
  const conditions: string[] = [
    `Z=${params.Z}`,
    `A=${params.A}`,
    `state=${params.state}`,
    `projectile='${params.projectile}'`,
  ];
  if (params.mt !== undefined) conditions.push(`mt=${params.mt}`);
  if (params.reaction !== undefined) conditions.push(`reaction='${params.reaction.replaceAll("'", "''")}'`);
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT * FROM jendl5_xs_meta WHERE ${conditions.join(' AND ')} LIMIT 1`,
  );
  return rows.length === 0 ? null : (rows[0] as XsMetaRow);
}

async function listAvailableReactions(
  dbPath: string,
  params: CrossSectionLookup,
): Promise<AvailableXsRow[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT mt, reaction, e_min_eV, e_max_eV, n_points
     FROM jendl5_xs_meta
     WHERE Z=${params.Z} AND A=${params.A} AND state=${params.state} AND projectile='${params.projectile}'
     ORDER BY mt`,
  );
  return rows as AvailableXsRow[];
}

async function listAvailableTargetsForZ(
  dbPath: string,
  Z: number,
  projectile: 'n' | 'p',
): Promise<AvailableTargetRow[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT A, state, COUNT(*) AS n_reactions, MIN(e_min_eV) AS e_min_eV, MAX(e_max_eV) AS e_max_eV
     FROM jendl5_xs_meta
     WHERE Z=${Z} AND projectile='${projectile}'
     GROUP BY A, state
     ORDER BY A, state`,
  );
  return rows as AvailableTargetRow[];
}

async function requireResolvedMeta(
  dbPath: string,
  params: CrossSectionLookup,
): Promise<XsMetaRow | null> {
  const meta = await resolveXsMeta(dbPath, params);
  if (meta) return meta;

  const available = await listAvailableReactions(dbPath, params);
  if (available.length > 0) {
    const availableReactions = [...new Set(available.map((row) => row.reaction))];
    const aliasSuggestion = buildReactionAliasSuggestion(
      params,
      availableReactions,
      params.reaction,
    );

    throw invalidParams(
      `Requested reaction not found for Z=${params.Z}, A=${params.A}, state=${params.state}, projectile=${params.projectile}`,
      {
        requested_mt: params.mt ?? null,
        requested_reaction: params.reaction ?? null,
        available_mts: [...new Set(available.map((row) => row.mt))],
        available_reactions: availableReactions,
        ...(aliasSuggestion ?? {}),
      },
    );
  }

  const availableTargets = await listAvailableTargetsForZ(dbPath, params.Z, params.projectile);
  if (availableTargets.length > 0) {
    throw invalidParams(
      `No cross section for requested target combination Z=${params.Z}, A=${params.A}, state=${params.state}, projectile=${params.projectile}`,
      {
        requested_Z: params.Z,
        requested_A: params.A,
        requested_state: params.state,
        requested_projectile: params.projectile,
        available_targets: availableTargets,
        how_to_explore: 'Call nds_list_available_targets with the same Z/projectile to discover valid A/state combinations.',
      },
    );
  }

  return null;
}

async function getXsVersion(dbPath: string): Promise<string | null> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    "SELECT value FROM jendl5_meta WHERE key='jendl5_xs_version' LIMIT 1",
  );
  if (rows.length === 0) return null;
  const value = (rows[0] as { value?: unknown }).value;
  return typeof value === 'string' ? value : null;
}

export async function listAvailableTargetsByZ(
  dbPath: string,
  params: ListAvailableTargetsParams,
): Promise<Record<string, unknown>> {
  await requireXsSchema(dbPath);
  const targets = await listAvailableTargetsForZ(dbPath, params.Z, params.projectile);
  return {
    Z: params.Z,
    projectile: params.projectile,
    targets,
    energy_unit: 'eV',
    note: 'targets rows are grouped by A/state; n_reactions is the number of MT channels for that target.',
  };
}

export async function getReactionInfo(
  dbPath: string,
  params: ReactionInfoParams,
): Promise<Record<string, unknown> | null> {
  await requireXsSchema(dbPath);
  const available = await listAvailableReactions(dbPath, params);
  if (available.length === 0) return null;
  const availableReactions = [...new Set(available.map((row) => row.reaction))];
  const aliasSuggestion = buildReactionAliasSuggestion(
    params,
    availableReactions,
    params.reaction,
  );

  return {
    Z: params.Z,
    A: params.A,
    state: params.state,
    projectile: params.projectile,
    reactions: available.map((row) => ({
      mt: row.mt,
      reaction: row.reaction,
      e_min_eV: row.e_min_eV,
      e_max_eV: row.e_max_eV,
      n_points: row.n_points,
    })),
    energy_unit: 'eV',
    ...(aliasSuggestion ?? {}),
  };
}

async function loadPoints(dbPath: string, xsId: number, eMin?: number, eMax?: number): Promise<XsPoint[]> {
  const where: string[] = [`xs_id=${xsId}`];
  if (eMin !== undefined) where.push(`e_eV >= ${eMin}`);
  if (eMax !== undefined) where.push(`e_eV <= ${eMax}`);
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT point_index, e_eV, sigma_b FROM jendl5_xs_points WHERE ${where.join(' AND ')} ORDER BY point_index`,
  );
  return rows as XsPoint[];
}

async function loadInterpSegments(dbPath: string, xsId: number): Promise<XsInterpSegment[]> {
  const rows = await sqlite3JsonQuery(
    dbPath,
    `SELECT nbt, int_law FROM jendl5_xs_interp WHERE xs_id=${xsId} ORDER BY nbt`,
  );
  return rows as XsInterpSegment[];
}

function logGrid(minValue: number, maxValue: number, count: number): number[] {
  if (count <= 1) return [minValue];
  const logMin = Math.log(minValue);
  const logMax = Math.log(maxValue);
  const step = (logMax - logMin) / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Math.exp(logMin + i * step));
  }
  return out;
}

export async function queryCrossSectionTable(
  dbPath: string,
  params: CrossSectionTableParams,
): Promise<Record<string, unknown> | null> {
  await requireXsSchema(dbPath);
  const meta = await requireResolvedMeta(dbPath, params);
  if (!meta) return null;
  const xsVersion = await getXsVersion(dbPath);

  const eMin = params.e_min_eV ?? meta.e_min_eV;
  const eMax = params.e_max_eV ?? meta.e_max_eV;
  if (eMin <= 0 || eMax <= 0) {
    throw invalidParams('Invalid e_min_eV/e_max_eV range');
  }
  if (params.e_min_eV !== undefined && params.e_max_eV !== undefined && params.e_min_eV > params.e_max_eV) {
    throw invalidParams('Invalid e_min_eV/e_max_eV range');
  }
  const effectiveEMin = Math.max(eMin, meta.e_min_eV);
  const effectiveEMax = Math.min(eMax, meta.e_max_eV);
  const rangeClipped = effectiveEMin !== eMin || effectiveEMax !== eMax;
  if (effectiveEMin > effectiveEMax) {
    throw invalidParams(
      `Requested energy window [${eMin}, ${eMax}] eV is outside tabulated range [${meta.e_min_eV}, ${meta.e_max_eV}] eV`,
      {
        requested_e_min_eV: eMin,
        requested_e_max_eV: eMax,
        tabulated_e_min_eV: meta.e_min_eV,
        tabulated_e_max_eV: meta.e_max_eV,
      },
    );
  }

  if (params.mode === 'raw') {
    const rows = await sqlite3JsonQuery(
      dbPath,
      `SELECT point_index, e_eV, sigma_b
       FROM jendl5_xs_points
       WHERE xs_id=${meta.id} AND e_eV >= ${effectiveEMin} AND e_eV <= ${effectiveEMax}
       ORDER BY point_index
       LIMIT ${params.limit} OFFSET ${params.offset}`,
    );
    return {
      ...meta,
      mode: 'raw',
      source: 'JENDL-5 neutron 300K (Doppler-broadened)',
      jendl5_xs_version: xsVersion,
      energy_unit: 'eV',
      cross_section_unit: 'b',
      requested_e_min_eV: eMin,
      requested_e_max_eV: eMax,
      e_min_eV: effectiveEMin,
      e_max_eV: effectiveEMax,
      range_clipped: rangeClipped,
      points: rows,
    };
  }

  const points = await loadPoints(dbPath, meta.id, undefined, undefined);
  const segments = await loadInterpSegments(dbPath, meta.id);
  const energies = logGrid(effectiveEMin, effectiveEMax, params.n_points);
  const sampled = energies.map((energy) => {
    const result = interpolateTab1(points, segments, energy);
    return { e_eV: energy, sigma_b: result.sigma_b, interpolation_method: result.interpolation_method };
  });

  return {
    ...meta,
    mode: 'sampled',
    source: 'JENDL-5 neutron 300K (Doppler-broadened)',
    jendl5_xs_version: xsVersion,
    energy_unit: 'eV',
    cross_section_unit: 'b',
    requested_e_min_eV: eMin,
    requested_e_max_eV: eMax,
    e_min_eV: effectiveEMin,
    e_max_eV: effectiveEMax,
    range_clipped: rangeClipped,
    points: sampled,
  };
}

export async function interpolateCrossSection(
  dbPath: string,
  params: CrossSectionInterpolationParams,
): Promise<Record<string, unknown> | null> {
  await requireXsSchema(dbPath);
  const meta = await requireResolvedMeta(dbPath, params);
  if (!meta) return null;
  const xsVersion = await getXsVersion(dbPath);
  if (params.energy_eV <= 0) {
    throw invalidParams('Invalid energy_eV (must be > 0)', {
      requested_energy_eV: params.energy_eV,
    });
  }
  const requestedEnergy = params.energy_eV;
  const outOfRange = requestedEnergy < meta.e_min_eV || requestedEnergy > meta.e_max_eV;
  let effectiveEnergy = requestedEnergy;
  if (outOfRange) {
    if (params.on_out_of_range === 'clamp') {
      effectiveEnergy = Math.min(Math.max(requestedEnergy, meta.e_min_eV), meta.e_max_eV);
    } else {
      throw invalidParams(
        `Requested energy ${params.energy_eV} eV is outside tabulated range [${meta.e_min_eV}, ${meta.e_max_eV}] eV`,
        {
          requested_energy_eV: params.energy_eV,
          tabulated_e_min_eV: meta.e_min_eV,
          tabulated_e_max_eV: meta.e_max_eV,
        },
      );
    }
  }

  const points = await loadPoints(dbPath, meta.id);
  const segments = await loadInterpSegments(dbPath, meta.id);
  const result = interpolateTab1(points, segments, effectiveEnergy);
  return {
    Z: meta.Z,
    A: meta.A,
    state: meta.state,
    projectile: meta.projectile,
    mt: meta.mt,
    reaction: meta.reaction,
    energy_eV: effectiveEnergy,
    sigma_b: result.sigma_b,
    interpolation_method: result.interpolation_method,
    source: 'JENDL-5 neutron 300K (Doppler-broadened)',
    jendl5_xs_version: xsVersion,
    energy_unit: 'eV',
    cross_section_unit: 'b',
    ...(params.on_out_of_range === 'clamp'
      ? {
        clamped: effectiveEnergy !== requestedEnergy,
        requested_energy_eV: requestedEnergy,
        effective_energy_eV: effectiveEnergy,
        tabulated_e_min_eV: meta.e_min_eV,
        tabulated_e_max_eV: meta.e_max_eV,
      }
      : {}),
  };
}
