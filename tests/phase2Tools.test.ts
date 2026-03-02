import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleToolCall } from '../src/tools/dispatcher.js';

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit' });
}

describe('Phase 2 tools', () => {
  const originalEnv = { ...process.env };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-phase2-test-'));
  const jendlDb = path.join(tmpRoot, 'jendl5.sqlite');
  const exforDb = path.join(tmpRoot, 'exfor.sqlite');

  beforeAll(() => {
    runSql(
      jendlDb,
      `
CREATE TABLE jendl5_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE jendl5_decays (id INTEGER PRIMARY KEY, Z INTEGER, A INTEGER, state INTEGER, half_life_s REAL, stable INTEGER, ndk INTEGER);
CREATE TABLE jendl5_decay_modes (id INTEGER PRIMARY KEY, decay_id INTEGER, rtyp REAL, mode_label TEXT, q_keV REAL, br REAL);
CREATE TABLE jendl5_radiation (id INTEGER PRIMARY KEY, decay_id INTEGER, styp REAL, type_label TEXT, lcon INTEGER, component_kind TEXT, energy_keV REAL, energy_unc_keV REAL, endpoint_keV REAL, intensity REAL, intensity_unc REAL);
CREATE TABLE jendl5_xs_meta (id INTEGER PRIMARY KEY, Z INTEGER, A INTEGER, state INTEGER, projectile TEXT, mt INTEGER, reaction TEXT, e_min_eV REAL, e_max_eV REAL, n_points INTEGER);
CREATE TABLE jendl5_xs_points (id INTEGER PRIMARY KEY, xs_id INTEGER, point_index INTEGER, e_eV REAL, sigma_b REAL);
CREATE TABLE jendl5_xs_interp (id INTEGER PRIMARY KEY, xs_id INTEGER, nbt INTEGER, int_law INTEGER);
INSERT INTO jendl5_meta VALUES ('dec_schema_version', '1');
INSERT INTO jendl5_meta VALUES ('xs_schema_version', '1');
INSERT INTO jendl5_meta VALUES ('jendl5_dec_version', 'upd-5');
INSERT INTO jendl5_decays VALUES (1, 27, 60, 0, 166322000.0, 0, 1);
INSERT INTO jendl5_decay_modes VALUES (1, 1, 1, 'beta-', 2823.1, 1.0);
INSERT INTO jendl5_radiation VALUES (1, 1, 0, 'gamma', 0, 'discrete_line', 1173.228, NULL, NULL, 0.9985, NULL);
INSERT INTO jendl5_radiation VALUES (2, 1, 0, 'gamma', 0, 'discrete_line', 1332.492, NULL, NULL, 0.9998, NULL);
INSERT INTO jendl5_radiation VALUES (3, 1, 0, 'gamma', 0, 'discrete_line', 511.0, NULL, NULL, 2.0, NULL);
INSERT INTO jendl5_radiation VALUES (4, 1, 1, 'beta-', 1, 'continuous_summary', 317.9, NULL, 2823.1, 0.9988, NULL);
INSERT INTO jendl5_xs_meta VALUES (1, 26, 56, 0, 'n', 102, 'n,gamma', 1e-5, 1.0, 4);
INSERT INTO jendl5_xs_points VALUES (1, 1, 1, 1e-5, 10.0);
INSERT INTO jendl5_xs_points VALUES (2, 1, 2, 1e-3, 8.0);
INSERT INTO jendl5_xs_points VALUES (3, 1, 3, 1e-3, 5.0);
INSERT INTO jendl5_xs_points VALUES (4, 1, 4, 1.0, 1.0);
INSERT INTO jendl5_xs_interp VALUES (1, 1, 2, 5);
INSERT INTO jendl5_xs_interp VALUES (2, 1, 4, 5);
INSERT INTO jendl5_xs_meta VALUES (2, 26, 56, 0, 'n', 103, 'n,p', 1e-5, 1.0, 3);
INSERT INTO jendl5_xs_points VALUES (5, 2, 1, 1e-5, 0.0);
INSERT INTO jendl5_xs_points VALUES (6, 2, 2, 1e-3, 1.0);
INSERT INTO jendl5_xs_points VALUES (7, 2, 3, 1.0, 2.0);
INSERT INTO jendl5_xs_interp VALUES (3, 2, 3, 5);
INSERT INTO jendl5_xs_meta VALUES (3, 3, 6, 0, 'n', 105, 'n,t', 1e-5, 1.0, 2);
INSERT INTO jendl5_xs_points VALUES (8, 3, 1, 1e-5, 0.1);
INSERT INTO jendl5_xs_points VALUES (9, 3, 2, 1.0, 0.2);
INSERT INTO jendl5_xs_interp VALUES (4, 3, 2, 2);
`,
    );

    runSql(
      exforDb,
      `
CREATE TABLE exfor_entries (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  target_Z INTEGER NOT NULL,
  target_A INTEGER,
  state INTEGER NOT NULL DEFAULT 0,
  projectile TEXT NOT NULL,
  reaction TEXT,
  quantity TEXT NOT NULL,
  reference TEXT,
  year INTEGER,
  PRIMARY KEY(entry_id, subentry_id)
);
CREATE TABLE exfor_points (
  entry_id TEXT NOT NULL,
  subentry_id TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  energy_eV REAL,
  kT_keV REAL,
  value REAL,
  uncertainty REAL
);
INSERT INTO exfor_entries VALUES ('E001', '001', 26, 56, 0, 'n', 'n,gamma', 'SIG', 'Paper A', 2001);
INSERT INTO exfor_entries VALUES ('E002', '001', 26, 56, 0, 'n', 'n,gamma', 'MACS', 'Paper B', 2002);
INSERT INTO exfor_points VALUES ('E001', '001', 1, 1000.0, NULL, 0.5, 0.01);
INSERT INTO exfor_points VALUES ('E002', '001', 1, NULL, 30.0, 0.12, 0.005);
`,
    );

    process.env.NDS_JENDL5_DB_PATH = jendlDb;
    process.env.NDS_EXFOR_DB_PATH = exforDb;
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('nds_get_radiation_spectrum includes 60Co gamma lines and per-decay intensity >1', async () => {
    const result = await handleToolCall('nds_get_radiation_spectrum', { Z: 27, A: 60 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    const gammaLines = data.radiation.filter((row: any) => row.type === 'gamma');
    const energies = gammaLines.map((row: any) => row.energy_keV);
    expect(energies).toContain(1173.228);
    expect(energies).toContain(1332.492);
    expect(energies).toContain(511);
    const annihilation = gammaLines.find((row: any) => row.energy_keV === 511);
    expect(annihilation.intensity).toBe(2);
  });

  it('nds_interpolate_cross_section returns left-limit at duplicate energy', async () => {
    const result = await handleToolCall('nds_interpolate_cross_section', {
      Z: 26, A: 56, state: 0, projectile: 'n', mt: 102, energy_eV: 1e-3,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.sigma_b).toBe(8);
    expect(String(data.interpolation_method)).toContain('left-limit');
  });

  it('nds_interpolate_cross_section falls back for log interpolation with non-positive values', async () => {
    const result = await handleToolCall('nds_interpolate_cross_section', {
      Z: 26, A: 56, state: 0, projectile: 'n', mt: 103, energy_eV: 1e-4,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(String(data.interpolation_method)).toContain('fallback');
  });

  it('nds_interpolate_cross_section returns INVALID_PARAMS when out of range by default', async () => {
    const result = await handleToolCall('nds_interpolate_cross_section', {
      Z: 26, A: 56, state: 0, projectile: 'n', mt: 102, energy_eV: 10,
    });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error.code).toBe('INVALID_PARAMS');
    expect(String(data.error.message)).toContain('outside tabulated range');
  });

  it('nds_interpolate_cross_section clamps when on_out_of_range=clamp', async () => {
    const result = await handleToolCall('nds_interpolate_cross_section', {
      Z: 26,
      A: 56,
      state: 0,
      projectile: 'n',
      mt: 102,
      energy_eV: 10,
      on_out_of_range: 'clamp',
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.clamped).toBe(true);
    expect(data.requested_energy_eV).toBe(10);
    expect(data.effective_energy_eV).toBe(1);
    expect(data.tabulated_e_min_eV).toBe(1e-5);
    expect(data.tabulated_e_max_eV).toBe(1);
    expect(data.energy_eV).toBe(1);
  });

  it('nds_search_exfor enforces MACS parameter semantics', async () => {
    const bad = await handleToolCall('nds_search_exfor', {
      Z: 26, A: 56, quantity: 'MACS', e_min_eV: 1,
    });
    expect(bad.isError).toBe(true);
    const badPayload = JSON.parse(bad.content[0]!.text);
    expect(badPayload.error.code).toBe('INVALID_PARAMS');
    expect(Array.isArray(badPayload.error.data?.parameter_rules)).toBe(true);
    expect(Array.isArray(badPayload.error.data?.example_calls)).toBe(true);
    expect(badPayload.error.data.example_calls.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(badPayload.error.data?.available_for_Z?.projectiles)).toBe(true);
    expect(Array.isArray(badPayload.error.data?.available_for_Z?.quantities)).toBe(true);
    expect(Array.isArray(badPayload.error.data?.available_for_Z?.A_values)).toBe(true);
    expect(badPayload.error.data.available_for_Z.projectiles).toContain('n');
    expect(badPayload.error.data.available_for_Z.quantities).toContain('SIG');
    expect(badPayload.error.data.available_for_Z.quantities).toContain('MACS');
    expect(badPayload.error.data.available_for_Z.A_values).toContain(56);

    const good = await handleToolCall('nds_search_exfor', {
      Z: 26, A: 56, quantity: 'MACS', kT_min_keV: 10, kT_max_keV: 40,
    });
    expect(good.isError).toBeUndefined();
    const rows = JSON.parse(good.content[0]!.text);
    expect(rows.length).toBe(1);
    expect(rows[0].entry_id).toBe('E002');
  });

  it('nds_get_exfor_entry returns full entry payload', async () => {
    const result = await handleToolCall('nds_get_exfor_entry', { entry_id: 'E001' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.entry_id).toBe('E001');
    expect(data.entries.length).toBe(1);
    expect(data.points.length).toBe(1);
  });

  it('nds_get_reaction_info returns available reactions', async () => {
    const result = await handleToolCall('nds_get_reaction_info', { Z: 26, A: 56 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(data.reactions)).toBe(true);
    expect(data.reactions.length).toBeGreaterThanOrEqual(2);
    expect(data.reactions.some((row: any) => row.mt === 102 && row.reaction === 'n,gamma')).toBe(true);
    expect(data.reactions.some((row: any) => row.mt === 103 && row.reaction === 'n,p')).toBe(true);
  });

  it('nds_get_reaction_info provides suggestion for common reaction alias', async () => {
    const result = await handleToolCall('nds_get_reaction_info', { Z: 3, A: 6, reaction: 'n,a' });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.suggested_reaction).toBe('n,t');
    expect(String(data.suggestion_reason)).toContain('Li-6');
  });

  it('nds_get_reaction_info returns INVALID_PARAMS with available_targets on target mismatch', async () => {
    const result = await handleToolCall('nds_get_reaction_info', {
      Z: 26,
      A: 57,
      state: 0,
      projectile: 'n',
    });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error.code).toBe('INVALID_PARAMS');
    expect(Array.isArray(data.error.data?.available_targets)).toBe(true);
    expect(data.error.data?.requested_Z).toBe(26);
    expect(data.error.data?.requested_A).toBe(57);
    expect(data.error.data?.requested_state).toBe(0);
    expect(data.error.data?.requested_projectile).toBe('n');
    expect(data.error.data.available_targets.some((row: any) => row.A === 56 && row.state === 0)).toBe(true);
  });
});
