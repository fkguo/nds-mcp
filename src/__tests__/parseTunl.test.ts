import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseTunlLevels, parseEnergy, parseWidth, type TunlLevelRow } from '../ingest/parseTunl.js';

const TUNL_DIR = path.resolve(__dirname, '../../raw/tunl');
const hasTunlData = fs.existsSync(TUNL_DIR) && fs.readdirSync(TUNL_DIR).some(f => f.endsWith('.txt'));

// ── Unit tests for parseEnergy ────────────────────────────────────────────

describe('parseEnergy', () => {
  it('parses ground state "g.s."', () => {
    const r = parseEnergy('g.s.');
    expect(r).toEqual({ energy_keV: 0, energy_unc_keV: null, energy_raw: 'g.s.' });
  });

  it('parses zero energy "0"', () => {
    const r = parseEnergy('0');
    expect(r).toEqual({ energy_keV: 0, energy_unc_keV: null, energy_raw: '0' });
  });

  it('parses MeV with uncertainty in keV', () => {
    const r = parseEnergy('2.124693 ± 0.027');
    expect(r).not.toBeNull();
    expect(r!.energy_keV).toBeCloseTo(2124.693, 1);
    expect(r!.energy_unc_keV).toBeCloseTo(0.027, 3);
    expect(r!.energy_raw).toBe('2.124693 ± 0.027');
  });

  it('parses approximate energy "≈ 37"', () => {
    const r = parseEnergy('≈ 37');
    expect(r).not.toBeNull();
    expect(r!.energy_keV).toBeCloseTo(37000, 0);
    expect(r!.energy_raw).toBe('≈ 37');
  });

  it('parses parenthesized energy "(10.960 ± 50)"', () => {
    const r = parseEnergy('(10.960 ± 50)');
    expect(r).not.toBeNull();
    expect(r!.energy_keV).toBeCloseTo(10960, 0);
    expect(r!.energy_unc_keV).toBeCloseTo(50, 0);
    expect(r!.energy_raw).toBe('(10.960 ± 50)');
  });

  it('returns null for non-energy text', () => {
    expect(parseEnergy('')).toBeNull();
    expect(parseEnergy('γ')).toBeNull();
    expect(parseEnergy('See also')).toBeNull();
  });
});

// ── Unit tests for parseWidth ─────────────────────────────────────────────

describe('parseWidth', () => {
  it('parses "stable"', () => {
    const r = parseWidth('stable', 'keV');
    expect(r.width_keV).toBeNull();
    expect(r.half_life).toBe('stable');
  });

  it('parses plain keV width "109 ± 14"', () => {
    const r = parseWidth('109 ± 14', 'keV');
    expect(r.width_keV).toBe(109);
    expect(r.width_unc_keV).toBe(14);
  });

  it('parses eV width "0.117 ± 0.004 eV"', () => {
    const r = parseWidth('0.117 ± 0.004 eV', 'keV');
    expect(r.width_keV).toBeCloseTo(0.000117, 6);
    expect(r.width_unc_keV).toBeCloseTo(0.000004, 6);
  });

  it('parses MeV width when defaultUnit is MeV', () => {
    const r = parseWidth('1.23', 'MeV');
    expect(r.width_keV).toBeCloseTo(1230, 0);
  });

  it('parses lifetime "2.58 ± 0.14 ps" to width via ℏ/τ', () => {
    const r = parseWidth('τm = 2.58 ± 0.14 ps', 'keV');
    expect(r.width_keV).not.toBeNull();
    // Γ = ℏ/τ = 6.582e-19 / (2.58e-12) ≈ 2.55e-7 keV
    expect(r.width_keV!).toBeCloseTo(6.582119569e-19 / 2.58e-12, 10);
  });

  it('parses upper limit "< 0.5 keV"', () => {
    const r = parseWidth('< 0.5 keV', 'keV');
    expect(r.width_keV).toBe(0.5);
    expect(r.width_unc_keV).toBeNull();
  });

  it('parses "broad" as null width', () => {
    const r = parseWidth('broad', 'keV');
    expect(r.width_keV).toBeNull();
  });

  it('handles empty/dash', () => {
    expect(parseWidth('', 'keV').width_keV).toBeNull();
    expect(parseWidth('-', 'keV').width_keV).toBeNull();
  });
});

// ── Integration tests on real TUNL files ──────────────────────────────────

function loadTunlFile(name: string): string {
  const filePath = path.join(TUNL_DIR, name);
  if (!fs.existsSync(filePath)) throw new Error(`TUNL file not found: ${filePath}`);
  return fs.readFileSync(filePath, 'utf-8');
}

