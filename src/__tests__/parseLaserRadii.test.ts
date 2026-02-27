import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLaserRadii, REFERENCE_ISOTOPES, LASER_RADII_BIBLIOGRAPHY } from '../ingest/parseLaserRadii.js';

const TEX_PATH = path.resolve(__dirname, '../../raw/laser_radii/Radii.tex');
const hasTexData = fs.existsSync(TEX_PATH);

describe.skipIf(!hasTexData)('parseLaserRadii', () => {
  let rows: ReturnType<typeof parseLaserRadii>['rows'];
  let refs: ReturnType<typeof parseLaserRadii>['refs'];
  let refIsotopes: ReturnType<typeof parseLaserRadii>['refIsotopes'];

  beforeAll(() => {
    const content = fs.readFileSync(TEX_PATH, 'utf-8');
    ({ rows, refs, refIsotopes } = parseLaserRadii(content));
  });

  it('parses 257 data rows', () => {
    expect(rows.length).toBe(257);
  });

  it('finds 21 reference isotopes', () => {
    const refRows = rows.filter(r => r.is_reference);
    expect(refRows.length).toBe(21);
  });

  it('reference isotope map matches hardcoded REFERENCE_ISOTOPES', () => {
    expect(refIsotopes.size).toBe(21);
    for (const [Z, A] of REFERENCE_ISOTOPES) {
      expect(refIsotopes.get(Z)).toBe(A);
    }
  });

  it('Be-9 is a reference isotope with δ⟨r²⟩=0', () => {
    const be9 = rows.find(r => r.Z === 4 && r.A === 9);
    expect(be9).toBeDefined();
    expect(be9!.is_reference).toBe(true);
    expect(be9!.delta_r2_fm2).toBe(0);
    expect(be9!.delta_r2_unc_fm2).toBeNull();
    expect(be9!.r_charge_fm).toBeCloseTo(2.519, 3);
    expect(be9!.r_charge_unc_fm).toBeCloseTo(0.012, 3);
    expect(be9!.in_angeli_2013).toBe(true);
  });

  it('Be-7 is not a reference and has positive δ⟨r²⟩', () => {
    const be7 = rows.find(r => r.Z === 4 && r.A === 7);
    expect(be7).toBeDefined();
    expect(be7!.is_reference).toBe(false);
    expect(be7!.delta_r2_fm2).toBeCloseTo(0.66, 2);
    expect(be7!.delta_r2_unc_fm2).toBeCloseTo(0.06, 2);
    expect(be7!.N).toBe(3);
  });

  it('Be-12 is a new measurement (not in Angeli 2013)', () => {
    const be12 = rows.find(r => r.Z === 4 && r.A === 12);
    expect(be12).toBeDefined();
    expect(be12!.in_angeli_2013).toBe(false);
  });

  it('Ra-214 is reference for Ra', () => {
    const ra214 = rows.find(r => r.Z === 88 && r.A === 214);
    expect(ra214).toBeDefined();
    expect(ra214!.is_reference).toBe(true);
    expect(ra214!.delta_r2_fm2).toBe(0);
  });

  it('generates citation refs for all rows', () => {
    const rowKeys = new Set(rows.map(r => `${r.Z}_${r.A}`));
    const refKeys = new Set(refs.map(r => `${r.Z}_${r.A}`));
    for (const key of rowKeys) {
      expect(refKeys.has(key)).toBe(true);
    }
  });

  it('Cu isotopes have two citations', () => {
    const cu65refs = refs.filter(r => r.Z === 29 && r.A === 65);
    expect(cu65refs.length).toBe(2);
    const citekeys = cu65refs.map(r => r.citekey).sort();
    expect(citekeys).toEqual(['c29Cu1', 'c29Cu2']);
  });

  it('bibliography has 27 entries', () => {
    expect(LASER_RADII_BIBLIOGRAPHY.size).toBe(27);
  });

  it('covers 21 distinct elements', () => {
    const elements = new Set(rows.map(r => r.element));
    expect(elements.size).toBe(21);
  });

  it('Z and element carry forward correctly for continuation rows', () => {
    const cdRows = rows.filter(r => r.Z === 48);
    expect(cdRows.length).toBe(31);
    for (const r of cdRows) {
      expect(r.element).toBe('Cd');
    }
  });

  it('Sn data has only even-A isotopes (108-134)', () => {
    const snRows = rows.filter(r => r.Z === 50);
    expect(snRows.length).toBe(14);
    for (const r of snRows) {
      expect(r.A % 2).toBe(0);
    }
  });
});
