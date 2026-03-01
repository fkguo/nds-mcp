import { z } from 'zod';
import { zodToMcpInputSchema } from './mcpSchema.js';
import { getFileMetadata, getMainDbStatus, requireNdsDbPathFromEnv } from '../db/ndsDb.js';
import { getMass } from '../db/masses.js';
import { getSeparationEnergy, getQValue } from '../db/reactions.js';
import { getDecay, findNuclidesByElement, findNuclideByZA, findNuclidesByA, searchNuclides } from '../db/nubase.js';
import { getChargeRadius } from '../db/chargeRadii.js';
import { queryAllLevels } from '../db/levels.js';
import { queryGammas } from '../db/gammas.js';
import { queryDecayFeedings } from '../db/decayFeedings.js';
import { lookupReference } from '../db/references.js';
import { ensureJendl5Db, getJendl5DbStatus } from '../db/jendl5Db.js';
import { ensureExforDb, getExforDbStatus } from '../db/exforDb.js';
import { queryRadiationSpectrum } from '../db/jendl5RadiationSpec.js';
import { interpolateCrossSection, queryCrossSectionTable } from '../db/jendl5CrossSection.js';
import { getExforEntry, searchExfor } from '../db/exfor.js';
import { getCodataConstant, listCodataConstants } from '../db/codata.js';
import { invalidParams, notFound, sqlite3JsonQuery } from '../shared/index.js';
import {
  NDS_FIND_NUCLIDE,
  NDS_GET_MASS,
  NDS_GET_SEPARATION_ENERGY,
  NDS_GET_Q_VALUE,
  NDS_GET_DECAY,
  NDS_GET_CHARGE_RADIUS,
  NDS_SEARCH,
  NDS_INFO,
  NDS_QUERY_LEVELS,
  NDS_QUERY_GAMMAS,
  NDS_QUERY_DECAY_FEEDINGS,
  NDS_LOOKUP_REFERENCE,
  NDS_GET_RADIATION_SPECTRUM,
  NDS_GET_CROSS_SECTION_TABLE,
  NDS_INTERPOLATE_CROSS_SECTION,
  NDS_SEARCH_EXFOR,
  NDS_GET_EXFOR_ENTRY,
  NDS_GET_CONSTANT,
  NDS_LIST_CONSTANTS,
} from '../constants.js';

export type ToolExposureMode = 'standard' | 'full';
export type ToolExposure = 'standard' | 'full';

export interface ToolHandlerContext {}

export interface ToolSpec<TSchema extends z.ZodType<any, any> = z.ZodType<any, any>> {
  name: string;
  description: string;
  exposure: ToolExposure;
  zodSchema: TSchema;
  handler: (params: z.output<TSchema>, ctx: ToolHandlerContext) => Promise<unknown>;
}

export function isToolExposed(spec: ToolSpec, mode: ToolExposureMode): boolean {
  return mode === 'full' ? true : spec.exposure === 'standard';
}

// ── Element symbol lookup (for resolving element names to Z) ──────────────

const ELEMENT_SYMBOLS: Record<string, number> = {
  n: 0, H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9,
  Ne: 10, Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18, K: 19,
  Ca: 20, Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26, Co: 27, Ni: 28, Cu: 29,
  Zn: 30, Ga: 31, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36, Rb: 37, Sr: 38, Y: 39,
  Zr: 40, Nb: 41, Mo: 42, Tc: 43, Ru: 44, Rh: 45, Pd: 46, Ag: 47, Cd: 48, In: 49,
  Sn: 50, Sb: 51, Te: 52, I: 53, Xe: 54, Cs: 55, Ba: 56, La: 57, Ce: 58, Pr: 59,
  Nd: 60, Pm: 61, Sm: 62, Eu: 63, Gd: 64, Tb: 65, Dy: 66, Ho: 67, Er: 68, Tm: 69,
  Yb: 70, Lu: 71, Hf: 72, Ta: 73, W: 74, Re: 75, Os: 76, Ir: 77, Pt: 78, Au: 79,
  Hg: 80, Tl: 81, Pb: 82, Bi: 83, Po: 84, At: 85, Rn: 86, Fr: 87, Ra: 88, Ac: 89,
  Th: 90, Pa: 91, U: 92, Np: 93, Pu: 94, Am: 95, Cm: 96, Bk: 97, Cf: 98, Es: 99,
  Fm: 100, Md: 101, No: 102, Lr: 103, Rf: 104, Db: 105, Sg: 106, Bh: 107, Hs: 108, Mt: 109,
  Ds: 110, Rg: 111, Cn: 112, Nh: 113, Fl: 114, Mc: 115, Lv: 116, Ts: 117, Og: 118,
};

