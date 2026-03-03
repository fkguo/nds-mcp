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
import { ensureDdepDb } from '../db/ddepDb.js';
import { getFendlDbStatus } from '../db/fendlDb.js';
import { getIrdffDbStatus } from '../db/irdffDb.js';
import { queryRadiationSpectrum } from '../db/jendl5RadiationSpec.js';
import {
  assertSafeIdentifier,
  getTableColumns,
  getTableForeignKeys,
  getTableIndexes,
  isBlobColumn,
  listTables,
  resolveDbPathForLibrary,
} from '../db/universalQuery.js';
import {
  getReactionInfo,
  interpolateCrossSection,
  listAvailableTargetsByZ,
  queryCrossSectionTable,
} from '../db/jendl5CrossSection.js';
import { getExforEntry, searchExfor } from '../db/exfor.js';
import { queryDdepDecay } from '../db/ddep.js';
import { getCodataConstant, listCodataConstants } from '../db/codata.js';
import { invalidParams, notFound, sqlite3JsonQuery, sqlStringLiteral } from '../shared/index.js';
import { checkNpmUpdate, runNpmSelfUpdate } from '../selfUpdate.js';
import {
  NDS_FIND_NUCLIDE,
  NDS_GET_MASS,
  NDS_GET_SEPARATION_ENERGY,
  NDS_GET_Q_VALUE,
  NDS_GET_DECAY,
  NDS_GET_CHARGE_RADIUS,
  NDS_SEARCH,
  NDS_INFO,
  NDS_CATALOG,
  NDS_SCHEMA,
  NDS_QUERY,
  NDS_LIST_RAW_ARCHIVES,
  NDS_CHECK_UPDATE,
  NDS_SELF_UPDATE,
  NDS_QUERY_LEVELS,
  NDS_QUERY_GAMMAS,
  NDS_QUERY_DECAY_FEEDINGS,
  NDS_LOOKUP_REFERENCE,
  NDS_GET_RADIATION_SPECTRUM,
  NDS_LIST_AVAILABLE_TARGETS,
  NDS_GET_REACTION_INFO,
  NDS_GET_CROSS_SECTION_TABLE,
  NDS_INTERPOLATE_CROSS_SECTION,
  NDS_SEARCH_EXFOR,
  NDS_GET_EXFOR_ENTRY,
  NDS_GET_CONSTANT,
  NDS_LIST_CONSTANTS,
  NDS_GET_DDEP_DECAY,
} from '../constants.js';

export type ToolExposureMode = 'standard' | 'full';
export type ToolExposure = 'standard' | 'full';

export interface ToolHandlerContext {
  mode: ToolExposureMode;
}

export interface ToolSpec<TSchema extends z.ZodType<any, any> = z.ZodType<any, any>> {
  name: string;
  description: string;
  exposure: ToolExposure;
  zodSchema: TSchema;
  handler: (params: z.output<TSchema>, ctx: ToolHandlerContext) => Promise<unknown>;
}

