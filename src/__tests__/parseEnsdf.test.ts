import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  preprocessLine,
  classifyRecord,
  parseNucid,
  parseEnsdfValue,
  ensdfUncertainty,
  parseHalfLife,
  parseReferenceRecord,
  parseLevelRecord,
  parseGammaRecord,
  parseBetaRecord,
  parseParentRecord,
  extractQrefKeynumbers,
  identifyDataset,
  parseBTypeContinuation,
  splitIntoDatasets,
  extractTitleHalfLife,
} from '../ingest/parseEnsdf.js';

describe('preprocessLine', () => {
  it('pads short lines to 80 chars', () => {
    expect(preprocessLine('abc').length).toBe(80);
  });

  it('truncates long lines to 80 chars', () => {
    expect(preprocessLine('x'.repeat(100)).length).toBe(80);
  });
});

describe('classifyRecord', () => {
  it('classifies L record', () => {
    const line = preprocessLine(' 60NI  L 1332.508  4  2+               0.9 PS    3                              ');
    expect(classifyRecord(line)).toBe('level');
  });

  it('classifies G record', () => {
    const line = preprocessLine(' 60NI  G 1332.492  4 99.9826 6  E2                                              ');
    expect(classifyRecord(line)).toBe('gamma');
  });

  it('classifies B record', () => {
    const line = preprocessLine(' 60NI  B 1492      20 0.12   3             14.70 11                          2U ');
    expect(classifyRecord(line)).toBe('beta');
  });

  it('classifies P record', () => {
    const line = preprocessLine(' 60CO  P 0.0          5+               1925.28 D 14              2822.8   2     ');
    expect(classifyRecord(line)).toBe('parent');
  });

  it('classifies R record', () => {
    const line = preprocessLine(' 60    R 1940LI01 JOUR RMPHA 12 30                                              ');
    expect(classifyRecord(line)).toBe('reference');
  });

  it('classifies comment records (col 7 = c)', () => {
    const line = preprocessLine(' 60NI cL T         from |g|g(t) by 1976Kl04.                                    ');
    expect(classifyRecord(line)).toBe('comment');
  });

  it('classifies comment records (col 7 = C)', () => {
    const line = preprocessLine(' 60NI CL           some comment                                                 ');
    expect(classifyRecord(line)).toBe('comment');
  });

  it('classifies comment records (col 7 = #)', () => {
    const line = preprocessLine(' 60  #c       Lawrence Berkeley National Laboratory                             ');
    expect(classifyRecord(line)).toBe('comment');
  });

  it('classifies header records', () => {
    const line = preprocessLine(' 60NI    ADOPTED LEVELS, GAMMAS                                  13NDS    201312');
    expect(classifyRecord(line)).toBe('header');
  });

  it('classifies d/D documentation records as comment', () => {
    const line = preprocessLine(' 60NI d  some documentation record                                              ');
    expect(classifyRecord(line)).toBe('comment');
  });
});

describe('parseNucid', () => {
  it('parses standard NUCID', () => {
    const result = parseNucid(' 60NI');
    expect(result).toEqual({ A: 60, element: 'Ni', Z: 28 });
  });

  it('parses NUCID with mass only', () => {
    const result = parseNucid(' 60  ');
    expect(result).toBeNull(); // no element
  });

  it('parses single-letter element', () => {
    const result = parseNucid('  1H ');
    expect(result).toEqual({ A: 1, element: 'H', Z: 1 });
  });
});

describe('parseEnsdfValue', () => {
  it('parses standard number', () => {
    const r = parseEnsdfValue('1332.514');
    expect(r.value).toBe(1332.514);
    expect(r.estimated).toBe(false);
  });

  it('parses estimated value with #', () => {
    const r = parseEnsdfValue('100.00#');
    expect(r.value).toBe(100);
    expect(r.estimated).toBe(true);
    expect(r.raw).toBe('100.00#');
  });

  it('returns null for blank', () => {
    expect(parseEnsdfValue('   ').value).toBeNull();
  });

  it('returns null for *', () => {
    expect(parseEnsdfValue('*').value).toBeNull();
  });

  it('parses scientific notation', () => {
    expect(parseEnsdfValue('6.52E3').value).toBe(6520);
  });
});

