import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { invalidParams } from '../shared/index.js';
import { describeOptionalDb, resolveOptionalDbPath, resolvePathFromEnv, type OptionalDbStatus } from './dbPathCommon.js';
import { downloadFile } from './download.js';

export const NDS_EXFOR_DB_PATH_ENV = 'NDS_EXFOR_DB_PATH';
export const NDS_EXFOR_DB_DOWNLOAD_URL_ENV = 'NDS_EXFOR_DB_DOWNLOAD_URL';
export const DEFAULT_EXFOR_DB_PATH = path.join(os.homedir(), '.nds-mcp', 'exfor.sqlite');
export const DEFAULT_EXFOR_DB_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/exfor.sqlite';
const EXFOR_HOW_TO = 'Auto-download on first use, or run: nds-mcp ingest --exfor';

export function getExforDbPathFromEnv(): string | undefined {
  return resolvePathFromEnv(NDS_EXFOR_DB_PATH_ENV);
}

export function getExforDbPath(): string | undefined {
  return resolveOptionalDbPath(NDS_EXFOR_DB_PATH_ENV, DEFAULT_EXFOR_DB_PATH);
}

export function requireExforDbPath(): string {
  const dbPath = getExforDbPath();
  if (!dbPath) {
    throw invalidParams('EXFOR database not configured.', { how_to: EXFOR_HOW_TO });
  }
  return dbPath;
}

export function getExforDbStatus(): OptionalDbStatus {
  return describeOptionalDb(getExforDbPath(), EXFOR_HOW_TO);
}

export async function ensureExforDb(): Promise<string> {
  // 1) Explicit env var already set and valid → use it
  try {
    const explicit = getExforDbPathFromEnv();
    if (explicit) return explicit;
  } catch {
    if (process.env[NDS_EXFOR_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_EXFOR_DB_PATH_ENV} is set to "${process.env[NDS_EXFOR_DB_PATH_ENV]}" but is invalid. ` +
        `Unset it to use auto-download, or fix the path.`,
      );
    }
  }

  // 2) Default path exists and non-empty → use cached copy
  if (fs.existsSync(DEFAULT_EXFOR_DB_PATH)) {
    const stat = fs.statSync(DEFAULT_EXFOR_DB_PATH);
    if (stat.isFile() && stat.size > 0) {
      process.env[NDS_EXFOR_DB_PATH_ENV] = DEFAULT_EXFOR_DB_PATH;
      return DEFAULT_EXFOR_DB_PATH;
    }
  }

  // 3) Download prebuilt sqlite
  const url = process.env[NDS_EXFOR_DB_DOWNLOAD_URL_ENV] || DEFAULT_EXFOR_DB_DOWNLOAD_URL;
  fs.mkdirSync(path.dirname(DEFAULT_EXFOR_DB_PATH), { recursive: true });
  const tmpPath = `${DEFAULT_EXFOR_DB_PATH}.download.${process.pid}`;

  try {
    await downloadFile(url, tmpPath, 'EXFOR DB', { timeoutMs: 2 * 60 * 60 * 1000 });
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) throw new Error('Downloaded file is empty');
    fs.renameSync(tmpPath, DEFAULT_EXFOR_DB_PATH);
    process.env[NDS_EXFOR_DB_PATH_ENV] = DEFAULT_EXFOR_DB_PATH;
    return DEFAULT_EXFOR_DB_PATH;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
