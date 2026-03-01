import { invalidParams } from '../shared/index.js';

export interface XsPoint {
  point_index: number;
  e_eV: number;
  sigma_b: number;
}

export interface XsInterpSegment {
  nbt: number;
  int_law: number;
}

export interface InterpolationResult {
  sigma_b: number;
  interpolation_method: string;
}

function linLin(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x2 === x1) return y1;
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

function getSegmentLaw(segments: XsInterpSegment[], rightPointIndex: number): number {
  for (const segment of segments) {
    if (rightPointIndex <= segment.nbt) return segment.int_law;
  }
  return segments.length > 0 ? segments[segments.length - 1]!.int_law : 2;
}

function interpolatePair(intLaw: number, left: XsPoint, right: XsPoint, energyEV: number): InterpolationResult {
  const x1 = left.e_eV;
  const x2 = right.e_eV;
  const y1 = left.sigma_b;
  const y2 = right.sigma_b;

  if (intLaw === 1) return { sigma_b: y1, interpolation_method: 'histogram (INT=1)' };
  if (intLaw === 2) return { sigma_b: linLin(x1, y1, x2, y2, energyEV), interpolation_method: 'lin-lin (INT=2)' };

  const needsPositiveXY = intLaw === 3 || intLaw === 4 || intLaw === 5 || intLaw === 6;
  if (needsPositiveXY && (x1 <= 0 || x2 <= 0 || y1 <= 0 || y2 <= 0 || energyEV <= 0)) {
    return {
      sigma_b: linLin(x1, y1, x2, y2, energyEV),
      interpolation_method: 'lin-lin (fallback: log of non-positive)',
    };
  }

  if (intLaw === 3) {
    const sigma = y1 + ((y2 - y1) * Math.log(energyEV / x1)) / Math.log(x2 / x1);
    return { sigma_b: sigma, interpolation_method: 'lin-log (INT=3)' };
  }

  if (intLaw === 4) {
    const sigma = Math.exp(Math.log(y1) + ((Math.log(y2) - Math.log(y1)) * (energyEV - x1)) / (x2 - x1));
    return { sigma_b: sigma, interpolation_method: 'log-lin (INT=4)' };
  }

  if (intLaw === 5) {
    const sigma = Math.exp(Math.log(y1) + ((Math.log(y2) - Math.log(y1)) * Math.log(energyEV / x1)) / Math.log(x2 / x1));
    return { sigma_b: sigma, interpolation_method: 'log-log (INT=5)' };
  }

  if (intLaw === 6) {
    const u1 = 1 / Math.sqrt(x1);
    const u2 = 1 / Math.sqrt(x2);
    const u = 1 / Math.sqrt(energyEV);
    const w1 = Math.log(y1 * x1);
    const w2 = Math.log(y2 * x2);
    const interpolated = w1 + ((w2 - w1) * (u - u1)) / (u2 - u1);
    return { sigma_b: Math.exp(interpolated) / energyEV, interpolation_method: 'gamow (INT=6)' };
  }

  return { sigma_b: linLin(x1, y1, x2, y2, energyEV), interpolation_method: `lin-lin (fallback: unknown INT=${intLaw})` };
}

export function interpolateTab1(
  points: XsPoint[],
  segments: XsInterpSegment[],
  energyEV: number,
): InterpolationResult {
  if (points.length < 2) {
    throw invalidParams('Cross section table has fewer than 2 points');
  }

  const minE = points[0]!.e_eV;
  const maxE = points[points.length - 1]!.e_eV;
  if (energyEV < minE || energyEV > maxE) {
    throw invalidParams(`energy ${energyEV} eV is outside tabulated range [${minE}, ${maxE}] eV`);
  }

  for (const point of points) {
    if (point.e_eV === energyEV) {
      return {
        sigma_b: point.sigma_b,
        interpolation_method: 'left-limit (duplicate energy)',
      };
    }
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    if (left.e_eV < energyEV && energyEV < right.e_eV) {
      const intLaw = getSegmentLaw(segments, right.point_index);
      return interpolatePair(intLaw, left, right, energyEV);
    }
  }

  const tail = points[points.length - 1]!;
  return {
    sigma_b: tail.sigma_b,
    interpolation_method: 'left-limit (tail)',
  };
}
