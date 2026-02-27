/**
 * Parser for Li et al., ADNDT 140 (2021) 101440 — laser spectroscopy charge radii.
 *
 * Parses the LaTeX longtable from Radii.tex (lines ~399-685) containing 257 data rows
 * for 21 elements (Z=4 to Z=88).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface LaserRadiusRow {
  Z: number;
  A: number;
  N: number;
  element: string;
  delta_r2_fm2: number;            // δ⟨r²⟩ relative to reference isotope (fm²)
  delta_r2_unc_fm2: number | null; // NULL for reference isotopes (shown as -- in LaTeX)
  r_charge_fm: number;             // Absolute rms charge radius r_c (fm)
  r_charge_unc_fm: number;
  is_reference: boolean;           // Bold rows = reference isotope (δ⟨r²⟩ = 0)
  in_angeli_2013: boolean;         // "Yes"/"No" column — was this in Angeli & Marinova 2013?
}

export interface LaserRadiusRef {
  Z: number;
  A: number;
  citekey: string;
  reference: string;  // Full bibliographic reference string
}

export interface LaserRadiiParseResult {
  rows: LaserRadiusRow[];
  refs: LaserRadiusRef[];
  refIsotopes: Map<number, number>; // Z → reference A
}

// ── Reference isotope map (Z → A_ref) ───────────────────────────────────────

export const REFERENCE_ISOTOPES: ReadonlyMap<number, number> = new Map([
  [4, 9],    // Be-9
  [12, 26],  // Mg-26
  [19, 39],  // K-39
  [20, 40],  // Ca-40
  [25, 55],  // Mn-55
  [26, 54],  // Fe-54
  [28, 60],  // Ni-60
  [29, 65],  // Cu-65
  [30, 68],  // Zn-68
  [31, 71],  // Ga-71
  [37, 87],  // Rb-87
  [47, 109], // Ag-109
  [48, 114], // Cd-114
  [50, 124], // Sn-124
  [70, 176], // Yb-176
  [80, 198], // Hg-198
  [81, 205], // Tl-205
  [83, 209], // Bi-209
  [84, 210], // Po-210
  [87, 221], // Fr-221
  [88, 214], // Ra-214
]);

// ── Footnote → citation mapping (from LaTeX footnotes, lines 340-360) ───────

interface FootnoteCitation {
  Z: number;
  citekeys: string[];
}

const FOOTNOTE_CITATIONS: FootnoteCitation[] = [
  { Z: 4,  citekeys: ['c4Be'] },
  { Z: 12, citekeys: ['c12Mg'] },
  { Z: 19, citekeys: ['c19K'] },
  { Z: 20, citekeys: ['c20Ca1', 'c20Ca2'] },
  { Z: 25, citekeys: ['c25Mn'] },
  { Z: 26, citekeys: ['c26Fe'] },
  { Z: 28, citekeys: ['c28Ni'] },
  { Z: 29, citekeys: ['c29Cu1', 'c29Cu2'] },
  { Z: 30, citekeys: ['c30Zn'] },
  { Z: 31, citekeys: ['c31Ga1', 'c31Ga2'] },
  { Z: 37, citekeys: ['c37Rb1', 'c37Rb2'] },
  { Z: 47, citekeys: ['c47Ag'] },
  { Z: 48, citekeys: ['c48Cd'] },
  { Z: 50, citekeys: ['c50Sn'] },
  { Z: 70, citekeys: ['c70Yb'] },
  { Z: 80, citekeys: ['c80Hg'] },
  { Z: 81, citekeys: ['c81Tl1', 'c81Tl2'] },
  { Z: 83, citekeys: ['c83Bi'] },
  { Z: 84, citekeys: ['c84Po1', 'c84Po2'] },
  { Z: 87, citekeys: ['c87Fr'] },
  { Z: 88, citekeys: ['c88Ra'] },
];

// Build Z → citekeys lookup
const Z_TO_CITEKEYS = new Map<number, string[]>();
for (const fc of FOOTNOTE_CITATIONS) {
  Z_TO_CITEKEYS.set(fc.Z, fc.citekeys);
}

// ── Bibliography (from LaTeX \bibitem entries, lines 267-320) ───────────────

export const LASER_RADII_BIBLIOGRAPHY: ReadonlyMap<string, string> = new Map([
  ['c4Be',    'A. Krieger, K. Blaum, M. L. Bissell, et al., Phys. Rev. Lett. 108 (2012) 142501.'],
  ['c12Mg',   'D. T. Yordanov, M. L. Bissell, K. Blaum, et al., Phys. Rev. Lett. 108 (2012) 042504.'],
  ['c19K',    'D. M. Rossi, K. Minamisono, H. B. Asberry, et al., Phys. Rev. C 92 (2015) 014305.'],
  ['c20Ca1',  'A. J. Miller, K. Minamisono, A. Klose, et al., Nat. Phys. 15 (2019) 432.'],
  ['c20Ca2',  'R. F. Garcia Ruiz, M. L. Bissell, K. Blaum, et al., Nat. Phys. 12 (2016) 594.'],
  ['c25Mn',   'H. Heylen, C. Babcock, R. Beerwerth, et al., Phys. Rev. C 94 (2016) 054321.'],
  ['c26Fe',   'K. Minamisono, D. M. Rossi, R. Beerwerth, et al., Phys. Rev. Lett. 117 (2016) 252501.'],
  ['c28Ni',   'S. Kaufmann, J. Simonis, S. Bacca, et al., Phys. Rev. Lett. 124 (2020) 132502.'],
  ['c29Cu1',  'M. L. Bissell, T. Carette, K. T. Flanagan, et al., Phys. Rev. C 93 (2016) 064318.'],
  ['c29Cu2',  'R. P. de Groote, J. Billowes, C. L. Binnersley, et al., Nat. Phys. 16 (2020) 620.'],
  ['c30Zn',   'L. Xie, X. F. Yang, C. Wraith, et al., Phys. Lett. B 797 (2019) 134805.'],
  ['c31Ga1',  'T. J. Procter, J. Billowes, M. L. Bissell, et al., Phys. Rev. C 86 (2012) 034329.'],
  ['c31Ga2',  'G. J. Farooq-Smith, A. R. Vernon, J. Billowes, et al., Phys. Rev. C 96 (2017) 044324.'],
  ['c37Rb1',  "E. Mane, A. Voss, J. A. Behr, et al., Phys. Rev. Lett. 107 (2011) 212502."],
  ['c37Rb2',  'T. J. Procter, J. A. Behr, J. Billowes, et al., Eur. Phys. J. A 51 (2015) 23.'],
  ['c47Ag',   'R. Ferrer, N. Bree, T. E. Cocolios, et al., Phys. Lett. B 728 (2014) 191.'],
  ['c48Cd',   'M. Hammen, W. Nortershauser, D. L. Balabanski, et al., Phys. Rev. Lett. 121 (2018) 102501.'],
  ['c50Sn',   "C. Gorges, L. V. Rodriguez, D. L. Balabanski, et al., Phys. Rev. Lett. 122 (2019) 192502."],
  ['c70Yb',   'K. T. Flanagan, J. Billowes, P. Campbell, et al., J. Phys. G: Nucl. Part. Phys. 39 (2012) 125101.'],
  ['c80Hg',   'B. A. Marsh, T. Day Goodacre, S. Sels, et al., Nat. Phys. 14 (2018) 1163.'],
  ['c81Tl1',  'A. E. Barzakh, A. N. Andreyev, T. E. Cocolios, et al., Phys. Rev. C 95 (2017) 014324.'],
  ['c81Tl2',  'A. E. Barzakh, L. Kh. Batist, D. V. Fedorov, et al., Phys. Rev. C 88 (2013) 024315.'],
  ['c83Bi',   'A. E. Barzakh, D. V. Fedorov, V. S. Ivanov, et al., Phys. Rev. C 97 (2018) 014322.'],
  ['c84Po1',  'M. D. Seliverstov, T. E. Cocolios, W. Dexters, et al., Phys. Lett. B 719 (2013) 362.'],
  ['c84Po2',  'D. A. Fink, T. E. Cocolios, A. N. Andreyev, et al., Phys. Rev. X 5 (2015) 011018.'],
  ['c87Fr',   'K. M. Lynch, J. Billowes, M. L. Bissell, et al., Phys. Rev. X 4 (2014) 011055.'],
  ['c88Ra',   'K. M. Lynch, S. G. Wilkins, J. Billowes, et al., Phys. Rev. C 97 (2018) 024309.'],
]);

// ── Parsing helpers ─────────────────────────────────────────────────────────

function stripBold(s: string): { text: string; isBold: boolean } {
  const match = s.match(/\\textbf\{([^}]*)\}/);
  if (match) {
    return { text: match[1]!, isBold: true };
  }
  return { text: s, isBold: false };
}

function parseFloat_(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === '--') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// ── Main parser ─────────────────────────────────────────────────────────────

export function parseLaserRadii(content: string): LaserRadiiParseResult {
  const rows: LaserRadiusRow[] = [];

  // Find the data region: after \endhead and before \end{longtable}
  const lines = content.split('\n');
  let inData = false;
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trimStart();
    // Skip LaTeX comments
    if (trimmedLine.startsWith('%')) continue;
    if (trimmedLine.includes('\\endhead')) {
      inData = true;
      continue;
    }
    if (trimmedLine.includes('\\end{longtable}')) {
      break;
    }
    if (inData) {
      dataLines.push(line);
    }
  }

  let currentZ = 0;
  let currentElement = '';

  for (const rawLine of dataLines) {
    // Strip trailing \\ (LaTeX line break) and \hline, trim
    const line = rawLine.replace(/\\+\s*$/g, '').replace(/\\hline/g, '').trim();
    if (line === '') continue;

    const fields = line.split('&');
    if (fields.length < 8) continue; // Need Z, el, N, A, δr², Δδr², r_c, Δr_c

    // Fields: Z, el, N, A, δ⟨r²⟩, Δδ⟨r²⟩, r_c, Δr_c, In Ref
    const zField = stripBold(fields[0]!.trim());
    const elField = stripBold(fields[1]!.trim());

    // Carry forward Z/element for continuation rows
    if (zField.text !== '') {
      currentZ = parseInt(zField.text, 10);
    }
    if (elField.text !== '') {
      currentElement = elField.text;
    }

    if (currentZ === 0 || currentElement === '') continue;

    const nField = stripBold(fields[2]!.trim());
    const aField = stripBold(fields[3]!.trim());
    const drField = stripBold(fields[4]!.trim());
    const drUncField = stripBold(fields[5]!.trim());
    const rcField = stripBold(fields[6]!.trim());
    const rcUncField = stripBold(fields[7]!.trim());
    const inAngeliField = fields.length > 8 ? fields[8]!.trim() : '';

    const N = parseInt(nField.text, 10);
    const A = parseInt(aField.text, 10);

    if (isNaN(N) || isNaN(A)) continue;

    const delta_r2 = parseFloat_(drField.text);
    const delta_r2_unc = parseFloat_(drUncField.text);
    const r_charge = parseFloat_(rcField.text);
    const r_charge_unc = parseFloat_(rcUncField.text);

    if (delta_r2 === null || r_charge === null || r_charge_unc === null) continue;

    // Detect reference isotope: bold formatting OR δ⟨r²⟩ = 0 with -- uncertainty
    const is_reference = (nField.isBold || aField.isBold || rcField.isBold)
      || (delta_r2 === 0 && delta_r2_unc === null);

    const in_angeli = inAngeliField.toLowerCase().includes('yes');

    rows.push({
      Z: currentZ,
      A,
      N,
      element: currentElement,
      delta_r2_fm2: delta_r2,
      delta_r2_unc_fm2: delta_r2_unc,
      r_charge_fm: r_charge,
      r_charge_unc_fm: r_charge_unc,
      is_reference,
      in_angeli_2013: in_angeli,
    });
  }

  // Build reference isotope map from parsed data
  const refIsotopes = new Map<number, number>();
  for (const row of rows) {
    if (row.is_reference) {
      refIsotopes.set(row.Z, row.A);
    }
  }

  // Build per-isotope citation refs
  const refs: LaserRadiusRef[] = [];
  for (const row of rows) {
    const citekeys = Z_TO_CITEKEYS.get(row.Z);
    if (!citekeys) continue;
    for (const ck of citekeys) {
      const bibRef = LASER_RADII_BIBLIOGRAPHY.get(ck);
      if (bibRef) {
        refs.push({
          Z: row.Z,
          A: row.A,
          citekey: ck,
          reference: bibRef,
        });
      }
    }
  }

  return { rows, refs, refIsotopes };
}
