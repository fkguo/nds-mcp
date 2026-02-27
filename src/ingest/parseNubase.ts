/**
 * NUBASE2020 parser (nubase_4.mas20).
 *
 * Format documented in file header:
 *   col 1-3:   AAA (mass number)
 *   col 5-8:   ZZZi (atomic number + isomer index)
 *   col 12-16: A El
 *   col 17:    s (isomer flag: m,n = isomer; p,q = level; etc.)
 *   col 19-31: Mass Excess (f13.6), # = estimated
 *   col 32-42: dMass (f11.6)
 *   col 43-54: Excitation energy (f12.6)
 *   col 55-65: dE (f11.6)
 *   col 66-67: Origin (a2)
 *   col 70-78: Half-life (f9.4)
 *   col 79-80: unit (a2)
 *   col 82-88: dT (a7)
 *   col 89-102: Jpi (a14)
 *   col 103-104: ENSDF year (a2)
 *   col 115-118: Discovery year (a4)
 *   col 120-209: Decay modes (a90)
 *
 * Lines starting with '#' are comments/header.
 */

export interface NubaseRow {
  Z: number;
  A: number;
  element: string;
  isomer_index: number;
  mass_excess_keV: number | null;
  mass_excess_unc_keV: number | null;
  excitation_energy_keV: number | null;
  half_life: string;
  half_life_seconds: number | null;
  half_life_unc_seconds: number | null;
  spin_parity: string;
  decay_modes: string;
  is_estimated: boolean;
}

const HALF_LIFE_UNIT_TO_SECONDS: Record<string, number> = {
  'ys': 1e-24,
  'zs': 1e-21,
  'as': 1e-18,
  'fs': 1e-15,
  'ps': 1e-12,
  'ns': 1e-9,
  'us': 1e-6,
  'ms': 1e-3,
  's':  1,
  'm':  60,
  'h':  3600,
  'd':  86400,
  'y':  365.25 * 86400,
  'ky': 365.25 * 86400 * 1e3,
  'My': 365.25 * 86400 * 1e6,
  'Gy': 365.25 * 86400 * 1e9,
  'Ty': 365.25 * 86400 * 1e12,
  'Py': 365.25 * 86400 * 1e15,
  'Ey': 365.25 * 86400 * 1e18,
  'Zy': 365.25 * 86400 * 1e21,
  'Yy': 365.25 * 86400 * 1e24,
};

function parseNubaseValue(raw: string): { value: number | null; estimated: boolean } {
  const s = raw.trim();
  if (s === '' || s === '*') return { value: null, estimated: false };
  const estimated = s.includes('#');
  const cleaned = s.replace(/#/g, '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, estimated };
  return { value: n, estimated };
}

function parseHalfLife(rawValue: string, rawUnit: string, rawUnc: string): {
  display: string;
  seconds: number | null;
  unc_seconds: number | null;
} {
  const val = rawValue.trim();
  const unit = rawUnit.trim();
  const unc = rawUnc.trim();

  if (val === 'stbl' || val === 'stabl') {
    return { display: 'stable', seconds: null, unc_seconds: null };
  }

  if (val === '' || val === '*') {
    return { display: val || 'unknown', seconds: null, unc_seconds: null };
  }

  if (val.includes('p-unst')) {
    return { display: 'p-unst', seconds: null, unc_seconds: null };
  }

  const display = unit ? `${val} ${unit}`.trim() : val;

  const cleanedVal = val.replace(/#/g, '.');
  const numVal = Number(cleanedVal);

  if (!Number.isFinite(numVal) || !unit) {
    return { display, seconds: null, unc_seconds: null };
  }

  const factor = HALF_LIFE_UNIT_TO_SECONDS[unit];
  if (factor === undefined) {
    return { display, seconds: null, unc_seconds: null };
  }

  const seconds = numVal * factor;

  let unc_seconds: number | null = null;
  if (unc) {
    const cleanedUnc = unc.replace(/#/g, '.');
    const numUnc = Number(cleanedUnc);
    if (Number.isFinite(numUnc)) {
      unc_seconds = numUnc * factor;
    }
  }

  return { display, seconds, unc_seconds };
}

export function parseNubase(content: string): NubaseRow[] {
  const lines = content.split('\n');
  const rows: NubaseRow[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim().length === 0) continue;

    // Ensure minimum length for core fields
    if (line.length < 18) continue;

    const A = parseInt(line.substring(0, 3).trim(), 10);
    if (isNaN(A)) continue;

    // Extract Z and isomer_index from fixed positions (cols 5-8 = ZZZi)
    const rawZzzi = line.substring(4, 8);
    const zStr = rawZzzi.substring(0, 3).trim();
    const iStr = rawZzzi.substring(3, 4).trim();
    const Z = parseInt(zStr, 10);
    const isomer_index = iStr ? parseInt(iStr, 10) : 0;

    if (isNaN(Z) || isNaN(isomer_index)) continue;

    const element = line.substring(11, 16).trim().replace(/^\d+/, '').trim();
    if (!element) continue;

    const massExcess = parseNubaseValue(line.substring(18, 31));
    const massExcessUnc = parseNubaseValue(line.substring(31, 42));
    const excEnergy = parseNubaseValue(line.substring(42, 54));

    // Half-life (substring is safe beyond string length — returns available chars)
    const hlValue = line.substring(69, 78);
    const hlUnit = line.substring(78, 80);
    const hlUnc = line.substring(81, 88);
    const hl = parseHalfLife(hlValue, hlUnit, hlUnc);

    // Spin-parity
    const spinParity = line.substring(88, 102).trim();

    // Decay modes
    const decayModes = line.substring(119).trim();

    rows.push({
      Z,
      A,
      element,
      isomer_index,
      mass_excess_keV: massExcess.value,
      mass_excess_unc_keV: massExcessUnc.value,
      excitation_energy_keV: excEnergy.value,
      half_life: hl.display,
      half_life_seconds: hl.seconds,
      half_life_unc_seconds: hl.unc_seconds,
      spin_parity: spinParity,
      decay_modes: decayModes,
      is_estimated: massExcess.estimated || massExcessUnc.estimated || excEnergy.estimated,
    });
  }

  return rows;
}
