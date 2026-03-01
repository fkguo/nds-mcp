import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { invalidParams } from '../shared/index.js';
import { describeOptionalDb, resolveOptionalDbPath, resolvePathFromEnv, type OptionalDbStatus } from './dbPathCommon.js';
import { downloadFile } from './download.js';

export const NDS_JENDL5_DB_PATH_ENV = 'NDS_JENDL5_DB_PATH';
export const NDS_JENDL5_DB_DOWNLOAD_URL_ENV = 'NDS_JENDL5_DB_DOWNLOAD_URL';
export const DEFAULT_JENDL5_DB_PATH = path.join(os.homedir(), '.nds-mcp', 'jendl5.sqlite');
export const DEFAULT_JENDL5_DB_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/jendl5.sqlite';
const JENDL5_HOW_TO = 'Auto-download on first use, or run: nds-mcp ingest --jendl5-dec';

export function getJendl5DbPathFromEnv(): string | undefined {
  return resolvePathFromEnv(NDS_JENDL5_DB_PATH_ENV);
}

export function getJendl5DbPath(): string | undefined {
  return resolveOptionalDbPath(NDS_JENDL5_DB_PATH_ENV, DEFAULT_JENDL5_DB_PATH);
}

export function requireJendl5DbPath(): string {
  const dbPath = getJendl5DbPath();
  if (!dbPath) {
    throw invalidParams('JENDL-5 database not configured.', { how_to: JENDL5_HOW_TO });
  }
  return dbPath;
}

export function getJendl5DbStatus(): OptionalDbStatus {
  return describeOptionalDb(getJendl5DbPath(), JENDL5_HOW_TO);
}

export async function ensureJendl5Db(): Promise<string> {
  // 1) Explicit env var already set and valid → use it
  try {
    const explicit = getJendl5DbPathFromEnv();
    if (explicit) return explicit;
  } catch {
    if (process.env[NDS_JENDL5_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_JENDL5_DB_PATH_ENV} is set to "${process.env[NDS_JENDL5_DB_PATH_ENV]}" but is invalid. ` +
        `Unset it to use auto-download, or fix the path.`,
      );
    }
  }

  // 2) Default path exists and non-empty → use cached copy
  if (fs.existsSync(DEFAULT_JENDL5_DB_PATH)) {
    const stat = fs.statSync(DEFAULT_JENDL5_DB_PATH);
    if (stat.isFile() && stat.size > 0) {
      process.env[NDS_JENDL5_DB_PATH_ENV] = DEFAULT_JENDL5_DB_PATH;
      return DEFAULT_JENDL5_DB_PATH;
    }
  }

  // 3) Download prebuilt sqlite
  const url = process.env[NDS_JENDL5_DB_DOWNLOAD_URL_ENV] || DEFAULT_JENDL5_DB_DOWNLOAD_URL;
  fs.mkdirSync(path.dirname(DEFAULT_JENDL5_DB_PATH), { recursive: true });
  const tmpPath = `${DEFAULT_JENDL5_DB_PATH}.download.${process.pid}`;

  try {
    await downloadFile(url, tmpPath, 'JENDL-5 DB', { timeoutMs: 30 * 60 * 1000 });
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) throw new Error('Downloaded file is empty');
    fs.renameSync(tmpPath, DEFAULT_JENDL5_DB_PATH);
    process.env[NDS_JENDL5_DB_PATH_ENV] = DEFAULT_JENDL5_DB_PATH;
    return DEFAULT_JENDL5_DB_PATH;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