describe.skipIf(!hasTunlData)('parseTunlLevels — 5Li (2002)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('5_Li_2002.txt')); });

  it('finds 12 levels', () => {
    expect(rows.length).toBe(12);
  });

  it('ground state at 0 keV, 3/2-', () => {
    const gs = rows[0]!;
    expect(gs.energy_keV).toBe(0);
    expect(gs.spin_parity).toBe('3/2-');
    expect(gs.isospin).toBe('1/2');
  });

  it('detects MeV widths (first level width should be ~1230 keV)', () => {
    const gs = rows[0]!;
    expect(gs.width_keV).toBeCloseTo(1230, -1);
  });

  it('metadata from header', () => {
    expect(rows[0]!.evaluation).toBe('2002TI10');
    expect(rows[0]!.table_label).toMatch(/Table/);
    expect(rows[0]!.Z).toBe(3);
    expect(rows[0]!.A).toBe(5);
    expect(rows[0]!.element).toBe('Li');
  });

  it('energy_raw preserved for all levels', () => {
    expect(rows[0]!.energy_raw).toBeTruthy();
    for (const row of rows) {
      expect(row.energy_raw).toBeTruthy();
    }
  });
});

describe.skipIf(!hasTunlData)('parseTunlLevels — 7Li (2002)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('7_Li_2002.txt')); });

  it('finds 11 levels', () => {
    expect(rows.length).toBe(11);
  });

  it('ground state 3/2-', () => {
    expect(rows[0]!.energy_keV).toBe(0);
    expect(rows[0]!.spin_parity).toBe('3/2-');
  });

  it('has decay modes with Greek letters', () => {
    const withDecay = rows.filter(r => r.decay_modes && r.decay_modes !== 'stable');
    expect(withDecay.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasTunlData)('parseTunlLevels — 8Be (2004)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('8_Be_2004.txt')); });

  it('finds 30 levels', () => {
    expect(rows.length).toBe(30);
  });

  it('ground state at 0 keV with α decay', () => {
    const gs = rows[0]!;
    expect(gs.energy_keV).toBe(0);
    expect(gs.decay_modes).toContain('α');
  });

  it('even-A: integer spin values', () => {
    const gs = rows[0]!;
    expect(gs.spin_parity).toBe('0+');
  });
});

describe.skipIf(!hasTunlData)('parseTunlLevels — 11B (2012)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('11_B_2012.txt')); });

  it('finds 41 levels', () => {
    expect(rows.length).toBe(41);
  });

  it('ground state at 0 keV, 3/2-, T=1/2, stable', () => {
    const gs = rows[0]!;
    expect(gs.energy_keV).toBe(0);
    expect(gs.spin_parity).toBe('3/2-');
    expect(gs.isospin).toBe('1/2');
    expect(gs.decay_modes).toBe('stable');
  });

  it('eV widths converted to keV', () => {
    const lvl = rows.find(r => Math.abs(r.energy_keV - 2124.693) < 1);
    expect(lvl).toBeDefined();
    expect(lvl!.width_keV).toBeCloseTo(0.000117, 6);
  });
});

describe.skipIf(!hasTunlData)('parseTunlLevels — 12C (2017)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('12_C_2017.txt')); });

  it('finds 62 levels', () => {
    expect(rows.length).toBe(62);
  });

  it('ground state 0+', () => {
    expect(rows[0]!.energy_keV).toBe(0);
    expect(rows[0]!.spin_parity).toBe('0+');
  });
});

describe.skipIf(!hasTunlData)('parseTunlLevels — 14N (1991)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('14_N_1991.txt')); });

  it('finds 120 levels', () => {
    expect(rows.length).toBe(120);
  });

  it('ground state 1+, T=0', () => {
    const gs = rows[0]!;
    expect(gs.energy_keV).toBe(0);
    expect(gs.spin_parity).toBe('1+');
  });
});

describe.skipIf(!hasTunlData)('parseTunlLevels — 15N (1991)', () => {
  let rows: TunlLevelRow[];
  beforeAll(() => { rows = parseTunlLevels(loadTunlFile('15_N_1991.txt')); });

  it('finds 113 levels', () => {
    expect(rows.length).toBe(113);
  });

  it('ground state 1/2-, T=1/2, stable', () => {
    const gs = rows[0]!;
    expect(gs.energy_keV).toBe(0);
    expect(gs.spin_parity).toBe('1/2-');
    expect(gs.isospin).toBe('1/2');
    expect(gs.decay_modes).toBe('stable');
  });

  it('lifetime-based widths converted correctly', () => {
    const lvl = rows.find(r => Math.abs(r.energy_keV - 5270.155) < 1);
    expect(lvl).toBeDefined();
    expect(lvl!.width_keV).not.toBeNull();
    expect(lvl!.width_keV!).toBeGreaterThan(0);
  });
});
