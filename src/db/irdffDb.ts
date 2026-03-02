import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { invalidParams } from '../shared/index.js';
import {
  describeOptionalDb,
  resolveOptionalDbPath,
  resolvePathFromEnv,
  type OptionalDbStatus,
} from './dbPathCommon.js';
import { downloadFile } from './download.js';
import { validateSqliteFile } from './sqliteFileValidation.js';

export const NDS_IRDFF_DB_PATH_ENV = 'NDS_IRDFF_DB_PATH';
export const NDS_IRDFF_DB_DOWNLOAD_URL_ENV = 'NDS_IRDFF_DB_DOWNLOAD_URL';
export const DEFAULT_IRDFF_DB_PATH = path.join(os.homedir(), '.nds-mcp', 'irdff2.sqlite');
export const DEFAULT_IRDFF_DB_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/irdff2.sqlite.gz';
const IRDFF_HOW_TO = 'Auto-download on first use, or run: nds-mcp ingest --irdff';

export function getIrdffDbPathFromEnv(): string | undefined {
  return resolvePathFromEnv(NDS_IRDFF_DB_PATH_ENV);
}

export function getIrdffDbPath(): string | undefined {
  return resolveOptionalDbPath(NDS_IRDFF_DB_PATH_ENV, DEFAULT_IRDFF_DB_PATH);
}

export function requireIrdffDbPath(): string {
  const dbPath = getIrdffDbPath();
  if (!dbPath) {
    throw invalidParams('IRDFF-II database not configured.', { how_to: IRDFF_HOW_TO });
  }
  return dbPath;
}

export function getIrdffDbStatus(): OptionalDbStatus {
  return describeOptionalDb(getIrdffDbPath(), IRDFF_HOW_TO);
}

export async function ensureIrdffDb(): Promise<string> {
  try {
    const explicit = getIrdffDbPathFromEnv();
    if (explicit) {
      await validateSqliteFile(explicit);
      return explicit;
    }
  } catch {
    if (process.env[NDS_IRDFF_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_IRDFF_DB_PATH_ENV} is set to "${process.env[NDS_IRDFF_DB_PATH_ENV]}" but is invalid. ` +
        'Unset it to use auto-download, or fix the path.',
      );
    }
  }

  if (fs.existsSync(DEFAULT_IRDFF_DB_PATH)) {
    try {
      await validateSqliteFile(DEFAULT_IRDFF_DB_PATH);
      process.env[NDS_IRDFF_DB_PATH_ENV] = DEFAULT_IRDFF_DB_PATH;
      return DEFAULT_IRDFF_DB_PATH;
    } catch (err) {
      console.error('[nds-mcp] Cached IRDFF DB validation failed, re-downloading:',
        err instanceof Error ? err.message : String(err));
    }
  }

  const url = process.env[NDS_IRDFF_DB_DOWNLOAD_URL_ENV] || DEFAULT_IRDFF_DB_DOWNLOAD_URL;
  fs.mkdirSync(path.dirname(DEFAULT_IRDFF_DB_PATH), { recursive: true });
  const tmpPath = `${DEFAULT_IRDFF_DB_PATH}.download.${process.pid}`;

  try {
    await downloadFile(url, tmpPath, 'IRDFF DB', { timeoutMs: 60 * 60 * 1000 });
    await validateSqliteFile(tmpPath);
    fs.renameSync(tmpPath, DEFAULT_IRDFF_DB_PATH);
    process.env[NDS_IRDFF_DB_PATH_ENV] = DEFAULT_IRDFF_DB_PATH;
    return DEFAULT_IRDFF_DB_PATH;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
