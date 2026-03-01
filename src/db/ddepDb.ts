import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { invalidParams } from '../shared/index.js';
import { describeOptionalDb, resolveOptionalDbPath, resolvePathFromEnv, type OptionalDbStatus } from './dbPathCommon.js';
import { downloadFile } from './download.js';

export const NDS_DDEP_DB_PATH_ENV = 'NDS_DDEP_DB_PATH';
export const NDS_DDEP_DB_DOWNLOAD_URL_ENV = 'NDS_DDEP_DB_DOWNLOAD_URL';
export const DEFAULT_DDEP_DB_PATH = path.join(os.homedir(), '.nds-mcp', 'ddep.sqlite');
export const DEFAULT_DDEP_DB_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/ddep.sqlite';
const DDEP_HOW_TO = 'Auto-download on first use, or run: nds-mcp ingest --ddep';

export function getDdepDbPathFromEnv(): string | undefined {
  return resolvePathFromEnv(NDS_DDEP_DB_PATH_ENV);
}

export function getDdepDbPath(): string | undefined {
  return resolveOptionalDbPath(NDS_DDEP_DB_PATH_ENV, DEFAULT_DDEP_DB_PATH);
}

export function requireDdepDbPath(): string {
  const dbPath = getDdepDbPath();
  if (!dbPath) {
    throw invalidParams('DDEP database not configured.', { how_to: DDEP_HOW_TO });
  }
  return dbPath;
}

export function getDdepDbStatus(): OptionalDbStatus {
  return describeOptionalDb(getDdepDbPath(), DDEP_HOW_TO);
}

export async function ensureDdepDb(): Promise<string> {
  try {
    const explicit = getDdepDbPathFromEnv();
    if (explicit) return explicit;
  } catch {
    if (process.env[NDS_DDEP_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_DDEP_DB_PATH_ENV} is set to "${process.env[NDS_DDEP_DB_PATH_ENV]}" but is invalid. ` +
        `Unset it to use auto-download, or fix the path.`,
      );
    }
  }

  if (fs.existsSync(DEFAULT_DDEP_DB_PATH)) {
    const stat = fs.statSync(DEFAULT_DDEP_DB_PATH);
    if (stat.isFile() && stat.size > 0) {
      process.env[NDS_DDEP_DB_PATH_ENV] = DEFAULT_DDEP_DB_PATH;
      return DEFAULT_DDEP_DB_PATH;
    }
  }

  const url = process.env[NDS_DDEP_DB_DOWNLOAD_URL_ENV] || DEFAULT_DDEP_DB_DOWNLOAD_URL;
  fs.mkdirSync(path.dirname(DEFAULT_DDEP_DB_PATH), { recursive: true });
  const tmpPath = `${DEFAULT_DDEP_DB_PATH}.download.${process.pid}`;

  try {
    await downloadFile(url, tmpPath, 'DDEP DB', { timeoutMs: 30 * 60 * 1000 });
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) throw new Error('Downloaded file is empty');
    fs.renameSync(tmpPath, DEFAULT_DDEP_DB_PATH);
    process.env[NDS_DDEP_DB_PATH_ENV] = DEFAULT_DDEP_DB_PATH;
    return DEFAULT_DDEP_DB_PATH;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
