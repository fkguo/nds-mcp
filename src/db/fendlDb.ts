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

export const NDS_FENDL_DB_PATH_ENV = 'NDS_FENDL_DB_PATH';
export const NDS_FENDL_DB_DOWNLOAD_URL_ENV = 'NDS_FENDL_DB_DOWNLOAD_URL';
export const DEFAULT_FENDL_DB_PATH = path.join(os.homedir(), '.nds-mcp', 'fendl32c.sqlite');
export const DEFAULT_FENDL_DB_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/fendl32c.sqlite.gz';
const FENDL_HOW_TO = 'Auto-download on first use, or run: nds-mcp ingest --fendl';

export function getFendlDbPathFromEnv(): string | undefined {
  return resolvePathFromEnv(NDS_FENDL_DB_PATH_ENV);
}

export function getFendlDbPath(): string | undefined {
  return resolveOptionalDbPath(NDS_FENDL_DB_PATH_ENV, DEFAULT_FENDL_DB_PATH);
}

export function requireFendlDbPath(): string {
  const dbPath = getFendlDbPath();
  if (!dbPath) {
    throw invalidParams('FENDL-3.2c database not configured.', { how_to: FENDL_HOW_TO });
  }
  return dbPath;
}

export function getFendlDbStatus(): OptionalDbStatus {
  return describeOptionalDb(getFendlDbPath(), FENDL_HOW_TO);
}

export async function ensureFendlDb(): Promise<string> {
  try {
    const explicit = getFendlDbPathFromEnv();
    if (explicit) {
      await validateSqliteFile(explicit);
      return explicit;
    }
  } catch {
    if (process.env[NDS_FENDL_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_FENDL_DB_PATH_ENV} is set to "${process.env[NDS_FENDL_DB_PATH_ENV]}" but is invalid. ` +
        'Unset it to use auto-download, or fix the path.',
      );
    }
  }

  if (fs.existsSync(DEFAULT_FENDL_DB_PATH)) {
    try {
      await validateSqliteFile(DEFAULT_FENDL_DB_PATH);
      process.env[NDS_FENDL_DB_PATH_ENV] = DEFAULT_FENDL_DB_PATH;
      return DEFAULT_FENDL_DB_PATH;
    } catch (err) {
      console.error('[nds-mcp] Cached FENDL DB validation failed, re-downloading:',
        err instanceof Error ? err.message : String(err));
    }
  }

  const url = process.env[NDS_FENDL_DB_DOWNLOAD_URL_ENV] || DEFAULT_FENDL_DB_DOWNLOAD_URL;
  fs.mkdirSync(path.dirname(DEFAULT_FENDL_DB_PATH), { recursive: true });
  const tmpPath = `${DEFAULT_FENDL_DB_PATH}.download.${process.pid}`;

  try {
    await downloadFile(url, tmpPath, 'FENDL DB', { timeoutMs: 2 * 60 * 60 * 1000 });
    await validateSqliteFile(tmpPath);
    fs.renameSync(tmpPath, DEFAULT_FENDL_DB_PATH);
    process.env[NDS_FENDL_DB_PATH_ENV] = DEFAULT_FENDL_DB_PATH;
    return DEFAULT_FENDL_DB_PATH;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
