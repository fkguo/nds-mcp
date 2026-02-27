/**
 * Parser for TUNL (Triangle Universities Nuclear Laboratory) energy level tables.
 *
 * Input: pdftotext -layout output from TUNL EL PDF files.
 * Handles both even-A and odd-A formats, including:
 * - Inline Jπ (8Be 2004 style)
 * - Parity on separate line above OR below energy (12C 2017, 14N 1991)
 * - Fractional Jπ for half-integer spins (5Li, 7Li, 11B, 15N)
 * - Lifetime (τm) and width (Γ) with unit conversion
 *
 * Evaluation years: 1991, 1992, 1993, 1995, 1998, 2002, 2004, 2012, 2017.
 */

// ── Element → Z mapping (light nuclei only, A ≤ 20) ──────────────────────────

const ELEMENT_Z: Record<string, number> = {
  n: 0, H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9,
  Ne: 10, Na: 11, Mg: 12,
};

function elementToZ(el: string): number {
  const z = ELEMENT_Z[el];
  if (z !== undefined) return z;
  const tc = el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
  const z2 = ELEMENT_Z[tc];
  if (z2 !== undefined) return z2;
  throw new Error(`Unknown element for TUNL: ${el}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TunlLevelRow {
  Z: number;
  A: number;
  element: string;
  energy_keV: number;
  energy_unc_keV: number | null;
  energy_raw: string | null;
  spin_parity: string | null;
  isospin: string | null;
  width_keV: number | null;
  width_unc_keV: number | null;
  width_raw: string | null;
  width_relation: string | null;  // '<' | '≤' | '=' | '≈' | 'broad' | 'calc'
  half_life: string | null;
  decay_modes: string | null;
  evaluation: string;
  table_label: string;
}

interface TableMeta {
  sourceTable: string;
  evaluation: string;
  A: number;
  element: string;
  Z: number;
  defaultWidthUnit: 'keV' | 'MeV';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HBAR_KEV_S = 6.582119569e-19; // ℏ in keV·s

const TIME_UNITS: Record<string, number> = {
  s: 1, ms: 1e-3, us: 1e-6, 'μs': 1e-6, ns: 1e-9,
  ps: 1e-12, fs: 1e-15, fsec: 1e-15, as: 1e-18,
};

const ENERGY_UNITS: Record<string, number> = {
  keV: 1, MeV: 1000, eV: 0.001, meV: 1e-6,
};

// ── Header parsing ────────────────────────────────────────────────────────────

const TABLE_HEADER_RE =
  /Table\s+([\d.]+)\s+from\s+\((\d{4}\w+)\):\s*Energy\s+levels?\s+of\s+(\d+)\s+(\w+)/i;

function detectWidthUnit(text: string): 'keV' | 'MeV' {
  const headerLines = text.split('\n').slice(0, 15);
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i]!;
    // Inline: "Γcm (MeV)" or "Γcm b (MeV)"
    if (/Γcm\s*\w?\s*\(MeV\)/i.test(line)) return 'MeV';
    // Inline: "Γcm (keV)" → explicit keV
    if (/Γcm\s*\w?\s*\(keV\)/i.test(line)) return 'keV';
    // Split-line: "Γcm" on this line, "(MeV)" on next line at similar column
    if (/Γcm/.test(line) && i + 1 < headerLines.length) {
      const gammaPos = line.indexOf('Γcm');
      const nextLine = headerLines[i + 1]!;
      const mevRe = /\(MeV\)/g;
      let m;
      while ((m = mevRe.exec(nextLine)) !== null) {
        if (Math.abs(m.index - gammaPos) < 12) return 'MeV';
      }
    }
  }
  return 'keV';
}

function parseTableHeader(text: string): TableMeta | null {
  const m = text.match(TABLE_HEADER_RE);
  if (!m) return null;

  const sourceTable = `Table ${m[1]}`;
  const evaluation = m[2]!;
  const A = parseInt(m[3]!, 10);
  const element = m[4]!;
  const Z = elementToZ(element);
  const defaultWidthUnit = detectWidthUnit(text);

  return { sourceTable, evaluation, A, element, Z, defaultWidthUnit };
}

// ── Width/lifetime parsing ────────────────────────────────────────────────────

interface WidthResult {
  width_keV: number | null;
  width_unc_keV: number | null;
  width_raw: string | null;
  width_relation: string | null;  // '<' | '≤' | '=' | '≈' | 'broad' | 'calc'
  half_life: string | null;
}

function stripFootnotes(s: string): string {
  // Remove trailing single-letter footnote markers: "1513 ± 15 i" → "1513 ± 15"
  return s.replace(/\s+[a-z]$/g, '').replace(/\s+[a-z],/g, ',').trim();
}

export function parseWidth(raw: string, defaultUnit: 'keV' | 'MeV'): WidthResult {
  const s = stripFootnotes(raw.trim());
  if (!s || s === '-' || s === '–') {
    return { width_keV: null, width_unc_keV: null, width_raw: null, width_relation: null, half_life: null };
  }
  if (/^stable$/i.test(s)) {
    return { width_keV: null, width_unc_keV: null, width_raw: null, width_relation: null, half_life: 'stable' };
  }
  if (/^broad$/i.test(s)) {
    return { width_keV: null, width_unc_keV: null, width_raw: s, width_relation: 'broad', half_life: null };
  }

  let cleaned = s;
  // Strip leading Γ= or τm=
  const isLifetimeExplicit = /^τm?\s*=/i.test(cleaned);
  cleaned = cleaned.replace(/^(?:Γ|τm?)\s*=\s*/i, '').trim();
  // Strip leading |g| = ... lines (magnetic moment, not width)
  if (/^\|g\|/.test(cleaned)) {
    return { width_keV: null, width_unc_keV: null, width_raw: null, width_relation: null, half_life: null };
  }

  // Detect time unit → it's a lifetime
  if (isLifetimeExplicit || /\b(fs|fsec|ps|ns|[μu]s|ms)\b/.test(cleaned)) {
    const lt = parseLifetime(cleaned);
    return { ...lt, width_raw: s, width_relation: lt.width_keV !== null ? '=' : null };
  }

  // Upper limit: < value or ≤ value
  const ltMatch = cleaned.match(/^([<≤])\s*([\d.]+)\s*(?:[×x]\s*10\s*[−\-]\s*(\d+))?\s*(\w+)?/);
  if (ltMatch) {
    const relation = ltMatch[1] === '≤' ? '≤' : '<';
    let val = parseFloat(ltMatch[2]!);
    if (ltMatch[3]) val *= Math.pow(10, -parseInt(ltMatch[3], 10));
    const unit = ltMatch[4] && ENERGY_UNITS[ltMatch[4]] ? ltMatch[4] : defaultUnit;
    const factor = ENERGY_UNITS[unit]!;
    return { width_keV: val * factor, width_unc_keV: null, width_raw: s, width_relation: relation, half_life: null };
  }

  // Detect leading ≈ or ~
  const isApprox = /^[≈~]/.test(cleaned);
  cleaned = cleaned.replace(/^[≈~]\s*/, '');

  // Scientific notation: (value ± unc) × 10−exp [unit]
  const sciMatch = cleaned.match(
    /\(?([\d.]+)\s*(?:±\s*([\d.]+))?\)?\s*[×x]\s*10\s*[−\-]\s*(\d+)\s*(\w+)?/
  );
  if (sciMatch) {
    const val = parseFloat(sciMatch[1]!);
    const unc = sciMatch[2] ? parseFloat(sciMatch[2]) : null;
    const exp = parseInt(sciMatch[3]!, 10);
    const unit = sciMatch[4] && ENERGY_UNITS[sciMatch[4]] ? sciMatch[4] : defaultUnit;
    const factor = ENERGY_UNITS[unit]!;
    const multiplier = Math.pow(10, -exp) * factor;
    return {
      width_keV: val * multiplier,
      width_unc_keV: unc !== null ? unc * multiplier : null,
      width_raw: s,
      width_relation: isApprox ? '≈' : '=',
      half_life: null,
    };
  }

  // Γcalc = value (calculated width, still in default unit)
  const calcMatch = cleaned.match(/Γcalc\s*=\s*([\d.]+)/);
  if (calcMatch) {
    const val = parseFloat(calcMatch[1]!);
    const factor = ENERGY_UNITS[defaultUnit]!;
    return { width_keV: val * factor, width_unc_keV: null, width_raw: s, width_relation: 'calc', half_life: null };
  }

  // Plain value ± unc with optional unit
  const valMatch = cleaned.match(
    /^([\d.]+)\s*(?:±\s*([\d.]+))?\s*(meV|eV|keV|MeV)?/
  );
  if (valMatch) {
    const val = parseFloat(valMatch[1]!);
    const unc = valMatch[2] ? parseFloat(valMatch[2]) : null;
    const unit = valMatch[3] && ENERGY_UNITS[valMatch[3]] ? valMatch[3] : defaultUnit;
    const factor = ENERGY_UNITS[unit]!;
    return {
      width_keV: val * factor,
      width_unc_keV: unc !== null ? unc * factor : null,
      width_raw: s,
      width_relation: isApprox ? '≈' : '=',
      half_life: null,
    };
  }

  return { width_keV: null, width_unc_keV: null, width_raw: s, width_relation: null, half_life: null };
}

function parseLifetime(s: string): Omit<WidthResult, 'width_raw' | 'width_relation'> {
  // Handle asymmetric uncertainties: "12+11\n-6 fs" → just take value
  const m = s.match(/([\d.]+)\s*(?:±\s*([\d.]+))?\s*(fs|fsec|ps|ns|[μu]s|ms|s)\b/);
  if (!m) return { width_keV: null, width_unc_keV: null, half_life: s };

  const val = parseFloat(m[1]!);
  const unc = m[2] ? parseFloat(m[2]) : null;
  const unitKey = m[3]!;
  const unitFactor = TIME_UNITS[unitKey] ?? TIME_UNITS[unitKey.replace('μ', 'u')];
  if (!unitFactor) return { width_keV: null, width_unc_keV: null, half_life: s };

  const tau_s = val * unitFactor;
  if (tau_s === 0) return { width_keV: null, width_unc_keV: null, half_life: s };
  const width_keV = HBAR_KEV_S / tau_s;

  let width_unc_keV: number | null = null;
  if (unc !== null) {
    const tau_unc_s = unc * unitFactor;
    width_unc_keV = width_keV * (tau_unc_s / tau_s);
  }

  return { width_keV, width_unc_keV, half_life: null };
}

// ── Energy parsing ────────────────────────────────────────────────────────────

interface EnergyResult {
  energy_keV: number;
  energy_unc_keV: number | null;
  energy_raw: string;
}

export function parseEnergy(raw: string): EnergyResult | null {
  let s = stripFootnotes(raw.trim()).replace(/[()]/g, '').trim();
  if (!s) return null;

  if (/^g\.?s\.?$/i.test(s) || s === '0') {
    return { energy_keV: 0, energy_unc_keV: null, energy_raw: raw.trim() };
  }

  // Remove leading ≈
  s = s.replace(/^[≈~]\s*/, '');

  const m = s.match(/^([\d.]+)\s*(?:±\s*([\d.]+))?/);
  if (!m) return null;

  const energy_MeV = parseFloat(m[1]!);
  const energy_keV = energy_MeV * 1000;
  // TUNL convention: "Ex (MeV ± keV)" → uncertainty is in keV
  const energy_unc_keV = m[2] ? parseFloat(m[2]) : null;

  return { energy_keV, energy_unc_keV, energy_raw: raw.trim() };
}

// ── Decay modes parsing ───────────────────────────────────────────────────────

function parseDecayModes(raw: string): string | null {
  if (!raw?.trim()) return null;
  const s = stripFootnotes(raw.trim());
  if (!s || s === '-' || s === '–') return null;
  if (/^stable$/i.test(s)) return 'stable';

  // Extract known decay tokens.
  // Greek letters (γ, α, π) are non-ASCII and \b doesn't work on them in non-Unicode mode.
  // Use a combined regex: no \b around Greek, \b around ASCII tokens.
  const tokens: string[] = [];
  const re = /(γ|α|π|\b3\s*He\b|\b6\s*Li\b|\b2α|\b2p\b|\b2n\b|\bp\b|\bn\b|\bd\b|\bt\b)/gi;
  let match;
  while ((match = re.exec(s)) !== null) {
    const tok = match[1]!.replace(/\s+/g, '');
    if (!tokens.includes(tok)) tokens.push(tok);
  }
  return tokens.length > 0 ? tokens.join(', ') : null;
}

// ── Data line extraction ──────────────────────────────────────────────────────

function extractDataLines(text: string): string[] {
  const lines = text.split('\n');
  const dataLines: string[] = [];
  let inFootnotes = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Form-feed characters
    if (trimmed === '\f' || trimmed.startsWith('\f')) {
      inFootnotes = false;
      continue;
    }

    // New table header resets footnote mode
    if (TABLE_HEADER_RE.test(trimmed)) { inFootnotes = false; continue; }
    if (/\(continued\)/i.test(trimmed)) continue;

    // Column headers
    if (/^Ex[\s(]/i.test(trimmed)) continue;
    if (/^\(MeV/i.test(trimmed)) continue;
    if (/^J\s*π/i.test(trimmed)) continue;

    // Footnotes: single lowercase letter followed by explanation text
    if (/^[a-z]\s{1,4}[A-Z]/.test(trimmed) ||
        /^[a-z]\s{1,4}(?:See|From|For|The|This|Γ|Newly|Situated|These|Primarily|With|Wide|Revisions|Mainly|Support|At|In|Possible|Adopted|Weighted|I\s)/i.test(trimmed)) {
      inFootnotes = true;
      continue;
    }
    if (inFootnotes) continue;

    // Isolated page numbers
    if (/^\d{1,2}$/.test(trimmed)) continue;

    // Reaction continuation lines: digits, commas, spaces, parens (must have at least one comma)
    if (/^[\d,\s()]+$/.test(trimmed) && trimmed.includes(',')) continue;

    // "used in analysis" column subheader
    if (/^\(used in analysis\)/i.test(trimmed)) continue;

    dataLines.push(line);
  }

  return dataLines;
}

// ── Column splitting ──────────────────────────────────────────────────────────

interface ColSegment {
  text: string;
  startCol: number;
}

/**
 * Split a line into columns by gaps of 3+ spaces.
 * Each "word" (contiguous non-space) is found, then adjacent words
 * separated by < 3 spaces are merged into the same column.
 */
function splitColumns(line: string): ColSegment[] {
  const segments: ColSegment[] = [];
  const re = /(\S+)/g;
  let m;
  let lastEnd = 0;

  while ((m = re.exec(line)) !== null) {
    const gap = m.index - lastEnd;
    if (segments.length === 0 || gap >= 3) {
      segments.push({ text: m[1]!, startCol: m.index });
    } else {
      const prev = segments[segments.length - 1]!;
      prev.text = line.substring(prev.startCol, m.index + m[1]!.length).trimEnd();
    }
    lastEnd = m.index + m[0]!.length;
  }

  return segments;
}

// ── Energy line detection (column-based) ─────────────────────────────────────

interface EnergyLineResult {
  energyStr: string;
  restCols: ColSegment[];
}

/**
 * Check if first column in line looks like an energy value:
 * g.s., 0, numeric values, with optional parens, ≈, uncertainty, footnote letters.
 */
function looksLikeEnergy(text: string): boolean {
  if (/^g\.?s\.?$/i.test(text)) return true;
  if (text === '0') return true;
  // Strip parens and leading ≈
  const cleaned = text.replace(/[()]/g, '').replace(/^[≈~]\s*/, '').trim();
  if (!cleaned) return false;
  if (!/^\d/.test(cleaned)) return false;
  // Numeric energy with optional uncertainty: "3.03 ± 10", "≈ 37", "18.91"
  if (/^\d[\d.]*\s*(?:±\s*[\d.]+)?$/.test(cleaned)) return true;
  return false;
}

function isEnergyLine(line: string): EnergyLineResult | null {
  const cols = splitColumns(line);
  if (cols.length === 0) return null;

  const first = cols[0]!;
  // Energy value must start within first 20 characters (rejects continuation lines)
  if (first.startCol > 20) return null;

  // Strip footnote markers from energy text
  const text = stripFootnotes(first.text).trim();
  if (!looksLikeEnergy(text)) return null;

  // Reject if next column starts with energy unit (this is a width value, not Ex)
  if (cols.length > 1 && /^(?:eV|keV|MeV|meV)\b/i.test(cols[1]!.text.trim())) return null;

  // Reject bare page/reaction numbers with no other content
  if (/^\d{1,2}$/.test(text) && cols.length <= 1) return null;

  return { energyStr: text, restCols: cols.slice(1) };
}

// ── Jπ above/below detection ──────────────────────────────────────────────────

/**
 * Check if line is a Jπ info line (typically above/below an energy line):
 * - Odd-A: "3−", "3− 1", "(3−)", with optional leading footnote markers
 * - Even-A parity: "+", "−"
 */
function isJpiInfoLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Must have significant leading whitespace (not a data entry)
  const leadingSpace = line.match(/^(\s*)/)?.[1]?.length ?? 0;
  if (leadingSpace < 5) return null;

  // Strip leading footnote markers: "b    1+" → "1+"
  let cleaned = trimmed.replace(/^[a-z]+[\s,]*/, '').trim();
  if (!cleaned) cleaned = trimmed;

  // Strip trailing footnote markers: "3− 1    a" → "3− 1"
  cleaned = cleaned.replace(/\s+[a-z]$/g, '').trim();

  // Parity-only: just "+" or "−"
  if (/^[+\-−]$/.test(cleaned)) return cleaned;
  // Jπ numerator for odd-A: "3−", "3− 1", "(3−)", "3+ 1", etc.
  if (/^\(?\s*\d+\s*[+\-−]\s*\)?\s*\d*\s*$/.test(cleaned)) return cleaned;
  // Multiple Jπ options: "5+ 7+", "5+, 4−, 6−, 7+"
  if (/^\(?\s*\d+\s*[+\-−][\s,\d+\-−]*\)?\s*$/.test(cleaned)) return cleaned;
  // "T = 3/2" style on its own line
  if (/^T\s*=/.test(cleaned)) return cleaned;

  return null;
}

/**
 * Check if a line is a parity-only line (just "+" or "−" with leading whitespace).
 */
function isParityOnlyLine(line: string): string | null {
  const trimmed = line.trim();
  if (/^[+\-−]$/.test(trimmed)) {
    const leadingSpace = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (leadingSpace >= 5) return trimmed;
  }
  return null;
}

// ── Jπ and T parsing from column content ──────────────────────────────────────

interface JpiTResult {
  spin_parity: string | null;
  isospin: string | null;
}

/**
 * Expand pdftotext concatenated fractions for odd-A half-integer values.
 * In PDF, stacked fractions like 3/2 are rendered as "32" or "23" by pdftotext.
 * Only expands 2-digit numbers where one digit is 2 and the other is odd.
 */
function expandConcatFraction(s: string): string {
  return s.replace(/(?<![/\d])(\d)(\d)(?![/\d])/g, (match, d1: string, d2: string) => {
    const n1 = parseInt(d1, 10);
    const n2 = parseInt(d2, 10);
    // numerator/2 pattern: e.g., "32" → "3/2"
    if (n2 === 2 && n1 % 2 === 1) return `${n1}/2`;
    // reversed pattern: e.g., "23" → "3/2"
    if (n1 === 2 && n2 % 2 === 1) return `${n2}/2`;
    return match;
  });
}

function parseJpiT(raw: string, jpiAbove: string | null, isOddA: boolean): JpiTResult {
  const s = stripFootnotes(raw.trim()).replace(/−/g, '-');

  // Check if jpiAbove is parity-only ("+", "−", "-")
  const aboveTrimmed = jpiAbove?.trim().replace(/−/g, '-') ?? null;
  const isParityOnlyAbove = aboveTrimmed !== null && /^[+\-]$/.test(aboveTrimmed);

  // Odd-A with proper Jπ numerator above (not parity-only)
  if (isOddA && jpiAbove && !isParityOnlyAbove) {
    const above = aboveTrimmed!;

    // Parse above: "3-", "3- 1", "3+", "(3-)", "( 3- )", "1- 1"
    const aboveMatch = above.match(/\(?\s*(\d+)\s*([+\-])?\s*\)?\s*(?:(\d+))?/);
    if (!aboveMatch) return { spin_parity: null, isospin: null };

    const jNum = aboveMatch[1]!;
    const parity = aboveMatch[2] || '';
    const tNum = aboveMatch[3] ?? null;

    // Parse current line: "2", "2 ; 2", "2 ;2", "; 2"
    const denomMatch = s.match(/^;?\s*(\d+)(?:\s*;?\s*(\d+))?/);
    const jDenom = denomMatch?.[1] ?? '2';

    const jp = jDenom === '1'
      ? `${jNum}${parity}`
      : `${jNum}/${jDenom}${parity}`;

    // T: look for T denominator
    let isospin: string | null = null;
    if (tNum) {
      const tDenomMatch = s.match(/;\s*(\d+)/);
      if (tDenomMatch) {
        isospin = tDenomMatch[1] === '1' ? tNum : `${tNum}/${tDenomMatch[1]}`;
      }
    }

    return { spin_parity: jp, isospin };
  }

  // Even-A, inline format, or odd-A with parity-only/no above line
  // Extract T (after semicolon)
  let isospin: string | null = null;
  const tMatch = s.match(/;\s*T?\s*=?\s*([\d(/)+\-\s]+?)(?:\s{2,}|$)/);
  if (tMatch) {
    let tVal = tMatch[1]!.trim().replace(/\s+/g, '');
    // Remove trailing footnote markers from T
    tVal = tVal.replace(/[a-z]$/, '');
    if (isOddA) tVal = expandConcatFraction(tVal);
    isospin = tVal || null;
  }
  // Also check for standalone "T = N" patterns
  const tStandalone = s.match(/T\s*=\s*(\d+(?:\/\d+)?)/);
  if (tStandalone && !isospin) {
    isospin = tStandalone[1]!;
  }

  // Extract Jπ (before semicolon if present)
  const jpiPart = s.split(';')[0]!.trim();
  if (!jpiPart) return { spin_parity: null, isospin };

  // If jpiPart is just a T assignment (e.g., "T = 1", "(T = 3/2)"), Jπ is unknown
  if (/^\(?T\s*=/i.test(jpiPart)) return { spin_parity: null, isospin };

  let jp = jpiPart;
  // Remove outer parens for simple cases
  if (jp.startsWith('(') && jp.endsWith(')') && !jp.includes(',')) {
    jp = jp.slice(1, -1).trim();
  }

  // For odd-A inline: expand pdftotext concatenated fractions
  // e.g., "(32)-" → "(3/2)-", "52" → "5/2"
  if (isOddA) {
    jp = expandConcatFraction(jp);
  }

  // Apply parity from above line (even-A parity-separate or odd-A parity-only)
  if (aboveTrimmed && /^[+\-]$/.test(aboveTrimmed) && !/[+\-]/.test(jp)) {
    jp = jp.replace(/\s+/g, '') + aboveTrimmed;
  } else if (jpiAbove && !isOddA) {
    const parityAbove = aboveTrimmed!;
    if (/^[+\-]$/.test(parityAbove) && !/[+\-]/.test(jp)) {
      jp = jp.replace(/\s+/g, '') + parityAbove;
    }
  }

  return { spin_parity: jp.replace(/\s+/g, '') || null, isospin };
}

// ── Column content classification ─────────────────────────────────────────────

function looksLikeJpi(s: string): boolean {
  const t = s.trim().replace(/−/g, '-');
  if (!t) return false;
  // Contains parity symbols (+/-)
  if (/[+\-]/.test(t) && !/±/.test(t)) return true;
  // Contains semicolon (Jπ;T separator)
  if (t.includes(';')) return true;
  // "T = N" style or "(T = N)"
  if (/^\(?T\s*=/i.test(t)) return true;
  // Small integer 0-9 for spin (like "2" for J denominator)
  if (/^\(?\d{1,2}\)?$/.test(t)) return true;
  // Multi-option: "(5+, 4-, 6-, 7+)"
  if (/\([^)]*[+\-][^)]*\)/.test(t)) return true;
  // Contains ≥ (like "≥ 3/2") — Jπ constraint
  if (/≥\s*\d/.test(t)) return true;
  return false;
}

function looksLikeDecay(s: string): boolean {
  const t = s.trim();
  if (/^stable$/i.test(t)) return true;
  // Contains known decay particle symbols and mostly those + commas/parens/spaces
  if (/[γα]/.test(t)) return true;
  // "p, n", "n, α", "p", "γ, p, α" etc — short strings of decay tokens
  if (/^[\s,()]*(?:p|n|d|t|π|3\s*He|2[αpn]|6\s*Li)[\s,()pndtγα3He2]*$/i.test(t) && t.length < 40) return true;
  return false;
}

function looksLikeWidth(s: string): boolean {
  const t = s.trim();
  if (t === '-' || t === '–') return true;
  if (/^stable$/i.test(t)) return true;
  if (/^broad$/i.test(t)) return true;
  if (/(?:eV|keV|MeV|meV|fs|fsec|ps|ns)\b/i.test(t)) return true;
  if (/^[<≤≈~]/.test(t)) return true;
  if (/^(?:Γ|τ)/i.test(t)) return true;
  if (/^\|g\|/.test(t)) return true;
  // Numeric value with optional ± (could be width in default units)
  if (/^\d[\d.]*\s*(?:±\s*[\d.]+)?$/.test(stripFootnotes(t))) return true;
  // Scientific notation
  if (/×\s*10/.test(t)) return true;
  return false;
}

function looksLikeReactions(s: string): boolean {
  // Comma-separated numbers, possibly with parens
  return /^[\d,\s()]+$/.test(s.trim()) && /\d/.test(s);
}

// ── Unified parser ────────────────────────────────────────────────────────────

function parseEntries(dataLines: string[], meta: TableMeta): TunlLevelRow[] {
  const rows: TunlLevelRow[] = [];
  const isOddA = meta.A % 2 === 1;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i]!;
    const energyResult = isEnergyLine(line);
    if (!energyResult) continue;

    const energy = parseEnergy(energyResult.energyStr);
    if (!energy) continue;

    // Check line above for Jπ info
    let jpiAbove: string | null = null;
    if (i > 0) {
      jpiAbove = isJpiInfoLine(dataLines[i - 1]!);
    }

    // Assign columns from the energy line
    const restCols = energyResult.restCols;
    let jpiCol = '';
    let widthCol = '';
    let decayCol = '';

    // Classify remaining columns by content
    assignColumns(restCols, (j, w, d) => { jpiCol = j; widthCol = w; decayCol = d; });

    // For even-A: check for "parity below" pattern
    // If Jπ has no parity character, look at next data line for parity
    if (!isOddA && jpiCol && !/[+\-−]/.test(jpiCol)) {
      if (i + 1 < dataLines.length) {
        const parity = isParityOnlyLine(dataLines[i + 1]!);
        if (parity) {
          jpiAbove = parity; // pass as "above" — parseJpiT treats it the same
          // If we had no width/decay on the energy line, look 2 lines ahead
          if (!widthCol && !decayCol && i + 2 < dataLines.length) {
            const belowLine = dataLines[i + 2]!;
            if (!isEnergyLine(belowLine) && !isJpiInfoLine(belowLine)) {
              const belowCols = splitColumns(belowLine);
              // These are width + decay columns
              for (const col of belowCols) {
                const t = col.text.trim();
                if (looksLikeReactions(t)) continue;
                if (!widthCol && looksLikeWidth(t)) { widthCol = t; continue; }
                if (!decayCol && looksLikeDecay(t)) { decayCol = t; continue; }
                if (!widthCol) { widthCol = t; continue; }
                if (!decayCol) { decayCol = t; }
              }
            }
          }
        }
      }
    }

    // For odd-A: check next line for ";T_denom + width + decay"
    if (isOddA && i + 1 < dataLines.length) {
      const nextLine = dataLines[i + 1]!;
      if (!isJpiInfoLine(nextLine) && !isEnergyLine(nextLine)) {
        const nextCols = splitColumns(nextLine);
        let startIdx = 0;

        // Check if first column is ";T_denom"
        if (nextCols.length > 0 && /^;\s*\d+/.test(nextCols[0]!.text)) {
          jpiCol = jpiCol + ' ' + nextCols[0]!.text;
          startIdx = 1;
        }

        // Fill in missing width/decay from next line
        for (let ci = startIdx; ci < nextCols.length; ci++) {
          const t = nextCols[ci]!.text.trim();
          if (looksLikeReactions(t)) continue;
          if (!widthCol && looksLikeWidth(t)) { widthCol = t; continue; }
          if (!decayCol && looksLikeDecay(t)) { decayCol = t; continue; }
          if (!widthCol) { widthCol = t; continue; }
          if (!decayCol) { decayCol = t; }
        }
      }
    }

    // For even-A with no width/decay on energy line and no parity-below,
    // still check next line for width/decay
    if (!isOddA && !widthCol && !decayCol && i + 1 < dataLines.length) {
      const nextLine = dataLines[i + 1]!;
      if (!isEnergyLine(nextLine) && !isJpiInfoLine(nextLine) && !isParityOnlyLine(nextLine)) {
        // Check if it could be a width/decay continuation
        const leadSpace = nextLine.match(/^(\s*)/)?.[1]?.length ?? 0;
        if (leadSpace >= 25) {
          const nextCols = splitColumns(nextLine);
          for (const col of nextCols) {
            const t = col.text.trim();
            if (looksLikeReactions(t)) continue;
            if (!widthCol && looksLikeWidth(t)) { widthCol = t; continue; }
            if (!decayCol && looksLikeDecay(t)) { decayCol = t; continue; }
            if (!widthCol) { widthCol = t; continue; }
            if (!decayCol) { decayCol = t; }
          }
        }
      }
    }

    // Parse Jπ;T
    const jpiT = parseJpiT(jpiCol, jpiAbove, isOddA);

    // Parse width
    const width = parseWidth(widthCol, meta.defaultWidthUnit);

    // Parse decay modes
    let halfLife = width.half_life;
    let decayModes = parseDecayModes(decayCol);

    if (/stable/i.test(decayCol)) halfLife = 'stable';
    if (width.half_life === 'stable' && !decayModes) decayModes = 'stable';
    // Check if width column had "stable" text (as in "stable" being in the Γ column)
    if (/stable/i.test(widthCol) && !decayModes) decayModes = 'stable';

    rows.push({
      Z: meta.Z,
      A: meta.A,
      element: meta.element,
      energy_keV: energy.energy_keV,
      energy_unc_keV: energy.energy_unc_keV,
      energy_raw: energy.energy_raw,
      spin_parity: jpiT.spin_parity,
      isospin: jpiT.isospin,
      width_keV: width.width_keV,
      width_unc_keV: width.width_unc_keV,
      width_raw: width.width_raw,
      width_relation: width.width_relation,
      half_life: halfLife,
      decay_modes: decayModes,
      evaluation: meta.evaluation,
      table_label: meta.sourceTable,
    });
  }

  return rows;
}

/**
 * Assign restCols to jpi, width, decay slots using content classification.
 * Columns appear in order: Jπ;T, Γ, Decay, Reactions.
 * Some may be absent, causing later columns to shift left.
 * The first column is Jπ;T ONLY if it looks like a Jπ value.
 */
function assignColumns(
  cols: ColSegment[],
  assign: (jpi: string, width: string, decay: string) => void,
): void {
  let jpi = '';
  let width = '';
  let decay = '';

  if (cols.length === 0) {
    assign('', '', '');
    return;
  }

  let startIdx = 0;
  const firstText = cols[0]!.text.trim();

  // First column is Jπ;T only if it actually looks like one
  if (looksLikeJpi(firstText)) {
    jpi = cols[0]!.text;
    startIdx = 1;
  }

  // Process remaining columns
  for (let i = startIdx; i < cols.length; i++) {
    const text = cols[i]!.text.trim();
    if (looksLikeReactions(text)) break; // everything after is reactions
    if (!width && (looksLikeWidth(text) || (!jpi && !looksLikeDecay(text)))) {
      width = text;
      continue;
    }
    if (!decay && looksLikeDecay(text)) { decay = text; continue; }
    // Ambiguous — assign to first empty slot
    if (!width) { width = text; continue; }
    if (!decay) { decay = text; continue; }
  }

  assign(jpi, width, decay);
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function parseTunlLevels(text: string): TunlLevelRow[] {
  const meta = parseTableHeader(text);
  if (!meta) {
    console.error('TUNL: could not parse table header');
    return [];
  }

  const dataLines = extractDataLines(text);
  if (dataLines.length === 0) return [];

  return parseEntries(dataLines, meta);
}

export function parseTunlLevelsWithMeta(
  text: string,
  Z: number,
  A: number,
  element: string,
  evaluation: string,
  sourceTable: string,
): TunlLevelRow[] {
  const meta: TableMeta = {
    sourceTable,
    evaluation,
    A,
    element,
    Z,
    defaultWidthUnit: detectWidthUnit(text),
  };

  const dataLines = extractDataLines(text);
  if (dataLines.length === 0) return [];

  return parseEntries(dataLines, meta);
}
