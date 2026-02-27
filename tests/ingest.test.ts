import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseAmeMasses, parseAmeRct1, parseAmeRct2 } from '../src/ingest/parseAme.js';
import { parseNubase } from '../src/ingest/parseNubase.js';
import { parseChargeRadii } from '../src/ingest/parseRadii.js';

const DATA_DIR = '/tmp/nds-raw-data';
const hasData = fs.existsSync(path.join(DATA_DIR, 'mass_1.mas20'));

describe.skipIf(!hasData)('AME2020 mass parser', () => {
  const content = hasData ? fs.readFileSync(path.join(DATA_DIR, 'mass_1.mas20'), 'utf-8') : '';
  const rows = hasData ? parseAmeMasses(content) : [];

  it('parses correct number of nuclides', () => {
    expect(rows.length).toBeGreaterThan(3500);
  });

  it('parses neutron (Z=0, A=1)', () => {
    const neutron = rows.find(r => r.Z === 0 && r.A === 1);
    expect(neutron).toBeDefined();
    expect(neutron!.element).toBe('n');
    expect(neutron!.mass_excess_keV).toBeCloseTo(8071.318, 2);
  });

  it('parses Pb-208 (Z=82, A=208)', () => {
    const pb208 = rows.find(r => r.Z === 82 && r.A === 208);
    expect(pb208).toBeDefined();
    expect(pb208!.element).toBe('Pb');
    expect(pb208!.mass_excess_keV).toBeCloseTo(-21748.5, 0);
    expect(pb208!.binding_energy_per_A_keV).toBeCloseTo(7867.45, 1);
    expect(pb208!.is_estimated).toBe(false);
  });

  it('identifies estimated values', () => {
    const estimated = rows.filter(r => r.is_estimated);
    expect(estimated.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasData)('AME2020 rct1 parser', () => {
  const content = hasData ? fs.readFileSync(path.join(DATA_DIR, 'rct1.mas20'), 'utf-8') : '';
  const rows = hasData ? parseAmeRct1(content) : [];

  it('parses correct number of nuclides', () => {
    expect(rows.length).toBeGreaterThan(3500);
  });

  it('parses Pb-208 separation energies', () => {
    const pb208 = rows.find(r => r.Z === 82 && r.A === 208);
    expect(pb208).toBeDefined();
    expect(pb208!.S2n_keV).toBeCloseTo(14105.6, 0);
    expect(pb208!.S2n_unc_keV).toBeCloseTo(0.108, 2);
    expect(pb208!.Qa_keV).toBeCloseTo(516.7, 0);
  });

  it('handles null values for light nuclei', () => {
    const neutron = rows.find(r => r.Z === 0 && r.A === 1);
    expect(neutron).toBeDefined();
    expect(neutron!.S2n_keV).toBeNull();
    expect(neutron!.S2p_keV).toBeNull();
  });
});

describe.skipIf(!hasData)('AME2020 rct2 parser', () => {
  const content = hasData ? fs.readFileSync(path.join(DATA_DIR, 'rct2_1.mas20'), 'utf-8') : '';
  const rows = hasData ? parseAmeRct2(content) : [];

  it('parses correct number of nuclides', () => {
    expect(rows.length).toBeGreaterThan(3500);
  });

  it('parses Pb-208 single-nucleon separation energies', () => {
    const pb208 = rows.find(r => r.Z === 82 && r.A === 208);
    expect(pb208).toBeDefined();
    expect(pb208!.Sn_keV).toBeCloseTo(7367.9, 0);
    expect(pb208!.Sp_keV).toBeCloseTo(8003.05, 0);
  });
});

describe.skipIf(!hasData)('NUBASE2020 parser', () => {
  const content = hasData ? fs.readFileSync(path.join(DATA_DIR, 'nubase_4.mas20'), 'utf-8') : '';
  const rows = hasData ? parseNubase(content) : [];

  it('parses correct number of entries', () => {
    expect(rows.length).toBeGreaterThan(5800);
  });

  it('parses neutron (Z=0, A=1)', () => {
    const neutron = rows.find(r => r.Z === 0 && r.A === 1 && r.isomer_index === 0);
    expect(neutron).toBeDefined();
    expect(neutron!.element).toBe('n');
    expect(neutron!.half_life).toContain('609.8');
    expect(neutron!.half_life_seconds).toBeCloseTo(609.8, 0);
    expect(neutron!.spin_parity).toBe('1/2+*');
    expect(neutron!.decay_modes).toContain('B-=100');
  });

  it('parses U-238 (stable, alpha decay)', () => {
    const u238 = rows.find(r => r.Z === 92 && r.A === 238 && r.isomer_index === 0);
    expect(u238).toBeDefined();
    expect(u238!.spin_parity).toBe('0+');
    expect(u238!.half_life_seconds).toBeGreaterThan(1e14);
    expect(u238!.decay_modes).toContain('A=100');
  });

  it('parses isomers', () => {
    // Full dataset must contain at least some isomeric states
    const allIsomers = rows.filter(r => r.isomer_index > 0);
    expect(allIsomers.length).toBeGreaterThan(0);
    // Verify isomer has excitation energy
    const firstIsomer = allIsomers[0]!;
    expect(firstIsomer.excitation_energy_keV).not.toBeNull();
  });
});

describe.skipIf(!hasData)('Charge radii parser', () => {
  const content = hasData ? fs.readFileSync(path.join(DATA_DIR, 'charge_radii.csv'), 'utf-8') : '';
  const rows = hasData ? parseChargeRadii(content) : [];

  it('parses correct number of entries', () => {
    expect(rows.length).toBeGreaterThan(900);
  });

  it('parses Pb-208 charge radius', () => {
    const pb208 = rows.find(r => r.Z === 82 && r.A === 208);
    expect(pb208).toBeDefined();
    expect(pb208!.r_charge_fm).toBeCloseTo(5.501, 2);
    expect(pb208!.r_charge_unc_fm).toBeCloseTo(0.0013, 3);
  });
});
