/**
 * IAEA charge_radii.csv parser.
 *
 * CSV format with header:
 *   z,symbol,n,a,radius_val,radius_unc,radius_preliminary_val,radius_preliminary_unc
 */

export interface ChargeRadiusRow {
  Z: number;
  A: number;
  element: string;
  r_charge_fm: number | null;
  r_charge_unc_fm: number | null;
  r_charge_preliminary_fm: number | null;
  r_charge_preliminary_unc_fm: number | null;
}

function parseOptionalFloat(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function parseChargeRadii(content: string): ChargeRadiusRow[] {
  const lines = content.split('\n');
  const rows: ChargeRadiusRow[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;

    const fields = line.split(',');
    if (fields.length < 6) continue;

    const Z = parseInt(fields[0]!.trim(), 10);
    const element = fields[1]!.trim();
    const A = parseInt(fields[3]!.trim(), 10);

    if (isNaN(Z) || isNaN(A)) continue;

    rows.push({
      Z,
      A,
      element,
      r_charge_fm: parseOptionalFloat(fields[4]!),
      r_charge_unc_fm: parseOptionalFloat(fields[5]!),
      r_charge_preliminary_fm: fields.length > 6 ? parseOptionalFloat(fields[6]!) : null,
      r_charge_preliminary_unc_fm: fields.length > 7 ? parseOptionalFloat(fields[7]!) : null,
    });
  }

  return rows;
}
