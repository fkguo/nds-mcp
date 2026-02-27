/**
 * AME2020 mass_1.mas20 parser.
 *
 * Fixed-width ASCII format.
 * Header: 36 lines (including ruler + column header).
 * Data starts at line 37.
 *
 * Fortran format:
 *   a1,i3,i5,i5,i5,1x,a3,a4,1x,f14.6,f12.6,f13.5,1x,f10.5,1x,a2,f13.5,f11.5,1x,i3,1x,f13.6,f12.6
 *
 * # in place of decimal point → estimated value (is_estimated = 1).
 * * in place of value → not calculable (NULL).
 */

export interface AmeMassRow {
  Z: number;
  A: number;
  N: number;
  element: string;
  mass_excess_keV: number | null;
  mass_excess_unc_keV: number | null;
  binding_energy_per_A_keV: number | null;
  binding_energy_per_A_unc_keV: number | null;
  beta_decay_energy_keV: number | null;
  beta_decay_energy_unc_keV: number | null;
  atomic_mass_micro_u: number | null;
  atomic_mass_unc_micro_u: number | null;
  is_estimated: boolean;
}

const AME_MASS_HEADER_LINES = 36;

function parseAmeValue(raw: string): { value: number | null; estimated: boolean } {
  const s = raw.trim();
  if (s === '' || s === '*' || s.includes('*')) {
    return { value: null, estimated: false };
  }
  const estimated = s.includes('#');
  const cleaned = s.replace(/#/g, '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return { value: null, estimated };
  }
  return { value: n, estimated };
}

export function parseAmeMasses(content: string): AmeMassRow[] {
  const lines = content.split('\n');
  const rows: AmeMassRow[] = [];

  for (let i = AME_MASS_HEADER_LINES; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;

    // Fixed-width column extraction (1-indexed positions from Fortran format)
    // col 1: cc (a1)
    // col 2-4: N-Z (i3)
    // col 5-9: N (i5)
    // col 10-14: Z (i5)
    // col 15-19: A (i5)
    // col 20: space
    // col 21-23: element (a3)
    // col 24-27: origin (a4)
    // col 28: space
    // col 29-42: mass excess (f14.6)
    // col 43-54: mass excess unc (f12.6)
    // col 55-67: binding energy/A (f13.5)
    // col 68: space
    // col 69-78: binding energy/A unc (f10.5)
    // col 79: space
    // col 80-81: B- flag (a2)
    // col 82-94: beta-decay energy (f13.5)
    // col 95-105: beta-decay energy unc (f11.5)
    // col 106: space
    // col 107-109: atomic mass int (i3)
    // col 110: space
    // col 111-123: atomic mass frac (f13.6)
    // col 124-135: atomic mass unc (f12.6)

    const N = parseInt(line.substring(4, 9).trim(), 10);
    const Z = parseInt(line.substring(9, 14).trim(), 10);
    const A = parseInt(line.substring(14, 19).trim(), 10);
    const element = line.substring(20, 23).trim();

    if (isNaN(Z) || isNaN(A) || isNaN(N)) continue;

    const massExcess = parseAmeValue(line.substring(28, 42));
    const massExcessUnc = parseAmeValue(line.substring(42, 54));
    const bePerA = parseAmeValue(line.substring(54, 67));
    const bePerAUnc = parseAmeValue(line.substring(68, 78));
    const betaDecay = parseAmeValue(line.substring(81, 94));
    const betaDecayUnc = parseAmeValue(line.substring(94, 105));

    // Atomic mass: integer part (col 107-109) + fractional part (col 111-123)
    const atomicMassIntStr = line.substring(106, 109).trim();
    const atomicMassFrac = parseAmeValue(line.substring(110, 123));
    const atomicMassUnc = parseAmeValue(line.substring(123, 135));

    let atomicMassMicroU: number | null = null;
    if (atomicMassIntStr && atomicMassFrac.value !== null) {
      const intPart = parseInt(atomicMassIntStr, 10);
      if (!isNaN(intPart)) {
        atomicMassMicroU = intPart * 1_000_000 + atomicMassFrac.value;
      }
    }

    const isEstimated = massExcess.estimated || massExcessUnc.estimated ||
      bePerA.estimated || bePerAUnc.estimated ||
      betaDecay.estimated || betaDecayUnc.estimated ||
      atomicMassFrac.estimated || atomicMassUnc.estimated;

    rows.push({
      Z,
      A,
      N,
      element,
      mass_excess_keV: massExcess.value,
      mass_excess_unc_keV: massExcessUnc.value,
      binding_energy_per_A_keV: bePerA.value,
      binding_energy_per_A_unc_keV: bePerAUnc.value,
      beta_decay_energy_keV: betaDecay.value,
      beta_decay_energy_unc_keV: betaDecayUnc.value,
      atomic_mass_micro_u: atomicMassMicroU,
      atomic_mass_unc_micro_u: atomicMassUnc.value,
      is_estimated: isEstimated,
    });
  }

  return rows;
}

/**
 * AME2020 rct1.mas20 parser — S(2n), S(2p), Q(α), Q(2β⁻), Q(εp), Q(β⁻n)
 *
 * Fortran format: a1,i3,1x,a3,i3,1x,6(f12.4,f10.4)
 *
 * Header: 35 lines.
 */

