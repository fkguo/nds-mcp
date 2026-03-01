/**
 * Auto-download the NDS SQLite database on first use.
 *
 * Priority:
 *   1. NDS_DB_PATH env already set and valid → use it
 *   2. ~/.nds-mcp/nds.sqlite exists and non-empty → use it
 *   3. Download from GitHub Releases → atomic rename into place
 *
 * Download uses curl (preferred, handles proxy natively) with node:https fallback.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getNdsDbPathFromEnv, NDS_DB_PATH_ENV } from './ndsDb.js';
import { downloadFile } from './download.js';

export { hasCurl } from './download.js';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.nds-mcp');
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'nds.sqlite');

const DOWNLOAD_URL_ENV = 'NDS_DB_DOWNLOAD_URL';
const DEFAULT_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/nds.sqlite';

/**
 * Ensure the NDS SQLite database is available, downloading it if necessary.
 * Sets `process.env.NDS_DB_PATH` so downstream code can find it.
 *
 * @returns The absolute path to the database file.
 */
export async function ensureNdsDb(): Promise<string> {
  // 1. NDS_DB_PATH already set and valid
  try {
    const explicit = getNdsDbPathFromEnv();
    if (explicit) {
      return explicit;
    }
  } catch {
    // If NDS_DB_PATH is set but invalid, let the error propagate
    // only if the user explicitly set it (not our auto-set)
    if (process.env[NDS_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_DB_PATH_ENV} is set to "${process.env[NDS_DB_PATH_ENV]}" but is invalid. ` +
        `Unset it to use auto-download, or fix the path.`
      );
    }
  }

  // 2. Default path exists and non-empty → use cached copy
  if (fs.existsSync(DEFAULT_DB_PATH)) {
    const stat = fs.statSync(DEFAULT_DB_PATH);
    if (stat.isFile() && stat.size > 0) {
      process.env[NDS_DB_PATH_ENV] = DEFAULT_DB_PATH;
      console.error(`[nds-mcp] Using cached database: ${DEFAULT_DB_PATH}`);
      return DEFAULT_DB_PATH;
    }
  }

  // 3. Download
  const url = process.env[DOWNLOAD_URL_ENV] || DEFAULT_DOWNLOAD_URL;
  fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true });

  const tmpPath = path.join(DEFAULT_DATA_DIR, `nds.sqlite.download.${process.pid}`);

  try {
    await downloadFile(url, tmpPath, 'main DB');

    // Validate: downloaded file must be non-empty
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Atomic rename into place
    fs.renameSync(tmpPath, DEFAULT_DB_PATH);
    console.error(`[nds-mcp] Database downloaded: ${DEFAULT_DB_PATH} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    process.env[NDS_DB_PATH_ENV] = DEFAULT_DB_PATH;
    return DEFAULT_DB_PATH;
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
