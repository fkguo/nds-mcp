/**
 * ENSDF (Evaluated Nuclear Structure Data File) parser.
 *
 * 80-column fixed-width ASCII format. 300 mass chain files (ensdf.001–ensdf.300).
 * Design: meta/docs/ensdf-integration-design.md (R3)
 */

// ── Element symbol lookup (Z from symbol) ──────────────────────────────────

const ELEMENT_Z: Record<string, number> = {
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

function resolveZ(element: string): number | undefined {
  if (ELEMENT_Z[element] !== undefined) return ELEMENT_Z[element];
  const titleCase = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();
  return ELEMENT_Z[titleCase];
}

// ── Types ──────────────────────────────────────────────────────────────────

export type RecordClass =
  | 'comment' | 'text' | 'xref' | 'unknown'
  | 'level' | 'gamma' | 'beta' | 'ec' | 'qvalue' | 'parent'
  | 'reference' | 'history' | 'normalization' | 'delayed' | 'alpha' | 'header';

export interface NucidInfo {
  A: number;
  element: string;
  Z: number;
}

export interface EnsdfReferenceRow {
  A: number;
  keynumber: string;
  type: string | null;
  reference: string | null;
}

export interface DatasetInfo {
  nucid: NucidInfo;
  datasetType: string;
  dsid: string;
  parentNucid?: NucidInfo;
}

export interface EnsdfLevelRow {
  dataset_id: number;
  Z: number;
  A: number;
  element: string;
  energy_keV: number;
  energy_raw: string;
  energy_unc_keV: number | null;
  spin_parity: string | null;
  half_life: string | null;
  half_life_seconds: number | null;
  half_life_unc_seconds: number | null;
  isomer_flag: string | null;
  questionable: number;
  comment_flag: string | null;
}

export interface EnsdfGammaRow {
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
  questionable: number;
  be2w: number | null;
  be2w_unc: number | null;
  bm1w: number | null;
  bm1w_unc: number | null;
}

export interface EnsdfFeedingRow {
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
}

export interface EnsdfDatasetRow {
  Z: number;
  A: number;
  element: string;
  dataset_type: string;
  dsid: string;
  parent_z: number | null;
  parent_a: number | null;
  parent_element: string | null;
  parent_half_life: string | null;
  qref_keynumbers: string | null;
  qref_raw: string | null;
}

export interface ParseStats {
  references: number;
  datasets: number;
  levels: number;
  gammas: number;
  feedings: number;
  skippedLines: number;
}

// ── Line preprocessing ─────────────────────────────────────────────────────

export function preprocessLine(raw: string): string {
  return raw.padEnd(80, ' ').substring(0, 80);
}

// ── Record classifier (§4.1) ───────────────────────────────────────────────

export function classifyRecord(line: string): RecordClass {
  const col7 = line[6];
  const col8 = line[7];

  // Col 7 non-blank → comment/text/xref, skip
  if (col7 === 'c' || col7 === 'C') return 'comment';
  if (col7 === '#') return 'comment';
  if (col7 === 't' || col7 === 'T') return 'text';
  if (col7 === 'x' || col7 === 'X') return 'xref';
  if (col7 === 'd' || col7 === 'D') return 'comment'; // documentation records
  if (col7 !== ' ') return 'unknown';

  // Col 7 = space → standard record, col 8 determines type
  switch (col8) {
    case 'L': return 'level';
    case 'G': return 'gamma';
    case 'B': return 'beta';
    case 'E': return 'ec';
    case 'Q': return 'qvalue';
    case 'P': return 'parent';
    case 'R': return 'reference';
    case 'H': return 'history';
    case 'N': return 'normalization';
    case 'D': return 'delayed';
    case 'A': return 'alpha';
    case ' ': return 'header';
    default: return 'unknown';
  }
}

// ── NUCID parsing (§4.3) ───────────────────────────────────────────────────

export function parseNucid(nucid: string): NucidInfo | null {
  const aStr = nucid.substring(0, 3).trim();
  const rawElement = nucid.substring(3, 5).trim();
  if (!aStr || !rawElement) return null;

  const A = parseInt(aStr, 10);
  if (isNaN(A)) return null;

  const Z = resolveZ(rawElement);
  if (Z === undefined) return null;

  // Normalize to title case (ENSDF uses uppercase like "NI" → "Ni")
  const element = rawElement.charAt(0).toUpperCase() + rawElement.slice(1).toLowerCase();

  return { A, element, Z };
}

// ── ENSDF value parsing (§4.7) ─────────────────────────────────────────────

export interface EnsdfValue {
  value: number | null;
  estimated: boolean;
  raw: string;
}

export function parseEnsdfValue(rawField: string): EnsdfValue {
  const raw = rawField.trim();
  if (raw === '' || raw === '*' || raw === '?') {
    return { value: null, estimated: false, raw };
  }

  const estimated = raw.includes('#');
  const cleaned = raw.replace(/#/g, '.');

  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) {
    return { value: null, estimated, raw };
  }

  return { value: n, estimated, raw };
}

// ── Uncertainty computation (§4.4) ─────────────────────────────────────────

const SPECIAL_UNC = new Set(['', '?', 'AP', 'GT', 'LT', 'GE', 'LE', 'SY', 'CA']);

export function ensdfUncertainty(rawValue: string, rawUnc: string): number | null {
  const unc = rawUnc.trim().toUpperCase();
  if (SPECIAL_UNC.has(unc)) return null;

  // Asymmetric uncertainty: e.g. "+12-10" or "12+10"
  const asymMatch = unc.match(/^\+?(\d+)\s*-(\d+)$/) || unc.match(/^(\d+)\s*\+(\d+)$/);
  let uncDigits: number;
  if (asymMatch) {
    uncDigits = Math.max(parseFloat(asymMatch[1]!), parseFloat(asymMatch[2]!));
  } else {
    uncDigits = parseFloat(unc);
    if (!Number.isFinite(uncDigits)) return null;
  }

  // Determine precision from raw value string
  let cleaned = rawValue.trim().replace(/#/g, '');
  if (cleaned === '' || cleaned === '*' || cleaned === '?') return null;

  // Scientific notation: e.g. "6.52E3", "1201E1"
  const sciMatch = cleaned.match(/^([+-]?\d*\.?\d+)[Ee]([+-]?\d+)$/);
  if (sciMatch) {
    const mantissa = sciMatch[1]!;
    const exponent = parseInt(sciMatch[2]!, 10);
    const dotPos = mantissa.indexOf('.');
    const decimals = dotPos >= 0 ? mantissa.length - dotPos - 1 : 0;
    const scale = Math.pow(10, exponent - decimals);
    return uncDigits * scale;
  }

  // Standard number
  const dotPos = cleaned.indexOf('.');
  const decimals = dotPos >= 0 ? cleaned.length - dotPos - 1 : 0;
  const scale = Math.pow(10, -decimals);
  return uncDigits * scale;
}

// ── Half-life parsing (§4.5) ───────────────────────────────────────────────

const HALF_LIFE_UNITS: Record<string, number> = {
  'Y': 3.1556926e7,
  'D': 8.6400e4,
  'H': 3.600e3,
  'M': 6.0e1,
  'S': 1,
  'MS': 1e-3,
  'US': 1e-6,
  'NS': 1e-9,
  'PS': 1e-12,
  'FS': 1e-15,
  'AS': 1e-18,
};

// ln(2) × ℏ = 4.562339×10⁻¹⁶ eV·s
const LN2_HBAR_EV_S = 4.562339e-16;

export interface HalfLifeResult {
  seconds: number | null;
  unc_seconds: number | null;
  display: string;
}

export function parseHalfLife(rawT: string, rawDT: string): HalfLifeResult {
  const display = rawT.trim();
  if (display === '' || display === '?' || display === '*') {
    return { seconds: null, unc_seconds: null, display };
  }
  if (display.toUpperCase() === 'STABLE') {
    return { seconds: null, unc_seconds: null, display: 'STABLE' };
  }

  // Tokenize: "1925.28 D" → number + unit
  // Handle special cases like ">1 S" or "AP 2 S" — just extract number and unit
  const match = display.match(/([0-9.Ee+\-]+)\s*([A-Za-z]+)/);
  if (!match) {
    return { seconds: null, unc_seconds: null, display };
  }

  const numVal = parseFloat(match[1]!);
  if (!Number.isFinite(numVal)) {
    return { seconds: null, unc_seconds: null, display };
  }

  const unit = match[2]!.toUpperCase();

  // Standard time units
  const factor = HALF_LIFE_UNITS[unit];
  if (factor !== undefined) {
    const seconds = numVal * factor;
    let unc_seconds: number | null = null;
    const dtStr = rawDT.trim();
    if (dtStr && dtStr !== '?' && dtStr !== '*') {
      const dtVal = ensdfUncertainty(match[1]!, dtStr);
      if (dtVal !== null) {
        unc_seconds = dtVal * factor;
      }
    }
    return { seconds, unc_seconds, display };
  }

  // Energy-width units: EV, KEV, MEV → T½ = ln(2)·ℏ/Γ
  if (unit === 'EV') {
    const seconds = LN2_HBAR_EV_S / numVal;
    return { seconds, unc_seconds: null, display };
  }
  if (unit === 'KEV') {
    const seconds = LN2_HBAR_EV_S / (numVal * 1e3);
    return { seconds, unc_seconds: null, display };
  }
  if (unit === 'MEV') {
    const seconds = LN2_HBAR_EV_S / (numVal * 1e6);
    return { seconds, unc_seconds: null, display };
  }

  // Unknown unit
  return { seconds: null, unc_seconds: null, display };
}

// ── Record parsers ─────────────────────────────────────────────────────────

export function parseReferenceRecord(line: string, massNumber: number): EnsdfReferenceRow | null {
  const keynumber = line.substring(9, 17).trim();
  if (!keynumber) return null;

  // Col 18 is a blank separator; TYPE at cols 19-22 = substring(18, 22)
  const type = line.substring(18, 22).trim() || null;
  const reference = line.substring(22, 80).trim() || null;

  return { A: massNumber, keynumber, type, reference };
}

interface ParsedLevel {
  energy_keV: number;
  energy_raw: string;
  energy_unc_keV: number | null;
  spin_parity: string | null;
  half_life: string | null;
  half_life_seconds: number | null;
  half_life_unc_seconds: number | null;
  isomer_flag: string | null;
  questionable: number;
  comment_flag: string | null;
}

export function parseLevelRecord(line: string): ParsedLevel | null {
  const eRaw = line.substring(9, 19).trim();
  const eVal = parseEnsdfValue(eRaw);
  if (eVal.value === null) return null;

  const deRaw = line.substring(19, 21).trim();
  const eUnc = deRaw ? ensdfUncertainty(eRaw, deRaw) : null;

  const j = line.substring(21, 39).trim() || null;

  const tRaw = line.substring(39, 49);
  const dtRaw = line.substring(49, 55);
  const hl = parseHalfLife(tRaw, dtRaw);

  const commentFlag = line[76] !== ' ' ? line[76]! : null;
  const ms = line.substring(77, 79).trim() || null;
  const q = line[79] === '?' ? 1 : 0;

  return {
    energy_keV: eVal.value,
    energy_raw: eRaw,
    energy_unc_keV: eUnc,
    spin_parity: j,
    half_life: hl.display || null,
    half_life_seconds: hl.seconds,
    half_life_unc_seconds: hl.unc_seconds,
    isomer_flag: ms,
    questionable: q,
    comment_flag: commentFlag,
  };
}

interface ParsedGamma {
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
  questionable: number;
}

export function parseGammaRecord(line: string): ParsedGamma | null {
  const eRaw = line.substring(9, 19).trim();
  const eVal = parseEnsdfValue(eRaw);
  if (eVal.value === null) return null;

  const deRaw = line.substring(19, 21).trim();
  const eUnc = deRaw ? ensdfUncertainty(eRaw, deRaw) : null;

  const riRaw = line.substring(21, 29).trim();
  const riVal = riRaw ? parseEnsdfValue(riRaw) : { value: null };
  const driRaw = line.substring(29, 31).trim();
  const riUnc = (riRaw && driRaw) ? ensdfUncertainty(riRaw, driRaw) : null;

  const m = line.substring(31, 41).trim() || null;

  const mrRaw = line.substring(41, 49).trim();
  const mrVal = mrRaw ? parseEnsdfValue(mrRaw) : { value: null };
  const dmrRaw = line.substring(49, 55).trim();
  const mrUnc = (mrRaw && dmrRaw) ? ensdfUncertainty(mrRaw, dmrRaw) : null;

  const ccRaw = line.substring(55, 62).trim();
  const ccVal = ccRaw ? parseEnsdfValue(ccRaw) : { value: null };
  const dccRaw = line.substring(62, 64).trim();
  const ccUnc = (ccRaw && dccRaw) ? ensdfUncertainty(ccRaw, dccRaw) : null;

  const tiRaw = line.substring(64, 74).trim();
  const tiVal = tiRaw ? parseEnsdfValue(tiRaw) : { value: null };
  const dtiRaw = line.substring(74, 76).trim();
  const tiUnc = (tiRaw && dtiRaw) ? ensdfUncertainty(tiRaw, dtiRaw) : null;

  const commentFlag = line[76] !== ' ' ? line[76]! : null;
  const coinFlag = line[77] !== ' ' ? line[77]! : null;
  const q = line[79] === '?' ? 1 : 0;

  return {
    gamma_energy_keV: eVal.value,
    gamma_energy_raw: eRaw,
    gamma_energy_unc_keV: eUnc,
    rel_intensity: riVal.value,
    rel_intensity_unc: riUnc,
    total_intensity: tiVal.value,
    total_intensity_unc: tiUnc,
    multipolarity: m,
    mixing_ratio: mrVal.value,
    mixing_ratio_unc: mrUnc,
    total_conv_coeff: ccVal.value,
    total_conv_coeff_unc: ccUnc,
    comment_flag: commentFlag,
    coin_flag: coinFlag,
    questionable: q,
  };
}

interface ParsedBeta {
  endpoint_keV: number | null;
  endpoint_unc_keV: number | null;
  ib_percent: number | null;
  ib_percent_unc: number | null;
  log_ft: number | null;
  log_ft_unc: number | null;
  forbiddenness: string | null;
  comment_flag: string | null;
}

export function parseBetaRecord(line: string): ParsedBeta {
  const eRaw = line.substring(9, 19).trim();
  const eVal = eRaw ? parseEnsdfValue(eRaw) : { value: null };
  const deRaw = line.substring(19, 21).trim();
  const eUnc = (eRaw && deRaw) ? ensdfUncertainty(eRaw, deRaw) : null;

  const ibRaw = line.substring(21, 29).trim();
  const ibVal = ibRaw ? parseEnsdfValue(ibRaw) : { value: null };
  const dibRaw = line.substring(29, 31).trim();
  const ibUnc = (ibRaw && dibRaw) ? ensdfUncertainty(ibRaw, dibRaw) : null;

  const ftRaw = line.substring(41, 49).trim();
  const ftVal = ftRaw ? parseEnsdfValue(ftRaw) : { value: null };
  const dftRaw = line.substring(49, 55).trim();
  const ftUnc = (ftRaw && dftRaw) ? ensdfUncertainty(ftRaw, dftRaw) : null;

  const commentFlag = line[76] !== ' ' ? line[76]! : null;
  const un = line.substring(77, 79).trim() || null;

  return {
    endpoint_keV: eVal.value,
    endpoint_unc_keV: eUnc,
    ib_percent: ibVal.value,
    ib_percent_unc: ibUnc,
    log_ft: ftVal.value,
    log_ft_unc: ftUnc,
    forbiddenness: un,
    comment_flag: commentFlag,
  };
}

interface ParsedEC {
  endpoint_keV: number | null;
  endpoint_unc_keV: number | null;
  ib_percent: number | null;
  ib_percent_unc: number | null;
  ie_percent: number | null;
  ie_percent_unc: number | null;
  ti_percent: number | null;
  ti_percent_unc: number | null;
  log_ft: number | null;
  log_ft_unc: number | null;
  forbiddenness: string | null;
  comment_flag: string | null;
}

export function parseECRecord(line: string): ParsedEC {
  const eRaw = line.substring(9, 19).trim();
  const eVal = eRaw ? parseEnsdfValue(eRaw) : { value: null };
  const deRaw = line.substring(19, 21).trim();
  const eUnc = (eRaw && deRaw) ? ensdfUncertainty(eRaw, deRaw) : null;

  const ibRaw = line.substring(21, 29).trim();
  const ibVal = ibRaw ? parseEnsdfValue(ibRaw) : { value: null };
  const dibRaw = line.substring(29, 31).trim();
  const ibUnc = (ibRaw && dibRaw) ? ensdfUncertainty(ibRaw, dibRaw) : null;

  const ieRaw = line.substring(31, 39).trim();
  const ieVal = ieRaw ? parseEnsdfValue(ieRaw) : { value: null };
  const dieRaw = line.substring(39, 41).trim();
  const ieUnc = (ieRaw && dieRaw) ? ensdfUncertainty(ieRaw, dieRaw) : null;

  const ftRaw = line.substring(41, 49).trim();
  const ftVal = ftRaw ? parseEnsdfValue(ftRaw) : { value: null };
  const dftRaw = line.substring(49, 55).trim();
  const ftUnc = (ftRaw && dftRaw) ? ensdfUncertainty(ftRaw, dftRaw) : null;

  const tiRaw = line.substring(64, 74).trim();
  const tiVal = tiRaw ? parseEnsdfValue(tiRaw) : { value: null };
  const dtiRaw = line.substring(74, 76).trim();
  const tiUnc = (tiRaw && dtiRaw) ? ensdfUncertainty(tiRaw, dtiRaw) : null;

  const commentFlag = line[76] !== ' ' ? line[76]! : null;
  const un = line.substring(77, 79).trim() || null;

  return {
    endpoint_keV: eVal.value,
    endpoint_unc_keV: eUnc,
    ib_percent: ibVal.value,
    ib_percent_unc: ibUnc,
    ie_percent: ieVal.value,
    ie_percent_unc: ieUnc,
    ti_percent: tiVal.value,
    ti_percent_unc: tiUnc,
    log_ft: ftVal.value,
    log_ft_unc: ftUnc,
    forbiddenness: un,
    comment_flag: commentFlag,
  };
}

export function parseParentRecord(line: string): { halfLife: string | null; halfLifeSeconds: number | null } {
  const tRaw = line.substring(39, 49);
  const dtRaw = line.substring(49, 55);
  const hl = parseHalfLife(tRaw, dtRaw);
  return { halfLife: hl.display || null, halfLifeSeconds: hl.seconds };
}

// ── QREF extraction ────────────────────────────────────────────────────────

export function extractQrefKeynumbers(line: string): { keynumbers: string[]; raw: string } {
  const raw = line.substring(55, 80).trim();
  if (!raw) return { keynumbers: [], raw: '' };

  // NSR keynumbers are 8-char format like "2012WA38" — extract all matches
  const matches = raw.match(/\d{4}[A-Za-z]{2}\d{2}/g);
  return { keynumbers: matches || [], raw };
}

// ── Dataset identification (§4.8) ──────────────────────────────────────────

/**
 * Format a compact NUCID like "60CO" into ENSDF 5-char format " 60CO"
 * (mass right-justified in first 3 chars, element left-justified in last 2).
 */
function formatNucidForParsing(compact: string): string {
  const m = compact.match(/^(\d+)\s*([A-Za-z]+)$/);
  if (!m) return compact.padEnd(5);
  const mass = m[1]!.padStart(3);
  const el = m[2]!.padEnd(2).substring(0, 2);
  return mass + el;
}

export function identifyDataset(headerLine: string): DatasetInfo | null {
  const nucidStr = headerLine.substring(0, 5);
  const nucid = parseNucid(nucidStr);
  if (!nucid) return null;

  const dsid = headerLine.substring(9, 39).trim();
  if (!dsid) return null;

  // ADOPTED LEVELS, GAMMAS
  if (/ADOPTED\s+LEVELS,\s*GAMMAS/.test(dsid)) {
    return { nucid, datasetType: 'ADOPTED LEVELS, GAMMAS', dsid };
  }
  // ADOPTED LEVELS (without GAMMAS)
  if (/ADOPTED\s+LEVELS/.test(dsid) && !/GAMMAS/.test(dsid)) {
    return { nucid, datasetType: 'ADOPTED LEVELS', dsid };
  }
  // B- DECAY
  const bmMatch = dsid.match(/(\d+\s*\w+)\s+B-\s+DECAY/);
  if (bmMatch) {
    const parentNucid = parseNucid(formatNucidForParsing(bmMatch[1]!));
    return { nucid, datasetType: 'B- DECAY', dsid, parentNucid: parentNucid || undefined };
  }
  // EC+B+ DECAY (must match before EC DECAY)
  const ecbpMatch = dsid.match(/(\d+\s*\w+)\s+EC\+B\+\s+DECAY/);
  if (ecbpMatch) {
    const parentNucid = parseNucid(formatNucidForParsing(ecbpMatch[1]!));
    return { nucid, datasetType: 'EC+B+ DECAY', dsid, parentNucid: parentNucid || undefined };
  }
  // EC DECAY
  const ecMatch = dsid.match(/(\d+\s*\w+)\s+EC\s+DECAY/);
  if (ecMatch) {
    const parentNucid = parseNucid(formatNucidForParsing(ecMatch[1]!));
    return { nucid, datasetType: 'EC DECAY', dsid, parentNucid: parentNucid || undefined };
  }
  // IT DECAY
  const itMatch = dsid.match(/(\d+\s*\w+)\s+IT\s+DECAY/);
  if (itMatch) {
    const parentNucid = parseNucid(formatNucidForParsing(itMatch[1]!));
    return { nucid, datasetType: 'IT DECAY', dsid, parentNucid: parentNucid || undefined };
  }

  // Other datasets (reactions, Coulomb excitation, etc.) — skip
  return null;
}

// ── B-type continuation parsing (§4.6) ─────────────────────────────────────

export function parseBTypeContinuation(line: string): { be2w: number | null; be2w_unc: number | null; bm1w: number | null; bm1w_unc: number | null } {
  const text = line.substring(9, 80);
  const result = { be2w: null as number | null, be2w_unc: null as number | null, bm1w: null as number | null, bm1w_unc: null as number | null };

  const be2wMatch = text.match(/BE2W\s*=\s*([0-9.Ee+\-]+)\s+(\d+)/);
  if (be2wMatch) {
    result.be2w = parseFloat(be2wMatch[1]!);
    result.be2w_unc = ensdfUncertainty(be2wMatch[1]!, be2wMatch[2]!);
  }

  const bm1wMatch = text.match(/BM1W\s*=\s*([0-9.Ee+\-]+)\s+(\d+)/);
  if (bm1wMatch) {
    result.bm1w = parseFloat(bm1wMatch[1]!);
    result.bm1w_unc = ensdfUncertainty(bm1wMatch[1]!, bm1wMatch[2]!);
  }

  return result;
}

// ── S-type continuation parsing ────────────────────────────────────────────

export function parseSTypeContinuation(line: string): { cc: number | null; cc_unc: number | null } {
  const text = line.substring(9, 80);
  const result = { cc: null as number | null, cc_unc: null as number | null };

  const ccMatch = text.match(/\bCC\s*=\s*([0-9.Ee+\-]+)\s+(\d+)/);
  if (ccMatch) {
    result.cc = parseFloat(ccMatch[1]!);
    result.cc_unc = ensdfUncertainty(ccMatch[1]!, ccMatch[2]!);
  }

  return result;
}

// ── Dataset title → parent half-life from title brackets ───────────────────

export function extractTitleHalfLife(dsid: string): string | null {
  // e.g. "60CO B- DECAY (1925.28 D)" → "1925.28 D"
  const match = dsid.match(/\(([^)]+)\)\s*$/);
  return match ? match[1]!.trim() : null;
}

// ── Exported: split file content into dataset blocks ───────────────────────

export interface DatasetBlock {
  lines: string[];
  headerLine: string;
}

export function splitIntoDatasets(content: string): DatasetBlock[] {
  const rawLines = content.split('\n');
  const blocks: DatasetBlock[] = [];
  let currentLines: string[] = [];

  for (const rawLine of rawLines) {
    const line = preprocessLine(rawLine);

    // Blank line (all spaces) = dataset separator
    if (line.trim() === '') {
      if (currentLines.length > 0) {
        blocks.push({ lines: currentLines, headerLine: currentLines[0]! });
        currentLines = [];
      }
      continue;
    }

    currentLines.push(line);
  }

  // Last block
  if (currentLines.length > 0) {
    blocks.push({ lines: currentLines, headerLine: currentLines[0]! });
  }

  return blocks;
}