export interface AmeRct1Row {
  Z: number;
  A: number;
  element: string;
  S2n_keV: number | null; S2n_unc_keV: number | null;
  S2p_keV: number | null; S2p_unc_keV: number | null;
  Qa_keV: number | null; Qa_unc_keV: number | null;
  Q2bm_keV: number | null; Q2bm_unc_keV: number | null;
  Qep_keV: number | null; Qep_unc_keV: number | null;
  Qbn_keV: number | null; Qbn_unc_keV: number | null;
}

const RCT_HEADER_LINES = 35;

function parseRctLine(line: string): { A: number; element: string; Z: number; values: Array<{ val: number | null; unc: number | null }> } | null {
  if (line.trim().length === 0) return null;

  const A = parseInt(line.substring(1, 4).trim(), 10);
  const element = line.substring(5, 8).trim();
  const Z = parseInt(line.substring(8, 11).trim(), 10);

  if (isNaN(A) || isNaN(Z) || !element) return null;

  const values: Array<{ val: number | null; unc: number | null }> = [];
  // 6 pairs of (f12.4, f10.4) starting at col 13 (1-indexed) = 0-indexed 12
  let offset = 12;
  for (let j = 0; j < 6; j++) {
    const valStr = line.substring(offset, offset + 12);
    const uncStr = line.substring(offset + 12, offset + 22);
    const v = parseAmeValue(valStr);
    const u = parseAmeValue(uncStr);
    values.push({ val: v.value, unc: u.value });
    offset += 22;
  }

  return { A, element, Z, values };
}

export function parseAmeRct1(content: string): AmeRct1Row[] {
  const lines = content.split('\n');
  const rows: AmeRct1Row[] = [];

  for (let i = RCT_HEADER_LINES; i < lines.length; i++) {
    const parsed = parseRctLine(lines[i]!);
    if (!parsed) continue;

    rows.push({
      Z: parsed.Z,
      A: parsed.A,
      element: parsed.element,
      S2n_keV: parsed.values[0]!.val, S2n_unc_keV: parsed.values[0]!.unc,
      S2p_keV: parsed.values[1]!.val, S2p_unc_keV: parsed.values[1]!.unc,
      Qa_keV: parsed.values[2]!.val, Qa_unc_keV: parsed.values[2]!.unc,
      Q2bm_keV: parsed.values[3]!.val, Q2bm_unc_keV: parsed.values[3]!.unc,
      Qep_keV: parsed.values[4]!.val, Qep_unc_keV: parsed.values[4]!.unc,
      Qbn_keV: parsed.values[5]!.val, Qbn_unc_keV: parsed.values[5]!.unc,
    });
  }

  return rows;
}

/**
 * AME2020 rct2_1.mas20 parser — S(n), S(p), Q(4β⁻), Q(d,α), Q(p,α), Q(n,α)
 *
 * Same Fortran format as rct1.
 * Header varies slightly; we scan for the ruler line.
 */

export interface AmeRct2Row {
  Z: number;
  A: number;
  element: string;
  Sn_keV: number | null; Sn_unc_keV: number | null;
  Sp_keV: number | null; Sp_unc_keV: number | null;
  Q4bm_keV: number | null; Q4bm_unc_keV: number | null;
  Qda_keV: number | null; Qda_unc_keV: number | null;
  Qpa_keV: number | null; Qpa_unc_keV: number | null;
  Qna_keV: number | null; Qna_unc_keV: number | null;
}

function findRctDataStart(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (lines[i]!.startsWith('....+')) return i + 1;
  }
  return RCT_HEADER_LINES;
}

export function parseAmeRct2(content: string): AmeRct2Row[] {
  const lines = content.split('\n');
  const dataStart = findRctDataStart(lines);
  const rows: AmeRct2Row[] = [];

  // Skip column header lines after ruler (typically 4-5 lines)
  let start = dataStart;
  for (let i = dataStart; i < Math.min(lines.length, dataStart + 10); i++) {
    const line = lines[i]!;
    // Data lines have A in col 2-4; header lines have text like "1 A  elt  Z"
    if (line.length > 11 && !isNaN(parseInt(line.substring(8, 11).trim(), 10))) {
      start = i;
      break;
    }
  }

  for (let i = start; i < lines.length; i++) {
    const parsed = parseRctLine(lines[i]!);
    if (!parsed) continue;

    rows.push({
      Z: parsed.Z,
      A: parsed.A,
      element: parsed.element,
      Sn_keV: parsed.values[0]!.val, Sn_unc_keV: parsed.values[0]!.unc,
      Sp_keV: parsed.values[1]!.val, Sp_unc_keV: parsed.values[1]!.unc,
      Q4bm_keV: parsed.values[2]!.val, Q4bm_unc_keV: parsed.values[2]!.unc,
      Qda_keV: parsed.values[3]!.val, Qda_unc_keV: parsed.values[3]!.unc,
      Qpa_keV: parsed.values[4]!.val, Qpa_unc_keV: parsed.values[4]!.unc,
      Qna_keV: parsed.values[5]!.val, Qna_unc_keV: parsed.values[5]!.unc,
    });
  }

  return rows;
}