describe('ensdfUncertainty', () => {
  it('computes from standard decimal', () => {
    // 1332.514 ± 4 → 4 × 10^(-3) = 0.004
    expect(ensdfUncertainty('1332.514', '4')).toBeCloseTo(0.004, 10);
  });

  it('preserves trailing zeros', () => {
    // 100.00 ± 3 → 3 × 10^(-2) = 0.03
    expect(ensdfUncertainty('100.00', '3')).toBeCloseTo(0.03, 10);
  });

  it('handles no decimal point', () => {
    // 1492 ± 20 → 20 × 10^0 = 20
    expect(ensdfUncertainty('1492', '20')).toBe(20);
  });

  it('handles scientific notation', () => {
    // 6.52E3 ± 35 → mantissa decimals=2, exp=3, scale=10^(3-2)=10 → 35×10=350
    expect(ensdfUncertainty('6.52E3', '35')).toBe(350);
  });

  it('returns null for special markers', () => {
    expect(ensdfUncertainty('100', 'SY')).toBeNull();
    expect(ensdfUncertainty('100', 'AP')).toBeNull();
    expect(ensdfUncertainty('100', '')).toBeNull();
    expect(ensdfUncertainty('100', '?')).toBeNull();
  });

  it('handles 826.06 ± 3', () => {
    expect(ensdfUncertainty('826.06', '3')).toBeCloseTo(0.03, 10);
  });

  it('handles 1332.508 ± 4', () => {
    expect(ensdfUncertainty('1332.508', '4')).toBeCloseTo(0.004, 10);
  });
});

describe('parseHalfLife', () => {
  it('parses D (days)', () => {
    const r = parseHalfLife('1925.28 D ', '14    ');
    expect(r.seconds).toBeCloseTo(1925.28 * 86400, 0);
    expect(r.display).toBe('1925.28 D');
  });

  it('parses PS (picoseconds)', () => {
    const r = parseHalfLife('0.9 PS    ', '3     ');
    expect(r.seconds).toBeCloseTo(0.9e-12, 15);
  });

  it('parses STABLE', () => {
    const r = parseHalfLife('STABLE    ', '      ');
    expect(r.seconds).toBeNull();
    expect(r.display).toBe('STABLE');
  });

  it('parses Y (tropical year)', () => {
    const r = parseHalfLife('5.27 Y    ', '      ');
    expect(r.seconds).toBeCloseTo(5.27 * 3.1556926e7, 0);
  });

  it('parses EV (energy width → half-life)', () => {
    const r = parseHalfLife('1.0 EV    ', '      ');
    // T½ = ln(2)·ℏ/Γ = 4.562339e-16 / 1.0
    expect(r.seconds).toBeCloseTo(4.562339e-16, 25);
  });
});

describe('parseReferenceRecord', () => {
  it('extracts keynumber, type, reference', () => {
    const line = preprocessLine(' 60    R 1940LI01 JOUR RMPHA 12 30                                              ');
    const r = parseReferenceRecord(line, 60)!;
    expect(r.A).toBe(60);
    expect(r.keynumber).toBe('1940LI01');
    expect(r.type).toBe('JOUR');
    expect(r.reference).toBe('RMPHA 12 30');
  });

  it('handles REPT type', () => {
    const line = preprocessLine(' 60    R 1960ME09 REPT TID-6322,P42                                             ');
    const r = parseReferenceRecord(line, 60)!;
    expect(r.keynumber).toBe('1960ME09');
    expect(r.type).toBe('REPT');
  });
});

describe('parseLevelRecord', () => {
  it('parses 60Ni 1332 keV level', () => {
    const line = preprocessLine(' 60NI  L 1332.508  4  2+               0.9 PS    3                              ');
    const r = parseLevelRecord(line)!;
    expect(r.energy_keV).toBe(1332.508);
    expect(r.energy_raw).toBe('1332.508');
    expect(r.energy_unc_keV).toBeCloseTo(0.004, 10);
    expect(r.spin_parity).toBe('2+');
    expect(r.half_life).toBe('0.9 PS');
    expect(r.half_life_seconds).toBeCloseTo(0.9e-12, 15);
  });

  it('parses ground state', () => {
    const line = preprocessLine(' 60NI  L 0.0          0+               STABLE                                   ');
    const r = parseLevelRecord(line)!;
    expect(r.energy_keV).toBe(0);
    expect(r.spin_parity).toBe('0+');
    expect(r.half_life).toBe('STABLE');
    expect(r.half_life_seconds).toBeNull();
  });

  it('detects questionable flag', () => {
    const line = preprocessLine(' 60NI  L 2158.612  21 2+                                                       ?');
    const r = parseLevelRecord(line)!;
    expect(r.questionable).toBe(1);
  });
});