export function isToolExposed(spec: ToolSpec, mode: ToolExposureMode): boolean {
  // DDEP is currently sample-only and not meant for general users. Keep it completely
  // hidden unless explicitly enabled (maintainer/internal use only).
  if (spec.name === NDS_GET_DDEP_DECAY) {
    return mode === 'full' && process.env.NDS_ENABLE_DDEP === '1';
  }
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
const NdsCheckUpdateSchema = z.object({});
const NdsSelfUpdateSchema = z.object({
  confirm: z.boolean().default(false).describe('Must be true to execute npm self-update.'),
  target: z.string().optional().default('latest').describe('npm dist-tag or version, e.g. "latest" or "0.3.1".'),
});

const NdsCatalogSchema = z.object({});

const UniversalQueryLibrarySchema = z.enum(['nds', 'jendl5', 'exfor', 'fendl32c', 'irdff2']);

const NdsSchemaSchema = z.object({
  library: UniversalQueryLibrarySchema.describe('Database to inspect: nds|jendl5|exfor|fendl32c|irdff2'),
  include_indexes: z.boolean().optional().default(false).describe('Include index metadata (name/columns).'),
});

const RawArchiveLibrarySchema = z.enum(['fendl32c', 'irdff2']);
const RawArchiveProjectileSchema = z.enum(['n', 'p', 'd', 't', 'h', 'a', 'g', 'photo', 'unknown']);

const NdsListRawArchivesSchema = z.object({
  library: RawArchiveLibrarySchema.describe('Raw archive library to browse: fendl32c|irdff2'),
  projectile: RawArchiveProjectileSchema.optional().describe('Projectile selector (fendl32c only; ignored if absent).'),
  q: z.string().min(1).optional().describe('Substring match on rel_path (case-sensitive).'),
  limit: z.number().int().min(1).describe('Required. Hard-capped server-side (default cap: 5000).'),
  offset: z.number().int().min(0).optional().default(0),
});

const NdsQueryWhereSchema = z.object({
  eq: z.record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .optional()
    .describe('Equality filters. null means IS NULL.'),
  range: z.array(z.object({
    col: z.string().min(1),
    gte: z.union([z.string(), z.number()]).optional(),
    lte: z.union([z.string(), z.number()]).optional(),
  }))
    .optional()
    .describe('Range filters (gte/lte).'),
  in: z.array(z.object({
    col: z.string().min(1),
    values: z.array(z.union([z.string(), z.number()])).min(1),
  }))
    .optional()
    .describe('IN-list filters.'),
  like: z.array(z.object({
    col: z.string().min(1),
    pattern: z.string().min(1),
  }))
    .optional()
    .describe('LIKE filters (use % and _ wildcards).'),
}).optional();

const NdsQuerySchema = z.object({
  library: UniversalQueryLibrarySchema.describe('Database to query: nds|jendl5|exfor|fendl32c|irdff2'),
  table: z.string().min(1).describe('Table or view name (must exist; [A-Za-z0-9_]+ only).'),
  select: z.array(z.string().min(1))
    .optional()
    .describe('Column allowlist. If omitted, selects all non-BLOB columns.'),
  where: NdsQueryWhereSchema,
  order_by: z.array(z.object({
    col: z.string().min(1),
    dir: z.enum(['asc', 'desc']).optional().default('asc'),
  }))
    .optional()
    .describe('Sort order.'),
  limit: z.number().int().min(1).describe('Required. Hard-capped server-side (default cap: 5000).'),
  offset: z.number().int().min(0).optional().default(0),
});

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

const NdsListAvailableTargetsSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  projectile: z.enum(['n', 'p']).optional().default('n'),
});

const NdsGetReactionInfoSchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  state: z.number().int().min(0).optional().default(0).describe('Target isomeric state'),
  projectile: z.enum(['n', 'p']).optional().default('n'),
  reaction: z.string().optional().describe('Optional reaction string to check for common naming aliases (no automatic rewrite)'),
});

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
  on_out_of_range: z.enum(['error', 'clamp']).optional().default('error')
    .describe('How to handle energy outside tabulated range: error (default) or clamp to nearest boundary'),
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
});

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