function resolveElement(element: string): number | undefined {
  // Try exact match first, then case-insensitive
  if (ELEMENT_SYMBOLS[element] !== undefined) return ELEMENT_SYMBOLS[element];
  const titleCase = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();
  return ELEMENT_SYMBOLS[titleCase];
}

// ── Tool Schemas ──────────────────────────────────────────────────────────

const NdsInfoSchema = z.object({});

const NdsFindNuclideSchema = z.object({
  element: z.string().min(1).optional().describe('Element symbol (e.g. "He", "U", "Pb")'),
  Z: z.number().int().min(0).optional().describe('Atomic number'),
  A: z.number().int().min(1).optional().describe('Mass number'),
}).refine(
  v => v.element !== undefined || v.Z !== undefined || v.A !== undefined,
  { message: 'At least one of element, Z, or A must be provided' }
);

const NdsGetMassSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
});

const NdsGetSeparationEnergySchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  type: z.enum(['Sn', 'Sp', 'S2n', 'S2p']).optional().describe('Separation energy type (omit for all)'),
});

const NdsGetQValueSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  type: z.enum(['Qa', 'Q2bm', 'Qep', 'Qbn', 'Q4bm', 'Qda', 'Qpa', 'Qna']).optional().describe('Q-value type (omit for all)'),
});

const NdsGetDecaySchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
});

const NdsGetChargeRadiusSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).optional().describe('Mass number (omit for all isotopes of element)'),
  mode: z.enum(['best', 'all', 'compare']).optional().default('best')
    .describe('Source selection mode: best (recommended), all (all sources), compare (all + spread)'),
});

const NdsSearchSchema = z.object({
  property: z.enum(['half_life', 'mass_excess', 'half_life_seconds', 'mass_excess_keV']).describe('Property to search by. Note: stable nuclides have null half_life_seconds and are excluded from half-life range searches.'),
  min: z.number().finite().optional().describe('Minimum value'),
  max: z.number().finite().optional().describe('Maximum value'),
  Z_min: z.number().int().min(0).optional().describe('Minimum atomic number'),
  Z_max: z.number().int().min(0).optional().describe('Maximum atomic number'),
  limit: z.number().int().min(1).max(200).optional().default(50).describe('Maximum results'),
}).refine(
  v => v.min !== undefined || v.max !== undefined,
  { message: 'At least one of min or max must be provided' }
).refine(
  v => (v.min === undefined || v.max === undefined || v.min <= v.max),
  { message: 'min must be <= max when both are provided' }
).refine(
  v => (v.Z_min === undefined || v.Z_max === undefined || v.Z_min <= v.Z_max),
  { message: 'Z_min must be <= Z_max when both are provided' }
);

const NdsQueryLevelsSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  energy_min: z.number().optional().describe('Minimum level energy (keV)'),
  energy_max: z.number().optional().describe('Maximum level energy (keV)'),
  include_decay_datasets: z.boolean().optional().default(false)
    .describe('Include levels from decay datasets (default: ADOPTED only)'),
  include_tunl: z.boolean().optional()
    .describe('Include TUNL resonance data (default: true for A ≤ 20, false otherwise)'),
  limit: z.number().int().min(1).max(500).optional().default(100),
});

const NdsQueryGammasSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  level_energy: z.number().optional().describe('Filter gammas from specific level (keV)'),
  gamma_energy_min: z.number().optional().describe('Minimum gamma energy (keV)'),
  gamma_energy_max: z.number().optional().describe('Maximum gamma energy (keV)'),
  limit: z.number().int().min(1).max(500).optional().default(100),
});

const NdsQueryDecayFeedingsSchema = z.object({
  Z: z.number().int().min(0).describe('Parent atomic number'),
  A: z.number().int().min(1).describe('Parent mass number'),
  decay_mode: z.enum(['B-', 'EC', 'EC+B+', 'IT']).optional().describe('Filter by decay mode'),
});

const NdsLookupReferenceSchema = z.object({
  keynumber: z.string().optional().describe('NSR keynumber (e.g. "2012WA38")'),
  A: z.number().int().min(1).optional().describe('Mass number (list all references for this A)'),
}).refine(v => v.keynumber !== undefined || v.A !== undefined,
  { message: 'At least one of keynumber or A must be provided' });

const NdsGetRadiationSpectrumSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  state: z.number().int().min(0).optional().default(0).describe('Isomeric state (0=ground, 1=first isomer, ...)'),
  type: z.enum(['gamma', 'beta-', 'beta+', 'alpha', 'xray', 'all']).optional().default('all')
    .describe('Filter by radiation type'),
  energy_min_keV: z.number().optional().describe('Minimum energy filter (keV)'),
  energy_max_keV: z.number().optional().describe('Maximum energy filter (keV)'),
  min_intensity: z.number().min(0).optional()
    .describe('Minimum yield per decay. FC is yield per decay and can exceed 1.0.'),
}).refine(
  p => p.energy_min_keV === undefined || p.energy_max_keV === undefined || p.energy_min_keV <= p.energy_max_keV,
  { message: 'energy_min_keV must be <= energy_max_keV' },
);

const NdsGetCrossSectionTableSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  state: z.number().int().min(0).optional().default(0).describe('Target isomeric state'),
  projectile: z.enum(['n', 'p']).optional().default('n'),
  mt: z.number().int().positive().optional().describe('ENDF-6 MT reaction number'),
  reaction: z.string().optional().describe('Reaction label like "n,gamma"'),
  e_min_eV: z.number().positive().optional(),
  e_max_eV: z.number().positive().optional(),
  mode: z.enum(['sampled', 'raw']).optional().default('sampled')
    .describe('"sampled": ENDF interpolation on log grid; "raw": stored points with pagination'),
  n_points: z.number().int().min(2).max(2000).optional().default(200),
  limit: z.number().int().min(1).max(5000).optional().default(1000),
  offset: z.number().int().min(0).optional().default(0),
}).refine(
  p => p.mt !== undefined || p.reaction !== undefined,
  { message: 'At least one of mt or reaction must be provided' },
).refine(
  p => p.e_min_eV === undefined || p.e_max_eV === undefined || p.e_min_eV <= p.e_max_eV,
  { message: 'e_min_eV must be <= e_max_eV' },
);

const NdsInterpolateCrossSectionSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  state: z.number().int().min(0).optional().default(0),
  projectile: z.enum(['n', 'p']).optional().default('n'),
  mt: z.number().int().positive().optional(),
  reaction: z.string().optional(),
  energy_eV: z.number().positive().describe('Incident energy (eV)'),
}).refine(
  p => p.mt !== undefined || p.reaction !== undefined,
  { message: 'At least one of mt or reaction must be provided' },
);

const NdsSearchExforSchema = z.object({
  Z: z.number().int().min(0).describe('Target atomic number'),
  A: z.number().int().min(1).optional().describe('Target mass number'),
  state: z.number().int().min(0).optional().default(0).describe('Target isomeric state'),
  projectile: z.enum(['n', 'p', 'g', 'd', 'a', 'h']).optional().default('n'),
  reaction: z.string().optional().describe('"n,gamma", "n,total", "p,n", etc.'),
  quantity: z.enum(['SIG', 'MACS', 'DA', 'DE', 'FY']).optional().default('SIG'),
  e_min_eV: z.number().positive().optional(),
  e_max_eV: z.number().positive().optional(),
  kT_min_keV: z.number().positive().optional(),
  kT_max_keV: z.number().positive().optional(),
  limit: z.number().int().min(1).max(200).optional().default(20),
}).refine(
  p => !(p.quantity === 'MACS' && (p.e_min_eV !== undefined || p.e_max_eV !== undefined)),
  { message: 'For MACS quantity, use kT_min_keV/kT_max_keV, not e_min_eV/e_max_eV' },
).refine(
  p => p.quantity === 'MACS' || (p.kT_min_keV === undefined && p.kT_max_keV === undefined),
  { message: 'kT_min_keV/kT_max_keV are only valid when quantity=MACS' },
).refine(
  p => p.e_min_eV === undefined || p.e_max_eV === undefined || p.e_min_eV <= p.e_max_eV,
  { message: 'e_min_eV must be <= e_max_eV' },
).refine(
  p => p.kT_min_keV === undefined || p.kT_max_keV === undefined || p.kT_min_keV <= p.kT_max_keV,
  { message: 'kT_min_keV must be <= kT_max_keV' },
);

const NdsGetExforEntrySchema = z.object({
  entry_id: z.string().min(1).describe('EXFOR entry number'),
});