describe('parseGammaRecord', () => {
  it('parses 1332 keV gamma', () => {
    const line = preprocessLine(' 60NI  G 1332.492  4 99.9826 6  E2                                              ');
    const r = parseGammaRecord(line)!;
    expect(r.gamma_energy_keV).toBe(1332.492);
    expect(r.gamma_energy_unc_keV).toBeCloseTo(0.004, 10);
    expect(r.rel_intensity).toBe(99.9826);
    expect(r.multipolarity).toBe('E2');
  });

  it('parses gamma with mixing ratio', () => {
    const line = preprocessLine(' 60NI  G 826.10    3  0.0076  8 M1+E2    +0.9     3                             ');
    const r = parseGammaRecord(line)!;
    expect(r.gamma_energy_keV).toBe(826.1);
    expect(r.multipolarity).toBe('M1+E2');
    expect(r.mixing_ratio).toBe(0.9);
  });
});

describe('parseBetaRecord', () => {
  it('parses beta feeding', () => {
    const line = preprocessLine(' 60NI  B 1492      20 0.12   3             14.70 11                          2U ');
    const r = parseBetaRecord(line);
    expect(r.endpoint_keV).toBe(1492);
    expect(r.ib_percent).toBe(0.12);
    expect(r.log_ft).toBe(14.7);
    expect(r.forbiddenness).toBe('2U');
  });
});

describe('parseParentRecord', () => {
  it('parses 60Co parent', () => {
    const line = preprocessLine(' 60CO  P 0.0          5+               1925.28 D 14              2822.8   2     ');
    const r = parseParentRecord(line);
    expect(r.halfLife).toBe('1925.28 D');
    expect(r.halfLifeSeconds).toBeCloseTo(1925.28 * 86400, 0);
  });
});

describe('extractQrefKeynumbers', () => {
  it('extracts keynumbers from QREF field', () => {
    const line = preprocessLine(' 60NI  Q -6128.0   1611387.735 9532.38 20-6291.0 3     2012WA38                 ');
    const r = extractQrefKeynumbers(line);
    expect(r.keynumbers).toContain('2012WA38');
  });
});

describe('identifyDataset', () => {
  it('identifies ADOPTED LEVELS, GAMMAS', () => {
    const line = preprocessLine(' 60NI    ADOPTED LEVELS, GAMMAS                                  13NDS    201312');
    const r = identifyDataset(line)!;
    expect(r.datasetType).toBe('ADOPTED LEVELS, GAMMAS');
    expect(r.nucid.element).toBe('Ni');
    expect(r.nucid.A).toBe(60);
  });

  it('identifies B- DECAY with parent', () => {
    const line = preprocessLine(' 60NI    60CO B- DECAY (1925.28 D)                               13NDS    201312');
    const r = identifyDataset(line)!;
    expect(r.datasetType).toBe('B- DECAY');
    expect(r.nucid.element).toBe('Ni');
    expect(r.parentNucid?.element).toBe('Co');
    expect(r.parentNucid?.A).toBe(60);
  });

  it('returns null for reaction datasets', () => {
    const line = preprocessLine(' 60NI    59CO(P,G)                     1975ER05                  13NDS    201312');
    const r = identifyDataset(line);
    expect(r).toBeNull();
  });
});

describe('extractTitleHalfLife', () => {
  it('extracts from parentheses', () => {
    expect(extractTitleHalfLife('60CO B- DECAY (1925.28 D)')).toBe('1925.28 D');
  });

  it('returns null when no parentheses', () => {
    expect(extractTitleHalfLife('ADOPTED LEVELS, GAMMAS')).toBeNull();
  });
});

describe('parseBTypeContinuation', () => {
  it('extracts BE2W value', () => {
    const line = preprocessLine(' 60NIB G BE2W=0.26 6                                                            ');
    const r = parseBTypeContinuation(line);
    expect(r.be2w).toBeCloseTo(0.26, 5);
    expect(r.be2w_unc).toBeCloseTo(0.06, 5);
  });
});

describe('splitIntoDatasets (A=60)', () => {
  const ensdfPath = path.join(__dirname, '../../raw/ensdf/ensdf.060');

  it('splits file into dataset blocks', () => {
    if (!fs.existsSync(ensdfPath)) return; // skip if no data
    const content = fs.readFileSync(ensdfPath, 'utf-8');
    const blocks = splitIntoDatasets(content);
    expect(blocks.length).toBeGreaterThan(10);

    // Should have exactly 1 REFERENCES block
    const refBlocks = blocks.filter(b => b.headerLine.substring(9, 39).trim() === 'REFERENCES');
    expect(refBlocks.length).toBe(1);

    // Should have 60Ni ADOPTED LEVELS, GAMMAS
    const niAdopted = blocks.find(b => {
      const info = identifyDataset(b.headerLine);
      return info && info.nucid.element === 'Ni' && info.datasetType === 'ADOPTED LEVELS, GAMMAS';
    });
    expect(niAdopted).toBeDefined();
  });
});