const NdsGetDdepDecaySchema = z.object({
  Z: z.number().int().min(0).describe('Atomic number'),
  A: z.number().int().min(1).describe('Mass number'),
  state: z.number().int().min(0).optional().default(0).describe('Isomeric state (0=ground, 1=first isomer, ...)'),
  radiation_type: z.enum(['gamma', 'xray', 'beta-', 'beta+', 'alpha', 'all']).optional().default('all')
    .describe('Filter by radiation type'),
  min_intensity: z.number().min(0).optional().describe('Minimum emission intensity per decay'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Maximum radiation lines to return'),
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
      const fendlDb = getFendlDbStatus();
      const irdffDb = getIrdffDbStatus();
      const jendl5Db = getJendl5DbStatus();
      const exforDb = getExforDbStatus();

      if (mainDb.status !== 'ok' || !mainDb.path) {
        return {
          main_db: mainDb,
          fendl_db: fendlDb,
          irdff_db: irdffDb,
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
        fendl_db: fendlDb,
        fendl_meta: fendlDb.status === 'ok' && fendlDb.path
          ? await loadKeyValueMeta(fendlDb.path, 'fendl_meta')
          : null,
        irdff_db: irdffDb,
        irdff_meta: irdffDb.status === 'ok' && irdffDb.path
          ? await loadKeyValueMeta(irdffDb.path, 'irdff_meta')
          : null,
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
    name: NDS_CATALOG,
    description: 'Catalog installed libraries and query entrypoints (what exists, where to query, and which tools to use).',
    exposure: 'standard',
    zodSchema: NdsCatalogSchema,
    handler: async (_params, ctx) => {
      const mainDb = getMainDbStatus();
      const fendlDb = getFendlDbStatus();
      const irdffDb = getIrdffDbStatus();
      const jendl5Db = getJendl5DbStatus();
      const exforDb = getExforDbStatus();

      const libraries: Record<string, unknown> = {
        nds: {
          ...mainDb,
          meta: mainDb.status === 'ok' && mainDb.path ? await loadKeyValueMeta(mainDb.path, 'nds_meta') : null,
          codata_meta: mainDb.status === 'ok' && mainDb.path ? await loadKeyValueMeta(mainDb.path, 'codata_meta') : null,
        },
        jendl5: {
          ...jendl5Db,
          meta: jendl5Db.status === 'ok' && jendl5Db.path ? await loadKeyValueMeta(jendl5Db.path, 'jendl5_meta') : null,
        },
        exfor: {
          ...exforDb,
          meta: exforDb.status === 'ok' && exforDb.path ? await loadKeyValueMeta(exforDb.path, 'exfor_meta') : null,
        },
        fendl32c: {
          ...fendlDb,
          meta: fendlDb.status === 'ok' && fendlDb.path ? await loadKeyValueMeta(fendlDb.path, 'fendl_meta') : null,
        },
        irdff2: {
          ...irdffDb,
          meta: irdffDb.status === 'ok' && irdffDb.path ? await loadKeyValueMeta(irdffDb.path, 'irdff_meta') : null,
        },
      };

      const quantitiesBase = [
        {
          quantity_id: 'atomic_mass',
          category: 'masses',
          entity_kind: 'nuclide',
          description: 'Atomic masses, mass excess, binding energy per nucleon (AME2020).',
          source_libraries: ['nds'],
          primary_tables: ['ame_masses'],
          recommended_tools: ['nds_get_mass'],
          example_calls: [
            { tool: 'nds_get_mass', args: { Z: 82, A: 208 } },
            { tool: 'nds_query', args: { library: 'nds', table: 'ame_masses', where: { eq: { Z: 82, A: 208 } }, limit: 5 } },
          ],
        },
        {
          quantity_id: 'separation_energies',
          category: 'masses',
          entity_kind: 'nuclide',
          description: 'Nucleon separation energies Sn/Sp/S2n/S2p (AME2020).',
          source_libraries: ['nds'],
          primary_tables: ['ame_reactions'],
          recommended_tools: ['nds_get_separation_energy'],
          example_calls: [
            { tool: 'nds_get_separation_energy', args: { Z: 82, A: 208, type: 'S2n' } },
          ],
        },
        {
          quantity_id: 'reaction_q_values',
          category: 'masses',
          entity_kind: 'nuclide',
          description: 'Reaction Q-values (AME2020), e.g. Qa, Q2bm, Qep, Qbn.',
          source_libraries: ['nds'],
          primary_tables: ['ame_reactions'],
          recommended_tools: ['nds_get_q_value'],
          example_calls: [
            { tool: 'nds_get_q_value', args: { Z: 82, A: 208, type: 'Qa' } },
          ],
        },
        {
          quantity_id: 'nuclide_decay_properties',
          category: 'decay',
          entity_kind: 'nuclide',
          description: 'Half-life, spin/parity, decay modes, isomers (NUBASE2020).',
          source_libraries: ['nds'],
          primary_tables: ['nubase'],
          recommended_tools: ['nds_get_decay', 'nds_find_nuclide', 'nds_search'],
          example_calls: [
            { tool: 'nds_get_decay', args: { Z: 82, A: 208 } },
          ],
        },
        {
          quantity_id: 'charge_radii',
          category: 'structure',
          entity_kind: 'nuclide',
          description: 'RMS nuclear charge radii (IAEA + Li et al. laser spectroscopy), source-aware comparison.',
          source_libraries: ['nds'],
          primary_tables: ['charge_radii', 'laser_radii', 'laser_radii_refs'],
          recommended_tools: ['nds_get_charge_radius'],
          example_calls: [
            { tool: 'nds_get_charge_radius', args: { Z: 82, A: 208, mode: 'compare' } },
          ],
        },
        {
          quantity_id: 'levels',
          category: 'structure',
          entity_kind: 'nuclide',
          description: 'Nuclear energy levels (ENSDF), with optional merge of TUNL light-nuclei tables (A ≤ 20).',
          source_libraries: ['nds'],
          primary_tables: ['ensdf_levels', 'tunl_levels'],
          recommended_tools: ['nds_query_levels'],
          example_calls: [
            { tool: 'nds_query_levels', args: { Z: 6, A: 12, limit: 50 } },
          ],
        },
        {
          quantity_id: 'gamma_transitions',
          category: 'structure',
          entity_kind: 'transition',
          description: 'Gamma-ray transition data (ENSDF).',
          source_libraries: ['nds'],
          primary_tables: ['ensdf_gammas'],
          recommended_tools: ['nds_query_gammas'],
          example_calls: [
            { tool: 'nds_query_gammas', args: { Z: 82, A: 208, limit: 50 } },
          ],
        },
        {
          quantity_id: 'beta_decay_feedings',
          category: 'structure',
          entity_kind: 'dataset',
          description: 'Beta/EC decay feeding patterns (ENSDF).',
          source_libraries: ['nds'],
          primary_tables: ['ensdf_decay_feedings'],
          recommended_tools: ['nds_query_decay_feedings'],
          example_calls: [
            { tool: 'nds_query_decay_feedings', args: { Z: 82, A: 208, limit: 50 } },
          ],
        },
        {
          quantity_id: 'ensdf_references',
          category: 'structure',
          entity_kind: 'dataset',
          description: 'Bibliographic references (ENSDF/NSR).',
          source_libraries: ['nds'],
          primary_tables: ['ensdf_references'],
          recommended_tools: ['nds_lookup_reference'],
          example_calls: [
            { tool: 'nds_lookup_reference', args: { A: 208 } },
          ],
        },
        {
          quantity_id: 'codata_constants',
          category: 'constants',
          entity_kind: 'constant',
          description: 'CODATA recommended fundamental constants (value/uncertainty/unit).',
          source_libraries: ['nds'],
          primary_tables: ['codata_constants'],
          recommended_tools: ['nds_get_constant', 'nds_list_constants'],
          example_calls: [
            { tool: 'nds_get_constant', args: { name: 'speed of light in vacuum' } },
          ],
        },
        {
          quantity_id: 'jendl5_decay_radiation',
          category: 'decay',
          entity_kind: 'nuclide',
          description: 'JENDL-5 decay radiation spectra (discrete lines + continuous summaries).',
          source_libraries: ['jendl5'],
          primary_tables: ['jendl5_decays', 'jendl5_decay_modes', 'jendl5_radiation'],
          recommended_tools: ['nds_get_radiation_spectrum'],
          example_calls: [
            { tool: 'nds_get_radiation_spectrum', args: { Z: 82, A: 208, state: 0, type: 'gamma' } },
          ],
        },
        {
          quantity_id: 'evaluated_cross_sections',
          category: 'xs',
          entity_kind: 'reaction',
          description: 'Evaluated pointwise cross sections (ENDF-6 MF=3) with interpolation laws (NBT/INT).',
          source_libraries: ['jendl5', 'fendl32c', 'irdff2'],
          primary_tables: [
            'jendl5_xs_meta', 'jendl5_xs_points', 'jendl5_xs_interp',
            'fendl_xs_meta', 'fendl_xs_points', 'fendl_xs_interp',
            'irdff_xs_meta', 'irdff_xs_points', 'irdff_xs_interp',
          ],
          recommended_tools: [
            'nds_list_available_targets',
            'nds_get_reaction_info',
            'nds_get_cross_section_table',
            'nds_interpolate_cross_section',
          ],
          example_calls: [
            { tool: 'nds_get_reaction_info', args: { Z: 82, A: 208, projectile: 'n', state: 0 } },
            { tool: 'nds_query', args: { library: 'fendl32c', table: 'fendl_xs_meta', where: { eq: { Z: 82, A: 208, projectile: 'n', state: 0 } }, limit: 50 } },
          ],
        },
        {
          quantity_id: 'exfor_points',
          category: 'experimental',
          entity_kind: 'reaction',
          description: 'EXFOR experimental points (cross sections and related quantities) + per-entry metadata.',
          source_libraries: ['exfor'],
          primary_tables: ['exfor_entries', 'exfor_points'],
          recommended_tools: ['nds_search_exfor', 'nds_get_exfor_entry'],
          example_calls: [
            { tool: 'nds_search_exfor', args: { Z: 82, A: 208, projectile: 'n', quantity: 'SIG', limit: 20 } },
          ],
        },
        {
          quantity_id: 'raw_endf_archives',
          category: 'raw_endf',
          entity_kind: 'dataset',
          description: 'Embedded upstream ENDF-6 archives (zip) stored as SQLite BLOBs (metadata is queryable; payload is not returned in standard tools).',
          source_libraries: ['fendl32c', 'irdff2'],
          primary_tables: ['fendl_raw_archives', 'irdff_raw_archives'],
          recommended_tools: ['nds_list_raw_archives'],
          example_calls: [
            { tool: 'nds_list_raw_archives', args: { library: 'fendl32c', projectile: 'n', limit: 20 } },
          ],
        },
      ] as const;

      const quantities = quantitiesBase;

      return {
        tool_mode: ctx.mode,
        libraries,
        quantities,
        note: 'Use nds_schema to inspect tables/columns, then nds_query for safe structured queries (BLOB columns are never returned).',
      };
    },
  },
  {
    name: NDS_SCHEMA,
    description: 'Inspect SQLite schema for an installed NDS database library (tables/columns/foreign keys, optional indexes).',
    exposure: 'standard',
    zodSchema: NdsSchemaSchema,
    handler: async (params) => {
      const dbPath = await resolveDbPathForLibrary(params.library);
      const tables = await listTables(dbPath);

      const tableSchemas = await Promise.all(tables.map(async (t) => {
        const columns = await getTableColumns(dbPath, t.name);
        const foreignKeys = await getTableForeignKeys(dbPath, t.name);
        const indexes = params.include_indexes ? await getTableIndexes(dbPath, t.name) : undefined;
        return {
          name: t.name,
          type: t.type,
          columns,
          foreign_keys: foreignKeys,
          ...(indexes ? { indexes } : {}),
        };
      }));

      return {
        library: params.library,
        db_path: dbPath,
        tables: tableSchemas,
      };
    },
  },
  {
    name: NDS_QUERY,
    description: 'Safe structured query builder over SQLite tables (filter/sort/paginate; no raw SQL input).',
    exposure: 'standard',
    zodSchema: NdsQuerySchema,
    handler: async (params) => {
      const MAX_LIMIT = 5000;

      assertSafeIdentifier(params.table, 'table');

      const dbPath = await resolveDbPathForLibrary(params.library);

      const tableLookup = await sqlite3JsonQuery(
        dbPath,
        `SELECT name, type
         FROM sqlite_master
         WHERE type IN ('table','view')
           AND name=${sqlStringLiteral(params.table)}
           AND name NOT LIKE 'sqlite_%'
         LIMIT 1`,
      );
      if (tableLookup.length === 0) {
        throw invalidParams(`Unknown table or view: ${params.table}`, {
          library: params.library,
          table: params.table,
          how_to: 'Call nds_schema first to discover available table/view names.',
        });
      }

      const columns = await getTableColumns(dbPath, params.table);
      const colByName = new Map(columns.map(c => [c.name, c] as const));
      const blobCols = columns.filter(isBlobColumn).map(c => c.name);
      const nonBlobCols = columns.filter(c => !isBlobColumn(c)).map(c => c.name);

      if (nonBlobCols.length === 0) {
        throw invalidParams(`Refusing to query table with only BLOB columns: ${params.table}`, {
          library: params.library,
          table: params.table,
        });
      }

      const notes: string[] = [];

      const selectedCols = (() => {
        if (!params.select || params.select.length === 0) {
          if (blobCols.length > 0) {
            notes.push(`Excluded BLOB columns from default select: ${blobCols.join(', ')}`);
          }
          return nonBlobCols;
        }

        const out: string[] = [];
        const seen = new Set<string>();
        for (const col of params.select) {
          assertSafeIdentifier(col, 'column');
          const schemaCol = colByName.get(col);
          if (!schemaCol) {
            throw invalidParams(`Unknown column in select: ${col}`, {
              library: params.library,
              table: params.table,
              column: col,
            });
          }
          if (isBlobColumn(schemaCol)) {
            throw invalidParams(`BLOB columns are not allowed in select: ${col}`, {
              library: params.library,
              table: params.table,
              column: col,
              rule: 'BLOB columns cannot be selected or returned.',
            });
          }
          if (!seen.has(col)) {
            out.push(col);
            seen.add(col);
          }
        }
        if (out.length === 0) {
          throw invalidParams('select must include at least one non-BLOB column', {
            library: params.library,
            table: params.table,
          });
        }
        return out;
      })();

      const where = params.where ?? {};

      if (params.table.endsWith('_points')) {
        const eq = where.eq ?? {};
        const hasXsId = Object.prototype.hasOwnProperty.call(eq, 'xs_id') && (eq as Record<string, unknown>).xs_id !== null;
        const hasEntryId = Object.prototype.hasOwnProperty.call(eq, 'entry_id') && (eq as Record<string, unknown>).entry_id !== null;
        if (!hasXsId && !hasEntryId) {
          throw invalidParams(
            'High-selectivity equality filter required for *_points tables (use where.eq.xs_id or where.eq.entry_id).',
            {
              library: params.library,
              table: params.table,
              rule: 'points_table_requires_eq_parent_id',
              how_to: 'Query the corresponding *_meta/*_entries table to obtain xs_id/entry_id, then query *_points.',
            },
          );
        }
      }

      const conditions: string[] = [];

      const requireNonBlobColumn = (col: string, usage: string): void => {
        const schemaCol = colByName.get(col);
        if (!schemaCol) {
          throw invalidParams(`Unknown column in ${usage}: ${col}`, {
            library: params.library,
            table: params.table,
            column: col,
          });
        }
        if (isBlobColumn(schemaCol)) {
          throw invalidParams(`BLOB columns are not allowed in ${usage}: ${col}`, {
            library: params.library,
            table: params.table,
            column: col,
          });
        }
      };

      const sqlValueLiteral = (value: string | number): string => {
        if (typeof value === 'number') {
          if (!Number.isFinite(value)) {
            throw invalidParams('Non-finite number is not allowed in query filters.', {
              value,
            });
          }
          return String(value);
        }
        return sqlStringLiteral(value);
      };

      if (where.eq) {
        for (const [col, value] of Object.entries(where.eq)) {
          assertSafeIdentifier(col, 'column');
          requireNonBlobColumn(col, 'where.eq');
          if (value === null) {
            conditions.push(`"${col}" IS NULL`);
          } else if (typeof value === 'string' || typeof value === 'number') {
            conditions.push(`"${col}" = ${sqlValueLiteral(value)}`);
          } else {
            throw invalidParams('where.eq values must be string|number|null', {
              library: params.library,
              table: params.table,
              col,
              value,
            });
          }
        }
      }

      if (where.range) {
        for (const r of where.range) {
          assertSafeIdentifier(r.col, 'column');
          requireNonBlobColumn(r.col, 'where.range');
          if (r.gte === undefined && r.lte === undefined) {
            throw invalidParams('where.range entries must set at least one of gte/lte', {
              library: params.library,
              table: params.table,
              col: r.col,
            });
          }
          if (r.gte !== undefined) conditions.push(`"${r.col}" >= ${sqlValueLiteral(r.gte)}`);
          if (r.lte !== undefined) conditions.push(`"${r.col}" <= ${sqlValueLiteral(r.lte)}`);
        }
      }

      if (where.in) {
        for (const r of where.in) {
          assertSafeIdentifier(r.col, 'column');
          requireNonBlobColumn(r.col, 'where.in');
          if (!Array.isArray(r.values) || r.values.length === 0) {
            throw invalidParams('where.in values must be a non-empty array', {
              library: params.library,
              table: params.table,
              col: r.col,
            });
          }
          const lits = r.values.map((v: unknown) => {
            if (typeof v === 'string' || typeof v === 'number') return sqlValueLiteral(v);
            throw invalidParams('where.in values must be string|number', {
              library: params.library,
              table: params.table,
              col: r.col,
              value: v,
            });
          });
          conditions.push(`"${r.col}" IN (${lits.join(', ')})`);
        }
      }

      if (where.like) {
        for (const r of where.like) {
          assertSafeIdentifier(r.col, 'column');
          requireNonBlobColumn(r.col, 'where.like');
          conditions.push(`"${r.col}" LIKE ${sqlStringLiteral(r.pattern)}`);
        }
      }

      const orderByParts: string[] = [];
      if (params.order_by) {
        for (const ob of params.order_by) {
          assertSafeIdentifier(ob.col, 'column');
          requireNonBlobColumn(ob.col, 'order_by');
          const dir = ob.dir === 'desc' ? 'DESC' : 'ASC';
          orderByParts.push(`"${ob.col}" ${dir}`);
        }
      }

      let limit = params.limit;
      const offset = params.offset ?? 0;
      if (limit > MAX_LIMIT) {
        notes.push(`Capped limit from ${limit} to ${MAX_LIMIT}.`);
        limit = MAX_LIMIT;
      }

      const selectSql = selectedCols.map(c => `"${c}"`).join(', ');
      const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
      const orderSql = orderByParts.length > 0 ? ` ORDER BY ${orderByParts.join(', ')}` : '';
      const sql = `SELECT ${selectSql} FROM "${params.table}"${whereSql}${orderSql} LIMIT ${limit} OFFSET ${offset}`;

      const rows = await sqlite3JsonQuery(dbPath, sql);

      return {
        rows,
        page: {
          limit,
          offset,
          returned: rows.length,
        },
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      };
    },
  },
  {
    name: NDS_LIST_RAW_ARCHIVES,
    description: 'List embedded upstream ENDF-6 zip archive metadata for FENDL/IRDFF (never returns BLOB payloads).',
    exposure: 'standard',
    zodSchema: NdsListRawArchivesSchema,
    handler: async (params) => {
      const MAX_LIMIT = 5000;
      const notes: string[] = [];

      let limit = params.limit;
      if (limit > MAX_LIMIT) {
        notes.push(`Capped limit from ${limit} to ${MAX_LIMIT}.`);
        limit = MAX_LIMIT;
      }
      const offset = params.offset ?? 0;

      const dbPath = await resolveDbPathForLibrary(params.library);
      const table = params.library === 'fendl32c' ? 'fendl_raw_archives' : 'irdff_raw_archives';

      const tableLookup = await sqlite3JsonQuery(
        dbPath,
        `SELECT name
         FROM sqlite_master
         WHERE type='table' AND name=${sqlStringLiteral(table)}
         LIMIT 1`,
      );
      if (tableLookup.length === 0) {
        throw invalidParams(`Raw archives table not found: ${table}`, {
          library: params.library,
          table,
          how_to: 'Rebuild or update the corresponding SQLite file so it includes the raw archive table.',
        });
      }

      const conditions: string[] = [];
      if (params.projectile !== undefined) {
        conditions.push(`projectile=${sqlStringLiteral(params.projectile)}`);
      }
      if (params.q !== undefined) {
        conditions.push(`instr(rel_path, ${sqlStringLiteral(params.q)}) > 0`);
      }
      const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

      const rows = await sqlite3JsonQuery(
        dbPath,
        `SELECT rel_path, projectile, size_bytes, sha256
         FROM "${table}"${whereSql}
         ORDER BY rel_path
         LIMIT ${limit}
         OFFSET ${offset}`,
      );

      return {
        rows,
        page: {
          limit,
          offset,
          returned: rows.length,
        },
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      };
    },
  },
  {
    name: NDS_CHECK_UPDATE,
    description: 'Check npm registry for newer nds-mcp version. Does not perform updates.',
    exposure: 'standard',
    zodSchema: NdsCheckUpdateSchema,
    handler: async () => {
      return await checkNpmUpdate();
    },
  },
  {
    name: NDS_SELF_UPDATE,
    description: 'Update nds-mcp from npm (explicit opt-in). Requires confirm=true and may need system permissions.',
    exposure: 'full',
    zodSchema: NdsSelfUpdateSchema,
    handler: async (params) => {
      if (!params.confirm) {
        throw invalidParams('Self-update requires confirm=true', {
          how_to: 'Call nds_self_update with {"confirm": true, "target": "latest"}',
        });
      }
      const result = runNpmSelfUpdate({
        confirm: params.confirm,
        target: params.target,
      });
      return {
        ...result,
        note: 'Restart MCP clients after updating to load the new version.',
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
    name: NDS_LIST_AVAILABLE_TARGETS,
    description: 'List available JENDL-5 XS targets (A/state) for a given Z and projectile.',
    exposure: 'standard',
    zodSchema: NdsListAvailableTargetsSchema,
    handler: async (params) => {
      const dbPath = await ensureJendl5Db();
      const result = await listAvailableTargetsByZ(dbPath, params);
      if (!Array.isArray((result as { targets?: unknown }).targets) || (result as { targets: unknown[] }).targets.length === 0) {
        throw notFound(`No JENDL-5 XS targets for Z=${params.Z}, projectile=${params.projectile}`);
      }
      return result;
    },
  },
  {
    name: NDS_GET_REACTION_INFO,
    description: 'Return available JENDL-5 reaction channels for a target: mt, reaction, e_min_eV, e_max_eV, n_points.',
    exposure: 'standard',
    zodSchema: NdsGetReactionInfoSchema,
    handler: async (params) => {
      const dbPath = await ensureJendl5Db();
      const result = await getReactionInfo(dbPath, params);
      if (!result) {
        throw notFound(`No JENDL-5 reaction channels for Z=${params.Z}, A=${params.A}, state=${params.state}, projectile=${params.projectile}`);
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
    name: NDS_GET_DDEP_DECAY,
    description: 'Query DDEP radionuclide decay data: source-tagged half-life values and key emission lines (energy/intensity).',
    exposure: 'full',
    zodSchema: NdsGetDdepDecaySchema,
    handler: async (params) => {
      const dbPath = await ensureDdepDb();
      const result = await queryDdepDecay(dbPath, params);
      if (!result) {
        throw notFound(`No DDEP decay data for Z=${params.Z}, A=${params.A}, state=${params.state}`);
      }
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
  return TOOL_SPECS.filter(s => isToolExposed(s, mode));
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