const NdsGetConstantSchema = z.object({
  name: z.string().min(1).describe('CODATA constant name (e.g. "Planck constant", "speed of light in vacuum")'),
  case_sensitive: z.boolean().optional().default(false).describe('Whether to require exact case-sensitive name matching'),
});

const NdsListConstantsSchema = z.object({
  query: z.string().optional().describe('Keyword filter on constant names'),
  exact_only: z.boolean().optional().default(false).describe('When true, return only constants with exact CODATA uncertainty'),
  limit: z.number().int().min(1).max(200).optional().default(50).describe('Maximum results'),
  offset: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
});

async function loadKeyValueMeta(dbPath: string, tableName: string): Promise<Record<string, string> | null> {
  try {
    const rows = await sqlite3JsonQuery(dbPath, `SELECT key, value FROM ${tableName}`);
    const meta: Record<string, string> = {};
    for (const row of rows) {
      const r = row as { key?: unknown; value?: unknown };
      if (typeof r.key === 'string' && typeof r.value === 'string') {
        meta[r.key] = r.value;
      }
    }
    return meta;
  } catch {
    return null;
  }
}

// ── Tool Specs ────────────────────────────────────────────────────────────

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: NDS_INFO,
    description: 'Return NDS database metadata: data versions, nuclide counts, DB file hash.',
    exposure: 'standard',
    zodSchema: NdsInfoSchema,
    handler: async () => {
      const mainDb = getMainDbStatus();
      const jendl5Db = getJendl5DbStatus();
      const exforDb = getExforDbStatus();

      if (mainDb.status !== 'ok' || !mainDb.path) {
        return {
          main_db: mainDb,
          jendl5_db: jendl5Db,
          exfor_db: exforDb,
        };
      }

      const meta = await sqlite3JsonQuery(mainDb.path, 'SELECT key, value FROM nds_meta');
      const metaMap: Record<string, string> = {};
      for (const row of meta) {
        const r = row as { key: string; value: string };
        metaMap[r.key] = r.value;
      }
      const fileMeta = await getFileMetadata(mainDb.path);
      return {
        ...metaMap,
        db_path: mainDb.path,
        ...fileMeta,
        main_db: mainDb,
        jendl5_db: jendl5Db,
        jendl5_meta: jendl5Db.status === 'ok' && jendl5Db.path
          ? await loadKeyValueMeta(jendl5Db.path, 'jendl5_meta')
          : null,
        exfor_db: exforDb,
        exfor_meta: exforDb.status === 'ok' && exforDb.path
          ? await loadKeyValueMeta(exforDb.path, 'exfor_meta')
          : null,
        codata_meta: await loadKeyValueMeta(mainDb.path, 'codata_meta'),
      };
    },
  },
  {
    name: NDS_FIND_NUCLIDE,
    description: 'Find nuclides by element symbol, Z (atomic number), and/or A (mass number). Returns basic properties from NUBASE2020.',
    exposure: 'standard',
    zodSchema: NdsFindNuclideSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const { element, Z, A } = params;

      // Resolve element to Z if provided
      let resolvedZ: number | undefined;
      if (element !== undefined) {
        resolvedZ = resolveElement(element);
        if (resolvedZ === undefined) {
          throw invalidParams(`Unknown element symbol: ${element}`);
        }
        // Check for conflicting Z
        if (Z !== undefined && Z !== resolvedZ) {
          throw invalidParams(`Conflicting parameters: element ${element} is Z=${resolvedZ}, but Z=${Z} was provided.`);
        }
      }

      const effectiveZ = resolvedZ ?? Z;

      if (effectiveZ !== undefined && A !== undefined) {
        return findNuclideByZA(dbPath, effectiveZ, A);
      }

      if (effectiveZ !== undefined) {
        // Find element symbol from DB for querying by canonical name
        const rows = await sqlite3JsonQuery(
          dbPath,
          `SELECT DISTINCT element FROM nubase WHERE Z=${effectiveZ} LIMIT 1`
        );
        if (rows.length === 0) throw notFound(`No nuclides found for Z=${effectiveZ}`);
        const el = (rows[0] as { element: string }).element;
        return findNuclidesByElement(dbPath, el);
      }

      if (A !== undefined) {
        return findNuclidesByA(dbPath, A);
      }

      return [];
    },
  },
  {
    name: NDS_GET_MASS,
    description: 'Get atomic mass data for a nuclide (Z, A) from AME2020: mass excess, binding energy/A, beta-decay energy, atomic mass.',
    exposure: 'standard',
    zodSchema: NdsGetMassSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const result = await getMass(dbPath, params.Z, params.A);
      if (!result) throw notFound(`No mass data for Z=${params.Z}, A=${params.A}`);
      return result;
    },
  },
  {
    name: NDS_GET_SEPARATION_ENERGY,
    description: 'Get nucleon separation energies from AME2020: Sn, Sp, S2n, S2p.',
    exposure: 'standard',
    zodSchema: NdsGetSeparationEnergySchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const result = await getSeparationEnergy(dbPath, params.Z, params.A, params.type);
      if (!result) throw notFound(`No separation energy data for Z=${params.Z}, A=${params.A}`);
      return result;
    },
  },
  {
    name: NDS_GET_Q_VALUE,
    description: 'Get Q-values from AME2020: Qα, Q(2β⁻), Q(εp), Q(β⁻n), Q(4β⁻), Q(d,α), Q(p,α), Q(n,α).',
    exposure: 'standard',
    zodSchema: NdsGetQValueSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const result = await getQValue(dbPath, params.Z, params.A, params.type);
      if (!result) throw notFound(`No Q-value data for Z=${params.Z}, A=${params.A}`);
      return result;
    },
  },
  {
    name: NDS_GET_DECAY,
    description: 'Get decay information from NUBASE2020: half-life, spin/parity, decay modes with branching ratios, isomers.',
    exposure: 'standard',
    zodSchema: NdsGetDecaySchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const results = await getDecay(dbPath, params.Z, params.A);
      if (results.length === 0) throw notFound(`No decay data for Z=${params.Z}, A=${params.A}`);
      return results;
    },
  },
  {
    name: NDS_GET_CHARGE_RADIUS,
    description: 'Get nuclear charge radius (rms) with source-aware comparison across IAEA, laser spectroscopy, and CODATA (when available). mode=best|all|compare controls recommendation vs full source list.',
    exposure: 'standard',
    zodSchema: NdsGetChargeRadiusSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const results = await getChargeRadius(dbPath, params.Z, params.A, params.mode);
      if (results.length === 0) {
        const msg = params.A !== undefined
          ? `No charge radius data for Z=${params.Z}, A=${params.A}`
          : `No charge radius data for Z=${params.Z}`;
        throw notFound(msg);
      }
      return results;
    },
  },
  {
    name: NDS_SEARCH,
    description: 'Search nuclides by property range (half_life_seconds, mass_excess_keV). Returns ground-state nuclides matching criteria.',
    exposure: 'standard',
    zodSchema: NdsSearchSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      return searchNuclides(dbPath, params.property, params.min, params.max, params.Z_min, params.Z_max, params.limit);
    },
  },
  {
    name: NDS_QUERY_LEVELS,
    description: 'Query nuclear energy levels from ENSDF and TUNL. Returns level energies, spin-parity, half-lives. For A ≤ 20, automatically includes TUNL resonance data (widths, isospin, decay modes, table_label for TUNL publication provenance). Each result has a "source" field ("ENSDF" or "TUNL").',
    exposure: 'standard',
    zodSchema: NdsQueryLevelsSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const results = await queryAllLevels(dbPath, params);
      if (results.length === 0) throw notFound(`No levels for Z=${params.Z}, A=${params.A}`);
      return results;
    },
  },
  {
    name: NDS_QUERY_GAMMAS,
    description: 'Query gamma-ray transitions from ENSDF. Returns energies, intensities, multipolarities, conversion coefficients for a nuclide.',
    exposure: 'standard',
    zodSchema: NdsQueryGammasSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const results = await queryGammas(dbPath, params);
      if (results.length === 0) throw notFound(`No ENSDF gammas for Z=${params.Z}, A=${params.A}`);
      return results;
    },
  },
  {
    name: NDS_QUERY_DECAY_FEEDINGS,
    description: 'Query beta/EC decay feeding patterns from ENSDF. Returns branching ratios, log(ft) values, endpoint energies for parent nuclide decays.',
    exposure: 'standard',
    zodSchema: NdsQueryDecayFeedingsSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const results = await queryDecayFeedings(dbPath, params);
      if (results.length === 0) throw notFound(`No ENSDF decay feedings for Z=${params.Z}, A=${params.A}`);
      return results;
    },
  },
  {
    name: NDS_LOOKUP_REFERENCE,
    description: 'Look up ENSDF/NSR bibliographic references by keynumber or mass number.',
    exposure: 'standard',
    zodSchema: NdsLookupReferenceSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const results = await lookupReference(dbPath, params);
      if (results.length === 0) {
        const msg = params.keynumber ? `No reference for keynumber ${params.keynumber}` : `No references for A=${params.A}`;
        throw notFound(msg);
      }
      return results;
    },
  },
  {
    name: NDS_GET_RADIATION_SPECTRUM,
    description: 'Get decay radiation spectra from JENDL-5 Decay (gamma/beta/alpha/X-ray discrete lines and continuous-spectrum summaries).',
    exposure: 'standard',
    zodSchema: NdsGetRadiationSpectrumSchema,
    handler: async (params) => {
      const dbPath = await ensureJendl5Db();
      const result = await queryRadiationSpectrum(dbPath, params);
      if (!result) {
        throw notFound(`No JENDL-5 decay spectrum for Z=${params.Z}, A=${params.A}, state=${params.state}`);
      }
      return result;
    },
  },
  {
    name: NDS_GET_CROSS_SECTION_TABLE,
    description: 'Get JENDL-5 pointwise cross-section tables. mode=raw returns tabulated points; mode=sampled interpolates onto a log grid with ENDF-6 NBT/INT rules.',
    exposure: 'standard',
    zodSchema: NdsGetCrossSectionTableSchema,
    handler: async (params) => {
      const dbPath = await ensureJendl5Db();
      const result = await queryCrossSectionTable(dbPath, params);
      if (!result) {
        throw notFound(`No JENDL-5 cross section for Z=${params.Z}, A=${params.A}, state=${params.state}`);
      }
      return result;
    },
  },
  {
    name: NDS_INTERPOLATE_CROSS_SECTION,
    description: 'Interpolate JENDL-5 cross section at a specific energy using ENDF-6 NBT/INT segmented interpolation rules.',
    exposure: 'standard',
    zodSchema: NdsInterpolateCrossSectionSchema,
    handler: async (params) => {
      const dbPath = await ensureJendl5Db();
      const result = await interpolateCrossSection(dbPath, params);
      if (!result) {
        throw notFound(`No JENDL-5 cross section for Z=${params.Z}, A=${params.A}, state=${params.state}`);
      }
      return result;
    },
  },
  {
    name: NDS_SEARCH_EXFOR,
    description: 'Search EXFOR experimental reaction data points by target/projectile/reaction/quantity (including MACS).',
    exposure: 'standard',
    zodSchema: NdsSearchExforSchema,
    handler: async (params) => {
      const dbPath = await ensureExforDb();
      const results = await searchExfor(dbPath, params);
      if (results.length === 0) {
        throw notFound(`No EXFOR entries for Z=${params.Z}${params.A !== undefined ? `, A=${params.A}` : ''}`);
      }
      return results;
    },
  },
  {
    name: NDS_GET_EXFOR_ENTRY,
    description: 'Get one EXFOR entry (all subentries + points) by entry number.',
    exposure: 'standard',
    zodSchema: NdsGetExforEntrySchema,
    handler: async (params) => {
      const dbPath = await ensureExforDb();
      const result = await getExforEntry(dbPath, params);
      if (!result) throw notFound(`No EXFOR entry for entry_id=${params.entry_id}`);
      return result;
    },
  },
  {
    name: NDS_GET_CONSTANT,
    description: 'Get one CODATA fundamental constant by name (case-insensitive by default).',
    exposure: 'standard',
    zodSchema: NdsGetConstantSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      const result = await getCodataConstant(dbPath, params);
      if (!result) throw notFound(`No CODATA constant matching name=${params.name}`);
      return result;
    },
  },
  {
    name: NDS_LIST_CONSTANTS,
    description: 'List CODATA fundamental constants with optional keyword filtering and pagination.',
    exposure: 'standard',
    zodSchema: NdsListConstantsSchema,
    handler: async (params) => {
      const dbPath = requireNdsDbPathFromEnv();
      return listCodataConstants(dbPath, params);
    },
  },
];

// ── Exports ───────────────────────────────────────────────────────────────

export function getToolSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find(s => s.name === name);
}

export function getToolSpecs(mode: ToolExposureMode = 'standard'): ToolSpec[] {
  return mode === 'full' ? TOOL_SPECS : TOOL_SPECS.filter(s => s.exposure === 'standard');
}

export function getTools(mode: ToolExposureMode = 'standard'): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return getToolSpecs(mode).map(s => ({
    name: s.name,
    description: s.description,
    inputSchema: zodToMcpInputSchema(s.zodSchema),
  }));
}
