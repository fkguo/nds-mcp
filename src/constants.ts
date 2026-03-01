export const NDS_FIND_NUCLIDE = 'nds_find_nuclide' as const;
export const NDS_GET_MASS = 'nds_get_mass' as const;
export const NDS_GET_SEPARATION_ENERGY = 'nds_get_separation_energy' as const;
export const NDS_GET_Q_VALUE = 'nds_get_q_value' as const;
export const NDS_GET_DECAY = 'nds_get_decay' as const;
export const NDS_GET_CHARGE_RADIUS = 'nds_get_charge_radius' as const;
export const NDS_SEARCH = 'nds_search' as const;
export const NDS_INFO = 'nds_info' as const;
export const NDS_QUERY_LEVELS = 'nds_query_levels' as const;
export const NDS_QUERY_GAMMAS = 'nds_query_gammas' as const;
export const NDS_QUERY_DECAY_FEEDINGS = 'nds_query_decay_feedings' as const;
export const NDS_LOOKUP_REFERENCE = 'nds_lookup_reference' as const;
export const NDS_GET_RADIATION_SPECTRUM = 'nds_get_radiation_spectrum' as const;
export const NDS_GET_CROSS_SECTION_TABLE = 'nds_get_cross_section_table' as const;
export const NDS_INTERPOLATE_CROSS_SECTION = 'nds_interpolate_cross_section' as const;
export const NDS_SEARCH_EXFOR = 'nds_search_exfor' as const;
export const NDS_GET_EXFOR_ENTRY = 'nds_get_exfor_entry' as const;
export const NDS_GET_CONSTANT = 'nds_get_constant' as const;
export const NDS_LIST_CONSTANTS = 'nds_list_constants' as const;
export const NDS_GET_DDEP_DECAY = 'nds_get_ddep_decay' as const;

export type NdsToolName =
  | typeof NDS_FIND_NUCLIDE
  | typeof NDS_GET_MASS
  | typeof NDS_GET_SEPARATION_ENERGY
  | typeof NDS_GET_Q_VALUE
  | typeof NDS_GET_DECAY
  | typeof NDS_GET_CHARGE_RADIUS
  | typeof NDS_SEARCH
  | typeof NDS_INFO
  | typeof NDS_QUERY_LEVELS
  | typeof NDS_QUERY_GAMMAS
  | typeof NDS_QUERY_DECAY_FEEDINGS
  | typeof NDS_LOOKUP_REFERENCE
  | typeof NDS_GET_RADIATION_SPECTRUM
  | typeof NDS_GET_CROSS_SECTION_TABLE
  | typeof NDS_INTERPOLATE_CROSS_SECTION
  | typeof NDS_SEARCH_EXFOR
  | typeof NDS_GET_EXFOR_ENTRY
  | typeof NDS_GET_CONSTANT
  | typeof NDS_LIST_CONSTANTS
  | typeof NDS_GET_DDEP_DECAY;
