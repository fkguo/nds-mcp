import { sqlite3JsonQuery } from '../shared/index.js';

export type SeparationEnergyType = 'Sn' | 'Sp' | 'S2n' | 'S2p';
export type QValueType = 'Qa' | 'Q2bm' | 'Qep' | 'Qbn' | 'Q4bm' | 'Qda' | 'Qpa' | 'Qna';

export interface ReactionResult {
  Z: number;
  A: number;
  element: string;
  [key: string]: unknown;
}

export async function getSeparationEnergy(
  dbPath: string, Z: number, A: number, type?: SeparationEnergyType
): Promise<Record<string, unknown> | null> {
  const rows = await sqlite3JsonQuery(dbPath, `SELECT * FROM ame_reactions WHERE Z=${Z} AND A=${A}`);
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;

  if (type) {
    const valKey = `${type}_keV`;
    const uncKey = `${type}_unc_keV`;
    return {
      Z: r.Z, A: r.A, element: r.element,
      type,
      value_keV: r[valKey] ?? null,
      uncertainty_keV: r[uncKey] ?? null,
    };
  }

  // Return all separation energies
  return {
    Z: r.Z, A: r.A, element: r.element,
    S2n: { value_keV: r.S2n_keV, uncertainty_keV: r.S2n_unc_keV },
    S2p: { value_keV: r.S2p_keV, uncertainty_keV: r.S2p_unc_keV },
    Sn: { value_keV: r.Sn_keV, uncertainty_keV: r.Sn_unc_keV },
    Sp: { value_keV: r.Sp_keV, uncertainty_keV: r.Sp_unc_keV },
  };
}

export async function getQValue(
  dbPath: string, Z: number, A: number, type?: QValueType
): Promise<Record<string, unknown> | null> {
  const rows = await sqlite3JsonQuery(dbPath, `SELECT * FROM ame_reactions WHERE Z=${Z} AND A=${A}`);
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;

  if (type) {
    const valKey = `${type}_keV`;
    const uncKey = `${type}_unc_keV`;
    return {
      Z: r.Z, A: r.A, element: r.element,
      type,
      value_keV: r[valKey] ?? null,
      uncertainty_keV: r[uncKey] ?? null,
    };
  }

  // Return all Q values
  return {
    Z: r.Z, A: r.A, element: r.element,
    Qa: { value_keV: r.Qa_keV, uncertainty_keV: r.Qa_unc_keV },
    Q2bm: { value_keV: r.Q2bm_keV, uncertainty_keV: r.Q2bm_unc_keV },
    Qep: { value_keV: r.Qep_keV, uncertainty_keV: r.Qep_unc_keV },
    Qbn: { value_keV: r.Qbn_keV, uncertainty_keV: r.Qbn_unc_keV },
    Q4bm: { value_keV: r.Q4bm_keV, uncertainty_keV: r.Q4bm_unc_keV },
    Qda: { value_keV: r.Qda_keV, uncertainty_keV: r.Qda_unc_keV },
    Qpa: { value_keV: r.Qpa_keV, uncertainty_keV: r.Qpa_unc_keV },
    Qna: { value_keV: r.Qna_keV, uncertainty_keV: r.Qna_unc_keV },
  };
}
